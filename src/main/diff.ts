import type { MyPullRequest, MyReviewStatus, PullRequest } from '../shared/types'

export interface DiffResult {
  /** PRs that were not present in the previous snapshot. */
  newPrs: PullRequest[]
  /** True when there was no previous snapshot at all (first ever run). */
  firstRun: boolean
  /** Snapshot to persist for the next comparison. */
  seenIds: string[]
}

/**
 * Compares the current list of review requests with the previously seen ids.
 * PRs that leave the list are dropped from the snapshot, so a re-requested
 * review shows up as new again.
 */
export function diffPrs(prevSeenIds: string[] | null, current: PullRequest[]): DiffResult {
  const seenIds = current.map((pr) => pr.id)
  if (prevSeenIds === null) {
    return { newPrs: [], firstRun: true, seenIds }
  }
  const prev = new Set(prevSeenIds)
  return { newPrs: current.filter((pr) => !prev.has(pr.id)), firstRun: false, seenIds }
}

/**
 * Hides dismissed PRs. Dismissals of PRs that left the list are forgotten, so a
 * review that is requested again shows up again.
 */
export function applyDismissals(
  prs: PullRequest[],
  dismissedIds: readonly string[]
): { visible: PullRequest[]; dismissedIds: string[] } {
  const dismissed = new Set(dismissedIds)
  return {
    visible: prs.filter((pr) => !dismissed.has(pr.id)),
    dismissedIds: prs.filter((pr) => dismissed.has(pr.id)).map((pr) => pr.id)
  }
}

export const MAX_INDIVIDUAL_NOTIFICATIONS = 3

export type NotificationPlan =
  | { kind: 'none' }
  | { kind: 'summary'; count: number }
  | { kind: 'individual'; prs: PullRequest[] }
  | { kind: 'grouped'; prs: PullRequest[] }

export function planNotifications(diff: DiffResult, totalPending: number): NotificationPlan {
  if (diff.firstRun) {
    return totalPending > 0 ? { kind: 'summary', count: totalPending } : { kind: 'none' }
  }
  if (diff.newPrs.length === 0) return { kind: 'none' }
  if (diff.newPrs.length <= MAX_INDIVIDUAL_NOTIFICATIONS) {
    return { kind: 'individual', prs: diff.newPrs }
  }
  return { kind: 'grouped', prs: diff.newPrs }
}

/** What we remember about each of your PRs between polls. */
export interface MyPrSnapshot {
  status: MyReviewStatus
  /** Head SHA we last sent "ready to merge" for, so it's sent once per push. */
  readyNotifiedOid?: string
}

export type MyPrEvent =
  | { kind: 'my_pr_changes_requested'; pr: MyPullRequest; by: string[] }
  | { kind: 'my_pr_approved'; pr: MyPullRequest; by: string[] }
  | { kind: 'my_pr_ready'; pr: MyPullRequest }

const reviewersWith = (pr: MyPullRequest, state: 'APPROVED' | 'CHANGES_REQUESTED') =>
  pr.reviews.filter((r) => r.state === state).map((r) => r.login)

/**
 * Compares your open PRs with the previous snapshot. Silent on the first run and for PRs that
 * just appeared, so only real transitions notify: changes requested, approved, ready to merge.
 */
export function diffMyPrs(
  prev: Record<string, MyPrSnapshot> | undefined,
  current: MyPullRequest[]
): { events: MyPrEvent[]; snapshot: Record<string, MyPrSnapshot> } {
  const snapshot: Record<string, MyPrSnapshot> = {}
  const events: MyPrEvent[] = []
  for (const pr of current) {
    const before = prev?.[pr.id]
    const next: MyPrSnapshot = { status: pr.status, readyNotifiedOid: before?.readyNotifiedOid }
    if (before) {
      if (pr.readyToMerge && before.readyNotifiedOid !== pr.headOid) {
        events.push({ kind: 'my_pr_ready', pr })
        next.readyNotifiedOid = pr.headOid
      } else if (pr.status === 'changes_requested' && before.status !== 'changes_requested') {
        events.push({ kind: 'my_pr_changes_requested', pr, by: reviewersWith(pr, 'CHANGES_REQUESTED') })
      } else if (pr.status === 'approved' && before.status !== 'approved') {
        events.push({ kind: 'my_pr_approved', pr, by: reviewersWith(pr, 'APPROVED') })
      }
    } else if (pr.readyToMerge) {
      // Already ready when first seen: remember it so it isn't announced later.
      next.readyNotifiedOid = pr.headOid
    }
    snapshot[pr.id] = next
  }
  return { events, snapshot }
}

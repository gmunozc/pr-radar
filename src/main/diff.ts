import type { CiState, MyPullRequest, MyReviewStatus, PullRequest } from '../shared/types'

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

export interface HiddenPrs {
  dismissedIds: readonly string[]
  /** PR id → epoch ms when it comes back. */
  snoozed: Readonly<Record<string, number>>
  /** PR id → head commit it was snoozed at; it comes back once the author pushes. */
  snoozedUntilPush?: Readonly<Record<string, string>>
}

export interface HiddenResult {
  visible: PullRequest[]
  dismissedIds: string[]
  snoozed: Record<string, number>
  snoozedUntilPush: Record<string, string>
  /** Snoozed PRs that just came back (time over, or new commits). */
  returned: PullRequest[]
}

/**
 * Hides dismissed and snoozed PRs. Snoozes that are over, or whose PR got new commits, come
 * back (`returned`); like dismissals, snoozes of PRs that left the list are forgotten.
 */
export function applyHidden(prs: PullRequest[], hidden: HiddenPrs, now: number): HiddenResult {
  const { visible: notDismissed, dismissedIds } = applyDismissals(prs, hidden.dismissedIds)
  const snoozed: Record<string, number> = {}
  const snoozedUntilPush: Record<string, string> = {}
  const visible: PullRequest[] = []
  const returned: PullRequest[] = []
  for (const pr of notDismissed) {
    const until = hidden.snoozed[pr.id]
    const headAtSnooze = hidden.snoozedUntilPush?.[pr.id]
    if (until !== undefined && until > now) {
      snoozed[pr.id] = until
    } else if (headAtSnooze !== undefined && headAtSnooze === pr.headOid) {
      snoozedUntilPush[pr.id] = headAtSnooze
    } else {
      visible.push(pr)
      if (until !== undefined || headAtSnooze !== undefined) returned.push(pr)
    }
  }
  return { visible, dismissedIds, snoozed, snoozedUntilPush, returned }
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
  /** Checks as of the last poll; missing in snapshots written before 0.13 (no "failed" alert then). */
  ci?: CiState
  /** Head SHA we last reported failing checks for: once per push, however often they are rerun. */
  ciFailedOid?: string
  /** Whether it had merge conflicts, so only new ones are reported. */
  conflicts?: boolean
}

export type MyPrEvent =
  | { kind: 'my_pr_changes_requested'; pr: MyPullRequest; by: string[] }
  | { kind: 'my_pr_approved'; pr: MyPullRequest; by: string[] }
  | { kind: 'my_pr_ready'; pr: MyPullRequest }
  /** The checks on the current head failed; `failing` names them (empty when GitHub didn't say). */
  | { kind: 'my_pr_ci_failed'; pr: MyPullRequest; failing: string[] }
  | { kind: 'my_pr_conflicts'; pr: MyPullRequest }

const reviewersWith = (pr: MyPullRequest, state: 'APPROVED' | 'CHANGES_REQUESTED') =>
  pr.reviews.filter((r) => r.state === state).map((r) => r.login)

const failingChecks = (pr: MyPullRequest) => pr.checks.filter((c) => c.state === 'failure').map((c) => c.name)

/**
 * Compares your open PRs with the previous snapshot. Silent on the first run and for PRs that
 * just appeared, so only real transitions notify: changes requested, approved, ready to merge,
 * checks failed, new conflicts.
 */
export function diffMyPrs(
  prev: Record<string, MyPrSnapshot> | undefined,
  current: MyPullRequest[]
): { events: MyPrEvent[]; snapshot: Record<string, MyPrSnapshot> } {
  const snapshot: Record<string, MyPrSnapshot> = {}
  const events: MyPrEvent[] = []
  for (const pr of current) {
    const before = prev?.[pr.id]
    const next: MyPrSnapshot = {
      status: pr.status,
      readyNotifiedOid: before?.readyNotifiedOid,
      ci: pr.ci,
      ciFailedOid: before?.ciFailedOid,
      conflicts: pr.conflicts
    }
    if (before) {
      if (pr.readyToMerge && before.readyNotifiedOid !== pr.headOid) {
        events.push({ kind: 'my_pr_ready', pr })
        next.readyNotifiedOid = pr.headOid
      } else if (pr.status === 'changes_requested' && before.status !== 'changes_requested') {
        events.push({ kind: 'my_pr_changes_requested', pr, by: reviewersWith(pr, 'CHANGES_REQUESTED') })
      } else if (pr.status === 'approved' && before.status !== 'approved') {
        events.push({ kind: 'my_pr_approved', pr, by: reviewersWith(pr, 'APPROVED') })
      }
      // Failing checks and conflicts are news on their own, whatever the reviews say. A rerun that
      // fails again on the same head is not; a snapshot that never saw the checks is the baseline.
      if (pr.ci === 'failure' && before.ci !== undefined && before.ci !== 'failure' && before.ciFailedOid !== pr.headOid) {
        events.push({ kind: 'my_pr_ci_failed', pr, failing: failingChecks(pr) })
        next.ciFailedOid = pr.headOid
      }
      if (pr.conflicts && before.conflicts === false) events.push({ kind: 'my_pr_conflicts', pr })
    } else {
      // Already ready or failing when first seen: remember it so it isn't announced later.
      if (pr.readyToMerge) next.readyNotifiedOid = pr.headOid
      if (pr.ci === 'failure') next.ciFailedOid = pr.headOid
    }
    snapshot[pr.id] = next
  }
  return { events, snapshot }
}

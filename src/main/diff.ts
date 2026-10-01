import type { PullRequest } from '../shared/types'

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

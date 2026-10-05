/** Which actions the panel offers on a PR. Pure, so the renderer's decisions can be unit tested. */
import type { MyPullRequest, PullRequest } from './types'

export type MyPrMenuAction =
  | 'merge'
  | 'update_branch'
  | 'rerequest_review'
  | 'enable_auto_merge'
  | 'disable_auto_merge'
  /** PR Radar merges it itself once GitHub accepts a merge (repositories without auto-merge). */
  | 'arm_merge'
  | 'disarm_merge'
  | 'repo_settings'
  | 'copy_branch'
  | 'copy_link'
  | 'details'
  | 'open'

/**
 * Menu entries for one of your PRs. Write actions need a session that can write and the
 * matching repository permission; GitHub's own flags decide update-branch and auto-merge.
 * A merge is offered whenever GitHub would accept one, approvals or not. When GitHub's
 * auto-merge can't be enabled, PR Radar offers to merge the PR itself once it is ready.
 */
export function myPrMenuActions(pr: MyPullRequest, canWrite: boolean, armed = false): MyPrMenuAction[] {
  const items: MyPrMenuAction[] = []
  if (canWrite) {
    if (pr.mergeable && pr.can.merge && pr.merge.methods.length > 0) items.push('merge')
    if (pr.can.updateBranch) items.push('update_branch')
    if (pr.status === 'changes_requested' && pr.can.requestReviews && pr.reviews.some((r) => r.id)) {
      items.push('rerequest_review')
    }
    if (armed) items.push('disarm_merge')
    else if (pr.autoMerge) {
      if (pr.can.disableAutoMerge) items.push('disable_auto_merge')
    } else if (!pr.mergeable && !pr.isDraft) {
      if (pr.can.enableAutoMerge) items.push('enable_auto_merge')
      else if (pr.can.merge && pr.merge.methods.length > 0) items.push('arm_merge')
      if (!pr.can.enableAutoMerge && !pr.merge.autoMergeAllowed && pr.permission === 'ADMIN') items.push('repo_settings')
    }
  }
  if (pr.branch) items.push('copy_branch')
  items.push('copy_link', 'details', 'open')
  return items
}

export type ReviewMenuAction =
  | 'approve'
  | 'snooze_hour'
  | 'snooze_tomorrow'
  | 'snooze_push'
  | 'dismiss'
  | 'copy_branch'
  | 'copy_link'
  | 'details'
  | 'open'

/**
 * Context-menu entries for a review request. GitHub doesn't let you approve your own PR; a PR
 * you merely take part in can be dismissed but not snoozed (its reminders would talk about a
 * review nobody asked for).
 */
export function reviewMenuActions(pr: PullRequest, canWrite: boolean): ReviewMenuAction[] {
  const items: ReviewMenuAction[] = []
  if (canWrite && !pr.viewerDidAuthor) items.push('approve')
  if (pr.source.kind !== 'involved') items.push('snooze_hour', 'snooze_tomorrow', 'snooze_push')
  items.push('dismiss')
  if (pr.branch) items.push('copy_branch')
  items.push('copy_link', 'details', 'open')
  return items
}

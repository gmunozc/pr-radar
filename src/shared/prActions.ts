/** Which actions the panel offers on a PR. Pure, so the renderer's decisions can be unit tested. */
import type { MyPullRequest, PullRequest } from './types'

export type MyPrMenuAction =
  | 'merge'
  | 'update_branch'
  | 'rerequest_review'
  | 'enable_auto_merge'
  | 'disable_auto_merge'
  /** Disabled hint: the repository doesn't allow GitHub's auto-merge. */
  | 'no_auto_merge'
  | 'repo_settings'
  | 'copy_branch'
  | 'copy_link'
  | 'open'

/**
 * Menu entries for one of your PRs. Write actions need a session that can write and the
 * matching repository permission; GitHub's own flags decide update-branch and auto-merge.
 * A merge is offered whenever GitHub would accept one, approvals or not.
 */
export function myPrMenuActions(pr: MyPullRequest, canWrite: boolean): MyPrMenuAction[] {
  const items: MyPrMenuAction[] = []
  if (canWrite) {
    if (pr.mergeable && pr.can.merge && pr.merge.methods.length > 0) items.push('merge')
    if (pr.can.updateBranch) items.push('update_branch')
    if (pr.status === 'changes_requested' && pr.can.requestReviews && pr.reviews.some((r) => r.id)) {
      items.push('rerequest_review')
    }
    if (pr.autoMerge) {
      if (pr.can.disableAutoMerge) items.push('disable_auto_merge')
    } else if (!pr.mergeable && !pr.isDraft) {
      if (pr.can.enableAutoMerge) items.push('enable_auto_merge')
      else if (!pr.merge.autoMergeAllowed && pr.can.merge) {
        items.push('no_auto_merge')
        if (pr.permission === 'ADMIN') items.push('repo_settings')
      }
    }
  }
  if (pr.branch) items.push('copy_branch')
  items.push('copy_link', 'open')
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
  | 'open'

/** Context-menu entries for a review request. GitHub doesn't let you approve your own PR. */
export function reviewMenuActions(pr: PullRequest, canWrite: boolean): ReviewMenuAction[] {
  const items: ReviewMenuAction[] = []
  if (canWrite && !pr.viewerDidAuthor) items.push('approve')
  items.push('snooze_hour', 'snooze_tomorrow', 'snooze_push', 'dismiss')
  if (pr.branch) items.push('copy_branch')
  items.push('copy_link', 'open')
  return items
}

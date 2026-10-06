/** What PR Radar can notify about, and how each notification reads. Free of Electron APIs. */
import type { Translate } from '../shared/i18n'
import type { ActionErrorCode, MergeMethod, MyPullRequest, PullRequest, SnoozeOption } from '../shared/types'
import type { MyPrEvent, MyPrSnapshot, NotificationPlan } from './diff'

/** What happened while quiet hours held notifications back. */
export interface CatchUp {
  reviews: number
  reminders: number
  approved: number
  changes: number
  ready: number
  ciFailed: number
  conflicts: number
  merged: number
  mergeFailed: number
  sessionExpired: boolean
}

export type NotificationEvent =
  | MyPrEvent
  /** PR Radar merged a PR the user had armed. */
  | { kind: 'my_pr_merged'; pr: MyPullRequest; method: MergeMethod }
  | { kind: 'merge_failed'; pr: MyPullRequest; code: ActionErrorCode; detail?: string }
  | { kind: 'my_prs_grouped'; count: number }
  | { kind: 'snooze_returned'; prs: PullRequest[] }
  | { kind: 'update_available'; version: string; releaseUrl: string }
  | { kind: 'catch_up'; counts: CatchUp }
  | {
      kind: 'digest'
      reviews: number
      /** Age in whole days of the oldest pending review request. */
      oldestDays: number
      ready: number
      changes: number
      /** Alerts held back by quiet hours, folded into the digest. */
      caughtUp: CatchUp | null
    }
  | { kind: 'review_requested'; pr: PullRequest }
  | { kind: 'reviews_summary'; count: number }
  | { kind: 'reviews_grouped'; prs: PullRequest[] }
  | { kind: 'session_expired' }
  | { kind: 'test' }

export type NotificationAction =
  | { kind: 'open_url'; url: string }
  | { kind: 'open_panel' }
  | { kind: 'snooze'; prId: string; option: SnoozeOption }
  | { kind: 'dismiss'; prId: string }

export interface RenderedNotification {
  /** Posting again with the same id replaces the previous notification. */
  id?: string
  /** Notification Center stacks notifications with the same group: one per repository. */
  groupId?: string
  title: string
  /** Second line (macOS): where the PR is and who acted. Elsewhere it opens the body. */
  subtitle?: string
  body: string
  /** Picture shown next to the text: the avatar of whoever acted. */
  imageUrl?: string
  /** What a click does. */
  action: NotificationAction
  /** Extra buttons (macOS lists them under "Options" when hovering; Windows shows them outright). */
  buttons?: Array<{ label: string; action: NotificationAction }>
}

export function planToEvents(plan: NotificationPlan): NotificationEvent[] {
  switch (plan.kind) {
    case 'none':
      return []
    case 'summary':
      return [{ kind: 'reviews_summary', count: plan.count }]
    case 'individual':
      return plan.prs.map((pr) => ({ kind: 'review_requested', pr }))
    case 'grouped':
      return [{ kind: 'reviews_grouped', prs: plan.prs }]
  }
}

/*
 * Notification ids. Review requests and reminders use the PR id; your PRs get one id per topic,
 * so "checks failed" doesn't replace "changes requested" and each can be retired on its own.
 */
const myPrId = (prId: string) => `mine-${prId}`
const ciId = (prId: string) => `ci-${prId}`
const conflictsId = (prId: string) => `conflicts-${prId}`

/**
 * Delivered notifications that no longer apply after a poll, for the notifier to remove: review
 * requests that left the list (reviewed, merged, withdrawn), your PRs that are no longer open,
 * checks that are green again and conflicts that were solved. "Merged" reports are kept: the PR
 * leaving the list is exactly what they announce.
 */
export function staleNotifications(
  prevSeenIds: readonly string[],
  prs: readonly PullRequest[],
  prevMine: Readonly<Record<string, MyPrSnapshot>> | undefined,
  myPrs: readonly MyPullRequest[]
): string[] {
  const current = new Set(prs.map((p) => p.id))
  const ids = prevSeenIds.filter((id) => !current.has(id))
  const mine = new Map(myPrs.map((p) => [p.id, p]))
  for (const [id, before] of Object.entries(prevMine ?? {})) {
    const pr = mine.get(id)
    if (!pr) ids.push(myPrId(id), ciId(id), conflictsId(id))
    else {
      if (before.ci === 'failure' && pr.ci === 'success') ids.push(ciId(id))
      if (before.conflicts === true && !pr.conflicts) ids.push(conflictsId(id))
    }
  }
  return ids
}

/** Where a PR is, and who acted: "acme/app#12 · @ana, @bob". */
function where(pr: { repo: string; number: number }, who: string[] = []): string {
  const people = who.length ? ` · ${who.map((l) => `@${l}`).join(', ')}` : ''
  return `${pr.repo}#${pr.number}${people}`
}

const authorOf = (pr: PullRequest) => (pr.author ? [pr.author.login] : [])

/** The avatar to show, when GitHub gave us one. */
const picture = (url: string | undefined): Pick<RenderedNotification, 'imageUrl'> => (url ? { imageUrl: url } : {})

const reviewerAvatar = (pr: MyPullRequest, by: string[]) => pr.reviews.find((r) => r.login === by[0])?.avatarUrl || undefined

/** Buttons on a review request or reminder: the same choices as the panel, minus "until new commits". */
function reviewButtons(prId: string, t: Translate): RenderedNotification['buttons'] {
  return [
    { label: t('notif.actionSnooze'), action: { kind: 'snooze', prId, option: 'hour' } },
    { label: t('notif.actionSnoozeTomorrow'), action: { kind: 'snooze', prId, option: 'tomorrow' } },
    { label: t('notif.actionDismiss'), action: { kind: 'dismiss', prId } }
  ]
}

/** Two check names at most; the notification is not the place for the whole list. */
function failingList(names: string[]): string {
  const shown = names.slice(0, 2).join(', ')
  return names.length > 2 ? `${shown}…` : shown
}

/** More than this many updates on your PRs in one poll are summarized in one notification. */
export const MAX_MY_PR_NOTIFICATIONS = 3

export function capMyPrEvents(events: MyPrEvent[]): NotificationEvent[] {
  return events.length > MAX_MY_PR_NOTIFICATIONS ? [{ kind: 'my_prs_grouped', count: events.length }] : events
}

const openPanel: NotificationAction = { kind: 'open_panel' }

export function catchUpParts(c: CatchUp, t: Translate): string[] {
  const parts: string[] = []
  if (c.reviews) parts.push(t('notif.catchUpReviews', { count: c.reviews }))
  if (c.reminders) parts.push(t('notif.catchUpReminders', { count: c.reminders }))
  if (c.approved) parts.push(t('notif.catchUpApproved', { count: c.approved }))
  if (c.changes) parts.push(t('notif.catchUpChanges', { count: c.changes }))
  if (c.ready) parts.push(t('notif.catchUpReady', { count: c.ready }))
  if (c.ciFailed) parts.push(t('notif.catchUpCiFailed', { count: c.ciFailed }))
  if (c.conflicts) parts.push(t('notif.catchUpConflicts', { count: c.conflicts }))
  if (c.merged) parts.push(t('notif.catchUpMerged', { count: c.merged }))
  if (c.mergeFailed) parts.push(t('notif.catchUpMergeFailed', { count: c.mergeFailed }))
  if (c.sessionExpired) parts.push(t('notif.catchUpSession'))
  return parts
}

export function renderNotification(event: NotificationEvent, t: Translate): RenderedNotification {
  switch (event.kind) {
    case 'review_requested': {
      const { pr } = event
      const title = pr.newCommitsSinceReview
        ? t('notif.reReviewRequested')
        : pr.source.kind === 'team'
          ? pr.source.slug
            ? t('notif.reviewRequestedTeam', { slug: pr.source.slug })
            : t('notif.reviewRequestedTeamUnnamed')
          : t('notif.reviewRequested')
      return {
        id: pr.id,
        groupId: pr.repo,
        title,
        subtitle: where(pr, authorOf(pr)),
        body: pr.title,
        ...picture(pr.author?.avatarUrl),
        action: { kind: 'open_url', url: pr.url },
        buttons: reviewButtons(pr.id, t)
      }
    }
    case 'my_pr_changes_requested':
      return {
        id: myPrId(event.pr.id),
        groupId: event.pr.repo,
        title: t('notif.changesRequested'),
        subtitle: where(event.pr, event.by),
        body: event.pr.title,
        ...picture(reviewerAvatar(event.pr, event.by)),
        action: { kind: 'open_url', url: event.pr.url }
      }
    case 'my_pr_approved':
      return {
        id: myPrId(event.pr.id),
        groupId: event.pr.repo,
        title: t('notif.approved'),
        subtitle: where(event.pr, event.by),
        body: event.pr.title,
        ...picture(reviewerAvatar(event.pr, event.by)),
        action: { kind: 'open_url', url: event.pr.url }
      }
    case 'my_pr_ready':
      return {
        id: myPrId(event.pr.id),
        groupId: event.pr.repo,
        title: t('notif.readyToMerge'),
        subtitle: where(event.pr),
        body: event.pr.autoMerge ? `${event.pr.title} · ${t('notif.readyAutoMerge')}` : event.pr.title,
        action: { kind: 'open_url', url: event.pr.url }
      }
    case 'my_pr_ci_failed': {
      const { pr, failing } = event
      return {
        id: ciId(pr.id),
        groupId: pr.repo,
        title: t('notif.ciFailed'),
        subtitle: where(pr),
        body: failing.length ? `${pr.title} · ${t('notif.ciFailing', { names: failingList(failing) })}` : pr.title,
        // GitHub's own checks tab: the checks' detail pages may be on other sites.
        action: { kind: 'open_url', url: `${pr.url}/checks` }
      }
    }
    case 'my_pr_conflicts': {
      const { pr } = event
      return {
        id: conflictsId(pr.id),
        groupId: pr.repo,
        title: t('notif.conflicts'),
        subtitle: where(pr),
        body: pr.baseBranch ? `${pr.title} · ${t('notif.conflictsWith', { branch: pr.baseBranch })}` : pr.title,
        action: { kind: 'open_url', url: pr.url }
      }
    }
    case 'my_pr_merged':
      return {
        id: `merged-${event.pr.id}`,
        groupId: event.pr.repo,
        title: t('notif.merged', { method: t(`action.method.${event.method}`) }),
        subtitle: where(event.pr),
        body: event.pr.title,
        action: { kind: 'open_url', url: event.pr.url }
      }
    case 'merge_failed':
      return {
        id: myPrId(event.pr.id),
        groupId: event.pr.repo,
        title: t('notif.mergeFailed'),
        subtitle: where(event.pr),
        body: `${event.pr.title} · ${t(`action.error.${event.code}`, { detail: event.detail ?? '' })}`,
        action: { kind: 'open_url', url: event.pr.url }
      }
    case 'my_prs_grouped':
      return { title: 'PR Radar', body: t('notif.myPrsGrouped', { count: event.count }), action: openPanel }
    case 'snooze_returned': {
      if (event.prs.length !== 1) {
        return { title: 'PR Radar', body: t('notif.snoozeReturnedMany', { count: event.prs.length }), action: openPanel }
      }
      const [pr] = event.prs
      return {
        id: pr.id,
        groupId: pr.repo,
        title: t('notif.snoozeReturned'),
        subtitle: where(pr, authorOf(pr)),
        body: pr.title,
        ...picture(pr.author?.avatarUrl),
        action: { kind: 'open_url', url: pr.url },
        buttons: reviewButtons(pr.id, t)
      }
    }
    case 'update_available':
      return {
        id: 'pr-radar-update',
        title: t('notif.updateTitle', { version: event.version }),
        body: t('notif.updateBody'),
        action: { kind: 'open_url', url: event.releaseUrl }
      }
    case 'catch_up':
      return { id: 'pr-radar-catch-up', title: t('notif.catchUpTitle'), body: catchUpParts(event.counts, t).join(' · '), action: openPanel }
    case 'digest': {
      const lines: string[] = []
      if (event.reviews) {
        const oldest = event.oldestDays >= 1 ? ` ${t('notif.digestOldest', { count: event.oldestDays })}` : ''
        lines.push(t('notif.digestReviews', { count: event.reviews }) + oldest)
      }
      if (event.ready) lines.push(t('notif.digestReady', { count: event.ready }))
      if (event.changes) lines.push(t('notif.digestChanges', { count: event.changes }))
      const caught = event.caughtUp ? catchUpParts(event.caughtUp, t) : []
      const body = [caught.length ? t('notif.catchUpPrefix', { summary: caught.join(', ') }) : '', lines.join(' · ')]
        .filter(Boolean)
        .join(' ')
      return { id: 'pr-radar-digest', title: t('notif.digestTitle'), body, action: openPanel }
    }
    case 'reviews_summary':
      return { title: 'PR Radar', body: t('notif.summary', { count: event.count }), action: openPanel }
    case 'reviews_grouped':
      return {
        title: t('notif.grouped', { count: event.prs.length }),
        body: event.prs.slice(0, 3).map((pr) => `${pr.repo}#${pr.number}`).join(', ') + '…',
        action: openPanel
      }
    case 'session_expired':
      return { id: 'pr-radar-logged-out', title: 'PR Radar', body: t('notif.sessionExpired'), action: openPanel }
    case 'test':
      // The button doubles as a check that buttons show up on this machine.
      return {
        id: 'pr-radar-test',
        title: 'PR Radar',
        body: t('notif.test'),
        action: openPanel,
        buttons: [{ label: t('notif.actionOpen'), action: openPanel }]
      }
  }
}

/** What PR Radar can notify about, and how each notification reads. Free of Electron APIs. */
import type { Translate } from '../shared/i18n'
import type { MyPullRequest, PullRequest } from '../shared/types'
import type { MyPrEvent, NotificationPlan } from './diff'

/** What happened while quiet hours held notifications back. */
export interface CatchUp {
  reviews: number
  reminders: number
  approved: number
  changes: number
  ready: number
  sessionExpired: boolean
}

export type NotificationEvent =
  | MyPrEvent
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

export type NotificationAction = { kind: 'open_url'; url: string } | { kind: 'open_panel' }

export interface RenderedNotification {
  /** Posting again with the same id replaces the previous notification. */
  id?: string
  title: string
  body: string
  action: NotificationAction
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

function describe(pr: PullRequest): string {
  const author = pr.author ? ` — @${pr.author.login}` : ''
  return `${pr.repo}#${pr.number} · ${pr.title}${author}`
}

function describeMine(pr: MyPullRequest, by: string[] = []): string {
  const who = by.length ? ` — ${by.map((l) => `@${l}`).join(', ')}` : ''
  return `${pr.repo}#${pr.number} · ${pr.title}${who}`
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
      return { id: pr.id, title, body: describe(pr), action: { kind: 'open_url', url: pr.url } }
    }
    case 'my_pr_changes_requested':
      return {
        id: `mine-${event.pr.id}`,
        title: t('notif.changesRequested'),
        body: describeMine(event.pr, event.by),
        action: { kind: 'open_url', url: event.pr.url }
      }
    case 'my_pr_approved':
      return {
        id: `mine-${event.pr.id}`,
        title: t('notif.approved'),
        body: describeMine(event.pr, event.by),
        action: { kind: 'open_url', url: event.pr.url }
      }
    case 'my_pr_ready':
      return {
        id: `mine-${event.pr.id}`,
        title: t('notif.readyToMerge'),
        body: describeMine(event.pr),
        action: { kind: 'open_url', url: event.pr.url }
      }
    case 'my_prs_grouped':
      return { title: 'PR Radar', body: t('notif.myPrsGrouped', { count: event.count }), action: openPanel }
    case 'snooze_returned':
      return event.prs.length === 1
        ? {
            id: event.prs[0].id,
            title: t('notif.snoozeReturned'),
            body: describe(event.prs[0]),
            action: { kind: 'open_url', url: event.prs[0].url }
          }
        : { title: 'PR Radar', body: t('notif.snoozeReturnedMany', { count: event.prs.length }), action: openPanel }
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
      return { id: 'pr-radar-test', title: 'PR Radar', body: t('notif.test'), action: openPanel }
  }
}

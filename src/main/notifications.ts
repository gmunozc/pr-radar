/** What PR Radar can notify about, and how each notification reads. Free of Electron APIs. */
import type { Translate } from '../shared/i18n'
import type { PullRequest } from '../shared/types'
import type { NotificationPlan } from './diff'

export type NotificationEvent =
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

const openPanel: NotificationAction = { kind: 'open_panel' }

export function renderNotification(event: NotificationEvent, t: Translate): RenderedNotification {
  switch (event.kind) {
    case 'review_requested': {
      const { pr } = event
      const title =
        pr.source.kind === 'team'
          ? pr.source.slug
            ? t('notif.reviewRequestedTeam', { slug: pr.source.slug })
            : t('notif.reviewRequestedTeamUnnamed')
          : t('notif.reviewRequested')
      return { id: pr.id, title, body: describe(pr), action: { kind: 'open_url', url: pr.url } }
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

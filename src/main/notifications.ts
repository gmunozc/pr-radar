/** What PR Radar can notify about, and how each notification reads. Free of Electron APIs. */
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

export function renderNotification(event: NotificationEvent): RenderedNotification {
  switch (event.kind) {
    case 'review_requested': {
      const { pr } = event
      const title =
        pr.source.kind === 'team'
          ? `Review solicitada a tu equipo${pr.source.slug ? ` ${pr.source.slug}` : ''}`
          : 'Nueva review solicitada'
      return { id: pr.id, title, body: describe(pr), action: { kind: 'open_url', url: pr.url } }
    }
    case 'reviews_summary':
      return {
        title: 'PR Radar',
        body: event.count === 1 ? 'Tienes 1 PR pendiente de revisar' : `Tienes ${event.count} PRs pendientes de revisar`,
        action: openPanel
      }
    case 'reviews_grouped':
      return {
        title: `${event.prs.length} nuevas reviews solicitadas`,
        body: event.prs.slice(0, 3).map((pr) => `${pr.repo}#${pr.number}`).join(', ') + '…',
        action: openPanel
      }
    case 'session_expired':
      return {
        id: 'pr-radar-logged-out',
        title: 'PR Radar',
        body: 'Tu sesión de GitHub expiró. Vuelve a conectar tu cuenta.',
        action: openPanel
      }
    case 'test':
      return { id: 'pr-radar-test', title: 'PR Radar', body: 'Las notificaciones funcionan correctamente.', action: openPanel }
  }
}

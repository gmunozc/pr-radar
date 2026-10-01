import { Notification, shell } from 'electron'
import type { PullRequest } from '../shared/types'
import type { NotificationPlan } from './diff'

// Keep references so macOS click handlers survive garbage collection.
const live = new Set<Notification>()

function show(title: string, body: string, onClick: () => void): void {
  if (!Notification.isSupported()) return
  const n = new Notification({ title, body, silent: false })
  live.add(n)
  n.on('click', () => {
    onClick()
    live.delete(n)
  })
  n.on('close', () => live.delete(n))
  n.show()
}

function describe(pr: PullRequest): string {
  const author = pr.author ? ` — @${pr.author.login}` : ''
  return `${pr.repo}#${pr.number} · ${pr.title}${author}`
}

export function notify(plan: NotificationPlan, openPanel: () => void): void {
  switch (plan.kind) {
    case 'none':
      return
    case 'summary':
      show(
        'PR Radar',
        plan.count === 1 ? 'Tienes 1 PR pendiente de revisar' : `Tienes ${plan.count} PRs pendientes de revisar`,
        openPanel
      )
      return
    case 'individual':
      for (const pr of plan.prs) {
        const title = pr.source.kind === 'team' ? `Review solicitada a tu equipo${pr.source.slug ? ` ${pr.source.slug}` : ''}` : 'Nueva review solicitada'
        show(title, describe(pr), () => void shell.openExternal(pr.url))
      }
      return
    case 'grouped':
      show(
        `${plan.prs.length} nuevas reviews solicitadas`,
        plan.prs.slice(0, 3).map((pr) => `${pr.repo}#${pr.number}`).join(', ') + '…',
        openPanel
      )
      return
  }
}

export function notifyLoggedOut(openPanel: () => void): void {
  show('PR Radar', 'Tu sesión de GitHub expiró. Vuelve a conectar tu cuenta.', openPanel)
}

export function testNotification(openPanel: () => void): void {
  show('PR Radar', 'Las notificaciones funcionan correctamente.', openPanel)
}

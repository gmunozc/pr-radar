import { Notification, shell } from 'electron'
import type { NotifyResult, PullRequest } from '../shared/types'
import type { NotificationPlan } from './diff'

// Keep references so macOS click handlers survive garbage collection.
const live = new Set<Notification>()

// How long to wait for the OS to confirm or reject a notification.
const CONFIRM_TIMEOUT_MS = 4000

// Posting again with the same id replaces the previous notification instead of stacking it.
function show(title: string, body: string, onClick: () => void, id?: string): Promise<NotifyResult> {
  if (!Notification.isSupported()) {
    return Promise.resolve({ ok: false, error: 'Este sistema no soporta notificaciones.' })
  }
  const n = new Notification({ title, body, silent: false, groupId: 'pr-radar', ...(id ? { id } : {}) })
  live.add(n)
  n.on('click', () => {
    onClick()
    live.delete(n)
  })
  n.on('close', () => live.delete(n))

  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ ok: true }), CONFIRM_TIMEOUT_MS)
    n.once('show', () => {
      clearTimeout(timer)
      resolve({ ok: true })
    })
    n.once('failed', (_e, error) => {
      clearTimeout(timer)
      live.delete(n)
      console.error('[notify] failed:', error)
      resolve({ ok: false, error })
    })
    n.show()
  })
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
      void show(
        'PR Radar',
        plan.count === 1 ? 'Tienes 1 PR pendiente de revisar' : `Tienes ${plan.count} PRs pendientes de revisar`,
        openPanel
      )
      return
    case 'individual':
      for (const pr of plan.prs) {
        const title = pr.source.kind === 'team' ? `Review solicitada a tu equipo${pr.source.slug ? ` ${pr.source.slug}` : ''}` : 'Nueva review solicitada'
        void show(title, describe(pr), () => void shell.openExternal(pr.url), pr.id)
      }
      return
    case 'grouped':
      void show(
        `${plan.prs.length} nuevas reviews solicitadas`,
        plan.prs.slice(0, 3).map((pr) => `${pr.repo}#${pr.number}`).join(', ') + '…',
        openPanel
      )
      return
  }
}

export function notifyLoggedOut(openPanel: () => void): void {
  void show('PR Radar', 'Tu sesión de GitHub expiró. Vuelve a conectar tu cuenta.', openPanel, 'pr-radar-logged-out')
}

export function testNotification(openPanel: () => void): Promise<NotifyResult> {
  return show('PR Radar', 'Las notificaciones funcionan correctamente.', openPanel, 'pr-radar-test')
}

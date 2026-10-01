import { Notification, shell } from 'electron'
import type { NotifyResult } from '../shared/types'
import { t } from './i18n'
import { logger } from './log'
import { renderNotification, type NotificationEvent, type RenderedNotification } from './notifications'

// Keep references so macOS click handlers survive garbage collection.
const live = new Set<Notification>()

// How long to wait for the OS to confirm or reject a notification.
const CONFIRM_TIMEOUT_MS = 4000

/** Shows a native notification; posting again with the same id replaces the previous one. */
export function deliver(n: RenderedNotification, openPanel: () => void): Promise<NotifyResult> {
  if (!Notification.isSupported()) {
    return Promise.resolve({ ok: false, error: 'unsupported' })
  }
  const notification = new Notification({
    title: n.title,
    body: n.body,
    silent: false,
    groupId: 'pr-radar',
    ...(n.id ? { id: n.id } : {})
  })
  live.add(notification)
  notification.on('click', () => {
    if (n.action.kind === 'open_url') void shell.openExternal(n.action.url)
    else openPanel()
    live.delete(notification)
  })
  notification.on('close', () => live.delete(notification))

  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ ok: true }), CONFIRM_TIMEOUT_MS)
    notification.once('show', () => {
      clearTimeout(timer)
      resolve({ ok: true })
    })
    notification.once('failed', (_e, error) => {
      clearTimeout(timer)
      live.delete(notification)
      logger.error('notification failed', error)
      resolve({ ok: false, error })
    })
    notification.show()
  })
}

export function deliverEvents(events: NotificationEvent[], openPanel: () => void): void {
  for (const event of events) void deliver(renderNotification(event, t), openPanel)
}

export function testNotification(openPanel: () => void): Promise<NotifyResult> {
  return deliver(renderNotification({ kind: 'test' }, t), openPanel)
}

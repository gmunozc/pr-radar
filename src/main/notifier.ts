import { Notification, shell } from 'electron'
import type { NotifyResult } from '../shared/types'
import { t } from './i18n'
import { logger } from './log'
import { renderNotification, type NotificationAction, type NotificationEvent, type RenderedNotification } from './notifications'

// Keep references so macOS click handlers survive garbage collection.
const live = new Set<Notification>()

// How long to wait for the OS to confirm or reject a notification.
const CONFIRM_TIMEOUT_MS = 4000

/**
 * Buttons on notifications. macOS only shows them for apps signed with a Developer ID, which
 * these builds aren't, so they stay off unless the build says otherwise.
 */
const BUTTONS_ENABLED = import.meta.env.MAIN_VITE_NOTIFICATION_ACTIONS === '1'

export interface NotificationHandlers {
  openPanel(): void
  /** Runs a button's action (e.g. snooze a review request). */
  perform?(action: NotificationAction): void
}

/** Shows a native notification; posting again with the same id replaces the previous one. */
export function deliver(n: RenderedNotification, handlers: NotificationHandlers | (() => void)): Promise<NotifyResult> {
  const h: NotificationHandlers = typeof handlers === 'function' ? { openPanel: handlers } : handlers
  if (!Notification.isSupported()) {
    return Promise.resolve({ ok: false, error: 'unsupported' })
  }
  const buttons = BUTTONS_ENABLED && process.platform !== 'linux' ? (n.buttons ?? []) : []
  const notification = new Notification({
    title: n.title,
    body: n.body,
    silent: false,
    groupId: 'pr-radar',
    ...(n.id ? { id: n.id } : {}),
    ...(buttons.length ? { actions: buttons.map((b) => ({ type: 'button' as const, text: b.label })) } : {})
  })
  live.add(notification)
  const run = (action: NotificationAction) => {
    if (action.kind === 'open_url') void shell.openExternal(action.url)
    else if (action.kind === 'open_panel') h.openPanel()
    else h.perform?.(action)
    live.delete(notification)
  }
  notification.on('click', () => run(n.action))
  notification.on('action', (_e, index) => {
    const button = buttons[index]
    if (button) run(button.action)
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

export function deliverEvents(events: NotificationEvent[], handlers: NotificationHandlers): void {
  for (const event of events) void deliver(renderNotification(event, t), handlers)
}

export function testNotification(openPanel: () => void): Promise<NotifyResult> {
  return deliver(renderNotification({ kind: 'test' }, t), openPanel)
}

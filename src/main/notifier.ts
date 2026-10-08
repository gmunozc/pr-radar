import { nativeImage, net, Notification, shell, type NativeImage } from 'electron'
import type { NotifyResult } from '../shared/types'
import { t } from './i18n'
import { logger } from './log'
import { renderNotification, type NotificationAction, type NotificationEvent, type RenderedNotification } from './notifications'

// Keep references so macOS click handlers survive garbage collection.
const live = new Set<Notification>()

// How long to wait for the OS to confirm or reject a notification.
const CONFIRM_TIMEOUT_MS = 4000

// Avatars shown next to the text: fetched once per URL, never worth delaying a notification for long.
const AVATAR_TIMEOUT_MS = 1500
const AVATAR_CACHE_MAX = 100
const AVATAR_HOST = 'https://avatars.githubusercontent.com/'
const avatars = new Map<string, Promise<NativeImage | null>>()

/**
 * macOS shows notification buttons only for signed apps with NSUserNotificationAlertStyle "alert"
 * in their Info.plist. Since Electron moved to the UNUserNotification framework, a signature is
 * also what it takes to show any notification at all, and the ad-hoc signature of the release
 * builds satisfies both. Linux has no buttons.
 */
const BUTTONS_SUPPORTED = process.platform !== 'linux'

export interface NotificationHandlers {
  openPanel(): void
  /** A click on an alert about one PR; without it, the PR opens on GitHub. */
  openPr?(prId: string, url: string): void
  /** Runs a button's action (snooze or dismiss a review request). */
  perform?(action: NotificationAction): void
}

/** Shows a native notification; posting again with the same id replaces the previous one. */
export async function deliver(n: RenderedNotification, handlers: NotificationHandlers | (() => void)): Promise<NotifyResult> {
  const h: NotificationHandlers = typeof handlers === 'function' ? { openPanel: handlers } : handlers
  if (!Notification.isSupported()) return { ok: false, error: 'unsupported' }
  const buttons = BUTTONS_SUPPORTED ? (n.buttons ?? []) : []
  const icon = n.imageUrl ? await avatar(n.imageUrl) : null
  // Only macOS has a subtitle line; elsewhere it opens the body.
  const mac = process.platform === 'darwin'
  const notification = new Notification({
    title: n.title,
    ...(mac && n.subtitle ? { subtitle: n.subtitle } : {}),
    body: !mac && n.subtitle ? `${n.subtitle}\n${n.body}` : n.body,
    silent: false,
    groupId: n.groupId ?? 'pr-radar',
    ...(n.id ? { id: n.id } : {}),
    ...(icon ? { icon } : {}),
    ...(buttons.length ? { actions: buttons.map((b) => ({ type: 'button' as const, text: b.label })) } : {})
  })
  live.add(notification)
  const run = (action: NotificationAction) => {
    if (action.kind === 'open_url') void shell.openExternal(action.url)
    else if (action.kind === 'open_pr') {
      if (h.openPr) h.openPr(action.prId, action.url)
      else void shell.openExternal(action.url)
    } else if (action.kind === 'open_panel') h.openPanel()
    else h.perform?.(action)
    live.delete(notification)
  }
  notification.on('click', () => run(n.action))
  notification.on('action', (details) => {
    const button = buttons[details.actionIndex]
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

/** Removes delivered notifications that no longer apply (the PR was reviewed, merged, dismissed, …). */
export function retire(ids: string[]): void {
  if (!ids.length) return
  const gone = new Set(ids)
  for (const n of live) {
    if (gone.has(n.id)) {
      n.close()
      live.delete(n)
    }
  }
  // Also the ones delivered by a previous run of the app, which only Notification Center remembers.
  if (process.platform === 'darwin') Notification.remove(ids)
}

/** Removes every notification PR Radar delivered (on sign-out). */
export function retireAll(): void {
  for (const n of live) n.close()
  live.clear()
  if (process.platform === 'darwin') Notification.removeAll()
}

/** A GitHub avatar as an image for the notification, or null when it can't be fetched in time. */
function avatar(url: string): Promise<NativeImage | null> {
  if (!url.startsWith(AVATAR_HOST)) return Promise.resolve(null)
  let pending = avatars.get(url)
  if (!pending) {
    if (avatars.size >= AVATAR_CACHE_MAX) avatars.clear()
    pending = fetchAvatar(url).then((image) => {
      // Try again next time rather than remembering a failure.
      if (!image) avatars.delete(url)
      return image
    })
    avatars.set(url, pending)
  }
  return pending
}

async function fetchAvatar(url: string): Promise<NativeImage | null> {
  try {
    const sized = new URL(url)
    if (!sized.searchParams.has('s')) sized.searchParams.set('s', '128')
    const res = await net.fetch(sized.toString(), { signal: AbortSignal.timeout(AVATAR_TIMEOUT_MS) })
    if (!res.ok) return null
    const image = nativeImage.createFromBuffer(Buffer.from(await res.arrayBuffer()))
    return image.isEmpty() ? null : image
  } catch (err) {
    logger.debug('avatar not available for the notification', err)
    return null
  }
}

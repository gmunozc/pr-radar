/** What the menu bar icon shows for a given app state. Pure, so it can be tested. */
import type { AppState } from '../shared/types'

export type TrayIcon = 'idle' | 'active' | 'offline' | 'alert'

export type TrayStatus =
  | { kind: 'ok' }
  | { kind: 'signed_out' }
  | { kind: 'session_expired' }
  | { kind: 'offline' }
  | { kind: 'rate_limited'; retryAt?: number }
  | { kind: 'error' }

export interface TrayVisual {
  icon: TrayIcon
  /** Number next to the icon, or null for none. */
  count: number | null
  status: TrayStatus
}

/**
 * Precedence: alert (must reconnect) > dimmed (offline, rate limited, GitHub errors) > count.
 * While dimmed the count stays visible: it is the last known (stale) value.
 */
export function trayVisual(state: AppState): TrayVisual {
  if (state.status === 'logged_out') {
    return state.authNotice
      ? { icon: 'alert', count: null, status: { kind: 'session_expired' } }
      : { icon: 'idle', count: null, status: { kind: 'signed_out' } }
  }
  const pending = state.status === 'ready' || state.status === 'error' ? state.prs.length : 0
  const count = pending > 0 ? pending : null
  switch (state.connection) {
    case 'offline':
      return { icon: 'offline', count, status: { kind: 'offline' } }
    case 'rate_limited':
      return { icon: 'offline', count, status: { kind: 'rate_limited', retryAt: state.error?.retryAt } }
    case 'error':
      return { icon: 'offline', count, status: { kind: 'error' } }
    default:
      return { icon: count ? 'active' : 'idle', count, status: { kind: 'ok' } }
  }
}

/** What the menu bar icon shows for a given app state. Pure, so it can be tested. */
import type { AppState } from '../shared/types'

export type TrayIcon = 'idle' | 'active' | 'ready' | 'offline' | 'alert'

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
  /** Your PRs GitHub would merge right now. */
  ready: number
  status: TrayStatus
}

/**
 * Precedence: alert (must reconnect) > dimmed (offline, rate limited, GitHub errors) > a PR of
 * yours ready to merge > count. While dimmed the count stays visible: it is the last known
 * (stale) value.
 */
export function trayVisual(state: AppState): TrayVisual {
  if (state.status === 'logged_out') {
    return state.authNotice
      ? { icon: 'alert', count: null, ready: 0, status: { kind: 'session_expired' } }
      : { icon: 'idle', count: null, ready: 0, status: { kind: 'signed_out' } }
  }
  const known = state.status === 'ready' || state.status === 'error'
  const pending = known ? state.prs.length : 0
  const count = pending > 0 ? pending : null
  const ready = known ? state.myPrs.filter((p) => p.readyToMerge).length : 0
  switch (state.connection) {
    case 'offline':
      return { icon: 'offline', count, ready, status: { kind: 'offline' } }
    case 'rate_limited':
      return { icon: 'offline', count, ready, status: { kind: 'rate_limited', retryAt: state.error?.retryAt } }
    case 'error':
      return { icon: 'offline', count, ready, status: { kind: 'error' } }
    default:
      return { icon: ready > 0 ? 'ready' : count ? 'active' : 'idle', count, ready, status: { kind: 'ok' } }
  }
}

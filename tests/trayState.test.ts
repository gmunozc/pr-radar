import { describe, expect, it } from 'vitest'
import { loggedOutState } from '../src/main/engine'
import { trayVisual } from '../src/main/trayState'
import type { AppState, PullRequest } from '../src/shared/types'

const prs = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `PR_${i}` }) as PullRequest)
const ready = (over: Partial<AppState> = {}): AppState => ({
  ...loggedOutState(),
  status: 'ready',
  viewer: { login: 'me', avatarUrl: '' },
  lastUpdated: '2026-10-01T12:00:00Z',
  ...over
})

describe('trayVisual', () => {
  it('shows the count when everything is fine', () => {
    expect(trayVisual(ready({ prs: prs(3) }))).toEqual({ icon: 'active', count: 3, status: { kind: 'ok' } })
    expect(trayVisual(ready())).toEqual({ icon: 'idle', count: null, status: { kind: 'ok' } })
  })

  it('dims the icon but keeps the (stale) count while offline or rate limited', () => {
    expect(trayVisual(ready({ prs: prs(2), connection: 'offline' }))).toEqual({
      icon: 'offline',
      count: 2,
      status: { kind: 'offline' }
    })
    expect(
      trayVisual(ready({ connection: 'rate_limited', error: { code: 'rate_limited', retryAt: 123 } }))
    ).toMatchObject({ icon: 'offline', status: { kind: 'rate_limited', retryAt: 123 } })
    expect(trayVisual(ready({ connection: 'error' })).status).toEqual({ kind: 'error' })
  })

  it('alerts when the session expired, without a count', () => {
    expect(trayVisual(loggedOutState('session_expired'))).toEqual({
      icon: 'alert',
      count: null,
      status: { kind: 'session_expired' }
    })
    expect(trayVisual(loggedOutState('keychain_denied')).icon).toBe('alert')
  })

  it('is plain when signed out on purpose', () => {
    expect(trayVisual(loggedOutState())).toEqual({ icon: 'idle', count: null, status: { kind: 'signed_out' } })
  })
})

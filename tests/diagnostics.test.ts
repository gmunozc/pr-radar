import { describe, expect, it } from 'vitest'
import { buildDiagnostics, type DiagnosticsInput } from '../src/main/diagnostics'
import { loggedOutState } from '../src/main/engine'
import { DEFAULT_SETTINGS } from '../src/shared/types'

const input = (over: Partial<DiagnosticsInput> = {}): DiagnosticsInput => ({
  app: { version: '0.3.0', packaged: true },
  versions: { electron: '44.5.1', chrome: '146.0', node: '24.0' },
  os: { platform: 'darwin', arch: 'arm64', release: '26.1' },
  locales: ['es-CL', 'en-US'],
  displays: [
    { id: 1, bounds: { x: 0, y: 0, width: 2056, height: 1329 }, scaleFactor: 2, primary: true },
    { id: 3, bounds: { x: -1920, y: 0, width: 1920, height: 1080 }, scaleFactor: 1, primary: false }
  ],
  panelDisplayId: 3,
  settings: { ...DEFAULT_SETTINGS, clientId: 'Ov23liSECRETISH' },
  clientIdConfigured: true,
  auth: {
    v: 2,
    method: 'oauth_app',
    clientId: 'Ov23liSECRETISH',
    login: 'octo',
    accessToken: 'gho_FAKEaccessTOKENforTESTSonly0000000',
    expiresAt: Date.UTC(2026, 9, 2, 4, 41),
    refreshToken: 'ghr_FAKErefreshTOKENforTESTSonly000000000',
    refreshTokenExpiresAt: Date.UTC(2027, 3, 1),
    updatedAt: Date.UTC(2026, 9, 1, 20, 41)
  },
  state: { ...loggedOutState(), status: 'ready', lastUpdated: '2026-10-01T20:42:00.000Z' },
  consecutiveFailures: 0,
  notificationsSupported: true,
  logs: [{ time: '2026-10-01T20:40:00.000Z', level: 'warn', message: 'poll failed Bearer gho_leakedtoken123456' }],
  now: Date.UTC(2026, 9, 1, 21, 0),
  ...over
})

describe('buildDiagnostics', () => {
  it('includes what is needed to debug common problems', () => {
    const text = buildDiagnostics(input())
    expect(text).toContain('PR Radar 0.3.0 (packaged)')
    expect(text).toContain('darwin 26.1 (arm64)')
    expect(text).toContain('#3 1920x1080@1x at (-1920,0)')
    expect(text).toContain('Panel last shown on display 3')
    expect(text).toContain('login=octo')
    expect(text).toContain('expires=2026-10-02T04:41:00.000Z')
    expect(text).toContain('refresh=yes')
    expect(text).toContain('clientId=configured')
  })

  it('never contains tokens or the client ID', () => {
    const text = buildDiagnostics(input())
    expect(text).not.toMatch(/FAKEaccess|FAKErefresh|leakedtoken|SECRETISH/)
    expect(text).toContain('token=gho_…')
  })

  it('handles a signed-out app', () => {
    expect(buildDiagnostics(input({ auth: null, state: loggedOutState('session_expired') }))).toContain('Session none')
  })
})

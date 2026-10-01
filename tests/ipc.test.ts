import { describe, expect, it, vi } from 'vitest'

// ipc.ts imports electron for its handlers; only the pure helpers are tested here.
vi.mock('electron', () => ({ app: {}, ipcMain: {}, shell: {}, Notification: class {} }))

const { isAllowedExternalUrl, sanitizeSettingsPatch } = await import('../src/main/ipc')

describe('isAllowedExternalUrl', () => {
  it('only allows https GitHub URLs', () => {
    expect(isAllowedExternalUrl('https://github.com/acme/app/pull/1')).toBe(true)
    expect(isAllowedExternalUrl('https://github.com/login/device')).toBe(true)
    expect(isAllowedExternalUrl('http://github.com/acme')).toBe(false)
    expect(isAllowedExternalUrl('https://github.com.evil.io/x')).toBe(false)
    expect(isAllowedExternalUrl('file:///etc/passwd')).toBe(false)
    expect(isAllowedExternalUrl('not a url')).toBe(false)
  })
})

describe('sanitizeSettingsPatch', () => {
  it('keeps known fields with the right types and clamps the interval', () => {
    expect(
      sanitizeSettingsPatch({ includeTeams: false, pollIntervalSec: 3, clientId: '  abc ', evil: 1, notifications: 'yes' })
    ).toEqual({ includeTeams: false, pollIntervalSec: 15, clientId: 'abc' })
    expect(sanitizeSettingsPatch({ pollIntervalSec: 99999 })).toEqual({ pollIntervalSec: 3600 })
    expect(sanitizeSettingsPatch(null)).toEqual({})
  })
})

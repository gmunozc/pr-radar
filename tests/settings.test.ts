import { describe, expect, it } from 'vitest'
import { normalizeSettings, sanitizeSettingsPatch } from '../src/main/settings'
import { DEFAULT_SETTINGS } from '../src/shared/types'

describe('sanitizeSettingsPatch', () => {
  it('keeps known fields with the right types and clamps the interval', () => {
    expect(
      sanitizeSettingsPatch({ includeTeams: false, pollIntervalSec: 3, clientId: '  abc ', evil: 1, notifications: 'yes' })
    ).toEqual({ includeTeams: false, pollIntervalSec: 15, clientId: 'abc' })
    expect(sanitizeSettingsPatch({ pollIntervalSec: 99999 })).toEqual({ pollIntervalSec: 3600 })
    expect(sanitizeSettingsPatch(null)).toEqual({})
  })
})

describe('normalizeSettings', () => {
  it('fills in defaults and drops invalid or unknown values from settings.json', () => {
    expect(
      normalizeSettings({ includeTeams: false, pollIntervalSec: 'fast', junk: true, openAtLogin: true, language: 'system' })
    ).toEqual({ ...DEFAULT_SETTINGS, includeTeams: false })
  })

  it('keeps Spanish for settings written before the language option existed', () => {
    expect(normalizeSettings({ includeTeams: true }).language).toBe('es')
    expect(normalizeSettings({ language: 'en' }).language).toBe('en')
    expect(normalizeSettings({}).language).toBe('system')
  })

  it('survives a missing or corrupt file', () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS)
    expect(normalizeSettings('oops')).toEqual(DEFAULT_SETTINGS)
  })
})

describe('schedule settings', () => {
  it('accepts valid times and day lists', () => {
    expect(sanitizeSettingsPatch({ workStart: '08:30', workEnd: '17:45', digestTime: '09:05', workDays: [5, 1, 1, 3] })).toEqual({
      workStart: '08:30',
      workEnd: '17:45',
      digestTime: '09:05',
      workDays: [1, 3, 5]
    })
    expect(sanitizeSettingsPatch({ quietHours: true, digest: false })).toEqual({ quietHours: true, digest: false })
  })

  it('rejects malformed times and empty or invalid day lists', () => {
    expect(sanitizeSettingsPatch({ workStart: '9:00', workEnd: '24:00', digestTime: 'soon', workDays: [] })).toEqual({})
    expect(sanitizeSettingsPatch({ workDays: [7, -1, 2.5, 'x'] })).toEqual({})
  })
})

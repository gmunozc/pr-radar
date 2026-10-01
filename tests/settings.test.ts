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
    expect(normalizeSettings({ includeTeams: false, pollIntervalSec: 'fast', junk: true, openAtLogin: true })).toEqual({
      ...DEFAULT_SETTINGS,
      includeTeams: false
    })
  })

  it('survives a missing or corrupt file', () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS)
    expect(normalizeSettings('oops')).toEqual(DEFAULT_SETTINGS)
  })
})

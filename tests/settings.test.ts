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

describe('exclusions and list settings', () => {
  it('keeps valid repository and author lists, trimmed and unique', () => {
    expect(
      sanitizeSettingsPatch({
        hideBots: true,
        excludeRepos: [' acme/app ', 'acme/app', 'bad repo', 7],
        excludeAuthors: ['octo', 'app/renovate', 'bad user']
      })
    ).toEqual({ hideBots: true, excludeRepos: ['acme/app'], excludeAuthors: ['octo', 'app/renovate'] })
    expect(sanitizeSettingsPatch({ excludeRepos: 'acme/app' })).toEqual({})
    expect(sanitizeSettingsPatch({ excludeRepos: Array.from({ length: 40 }, (_, i) => `acme/r${i}`) }).excludeRepos).toHaveLength(30)
  })

  it('only accepts shortcuts from the closed list', () => {
    expect(sanitizeSettingsPatch({ shortcut: 'Alt+Shift+P', showInvolved: false })).toEqual({ shortcut: 'Alt+Shift+P', showInvolved: false })
    expect(sanitizeSettingsPatch({ shortcut: '' })).toEqual({ shortcut: '' })
    expect(sanitizeSettingsPatch({ shortcut: 'Control+Q' })).toEqual({})
    expect(sanitizeSettingsPatch({ panelSize: 'large' })).toEqual({ panelSize: 'large' })
    expect(sanitizeSettingsPatch({ panelSize: 'huge' })).toEqual({})
  })

  it('clamps stale days and only accepts known filter and sort values', () => {
    expect(sanitizeSettingsPatch({ staleAfterDays: 99, reviewFilter: 'team', reviewSort: 'oldest' })).toEqual({
      staleAfterDays: 30,
      reviewFilter: 'team',
      reviewSort: 'oldest'
    })
    expect(sanitizeSettingsPatch({ staleAfterDays: -2, reviewFilter: 'mine', reviewSort: 'random' })).toEqual({ staleAfterDays: 0 })
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

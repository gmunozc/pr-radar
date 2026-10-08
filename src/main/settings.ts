import { DEFAULT_SETTINGS, FAST_POLL_OPTIONS, MIN_POLL_INTERVAL_SEC, NOTIFY_KINDS, SHORTCUT_OPTIONS, type Settings } from '../shared/types'

export type SettingsPatch = Partial<Settings> & { openAtLogin?: boolean }

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/
/** "owner/name", as GitHub allows them. */
const REPO = /^[\w.-]+\/[\w.-]+$/
/** A user login, or "app/<slug>" for a GitHub App bot as search queries name them. */
const AUTHOR = /^(app\/)?[A-Za-z0-9-]+$/
export const MAX_EXCLUSIONS = 30
export const MAX_STALE_DAYS = 30

/** Unique, trimmed entries that match `pattern`, at most MAX_EXCLUSIONS of them. */
function exclusionList(v: unknown, pattern: RegExp): string[] | undefined {
  if (!Array.isArray(v)) return undefined
  const clean = v
    .filter((x): x is string => typeof x === 'string')
    .map((x) => x.trim())
    .filter((x) => pattern.test(x))
  return [...new Set(clean)].slice(0, MAX_EXCLUSIONS)
}

/** Keeps only known settings with the right types; used for IPC input and settings.json. */
export function sanitizeSettingsPatch(patch: unknown): SettingsPatch {
  if (!patch || typeof patch !== 'object') return {}
  const p = patch as Record<string, unknown>
  const out: SettingsPatch = {}
  for (const key of [
    'includeTeams',
    'notifications',
    'showDrafts',
    'hideBots',
    'showInvolved',
    'notifyMyPrs',
    'quietHours',
    'digest',
    'checkUpdates',
    'openAtLogin'
  ] as const) {
    if (typeof p[key] === 'boolean') out[key] = p[key]
  }
  if (typeof p.pollIntervalSec === 'number' && Number.isFinite(p.pollIntervalSec)) {
    out.pollIntervalSec = Math.min(3600, Math.max(MIN_POLL_INTERVAL_SEC, Math.round(p.pollIntervalSec)))
  }
  if (typeof p.fastPoll === 'number' && (FAST_POLL_OPTIONS as readonly number[]).includes(p.fastPoll)) out.fastPoll = p.fastPoll
  if (p.notifyKinds && typeof p.notifyKinds === 'object' && !Array.isArray(p.notifyKinds)) {
    const kinds = p.notifyKinds as Record<string, unknown>
    out.notifyKinds = Object.fromEntries(
      NOTIFY_KINDS.map((k) => [k, typeof kinds[k] === 'boolean' ? kinds[k] : DEFAULT_SETTINGS.notifyKinds[k]])
    ) as Settings['notifyKinds']
  }
  if (typeof p.staleAfterDays === 'number' && Number.isFinite(p.staleAfterDays)) {
    out.staleAfterDays = Math.min(MAX_STALE_DAYS, Math.max(0, Math.round(p.staleAfterDays)))
  }
  const repos = exclusionList(p.excludeRepos, REPO)
  if (repos) out.excludeRepos = repos
  const authors = exclusionList(p.excludeAuthors, AUTHOR)
  if (authors) out.excludeAuthors = authors
  if (p.reviewFilter === 'all' || p.reviewFilter === 'direct' || p.reviewFilter === 'team') out.reviewFilter = p.reviewFilter
  if (p.reviewSort === 'newest' || p.reviewSort === 'oldest' || p.reviewSort === 'updated') out.reviewSort = p.reviewSort
  if (typeof p.shortcut === 'string' && (SHORTCUT_OPTIONS as readonly string[]).includes(p.shortcut)) out.shortcut = p.shortcut
  if (p.panelSize === 'compact' || p.panelSize === 'default' || p.panelSize === 'large') out.panelSize = p.panelSize
  if (typeof p.clientId === 'string') out.clientId = p.clientId.trim()
  if (p.language === 'system' || p.language === 'en' || p.language === 'es') out.language = p.language
  for (const key of ['workStart', 'workEnd', 'digestTime'] as const) {
    if (typeof p[key] === 'string' && TIME.test(p[key])) out[key] = p[key]
  }
  if (Array.isArray(p.workDays)) {
    const days = [...new Set(p.workDays.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6))].sort()
    if (days.length > 0) out.workDays = days
  }
  return out
}

/**
 * Settings read from disk: defaults for anything missing or invalid. Versions before 0.4
 * were Spanish-only, so an existing settings file without `language` keeps Spanish instead
 * of switching to the system language on upgrade.
 */
export function normalizeSettings(raw: unknown): Settings {
  const { openAtLogin: _openAtLogin, ...clean } = sanitizeSettingsPatch(raw)
  const upgrading = !!raw && typeof raw === 'object' && Object.keys(raw).length > 0 && !('language' in raw)
  return { ...DEFAULT_SETTINGS, ...(upgrading ? { language: 'es' as const } : {}), ...clean }
}

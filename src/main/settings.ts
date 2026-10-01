import { DEFAULT_SETTINGS, MIN_POLL_INTERVAL_SEC, type Settings } from '../shared/types'

export type SettingsPatch = Partial<Settings> & { openAtLogin?: boolean }

/** Keeps only known settings with the right types; used for IPC input and settings.json. */
export function sanitizeSettingsPatch(patch: unknown): SettingsPatch {
  if (!patch || typeof patch !== 'object') return {}
  const p = patch as Record<string, unknown>
  const out: SettingsPatch = {}
  for (const key of ['includeTeams', 'notifications', 'showDrafts', 'notifyMyPrs', 'openAtLogin'] as const) {
    if (typeof p[key] === 'boolean') out[key] = p[key]
  }
  if (typeof p.pollIntervalSec === 'number' && Number.isFinite(p.pollIntervalSec)) {
    out.pollIntervalSec = Math.min(3600, Math.max(MIN_POLL_INTERVAL_SEC, Math.round(p.pollIntervalSec)))
  }
  if (typeof p.clientId === 'string') out.clientId = p.clientId.trim()
  if (p.language === 'system' || p.language === 'en' || p.language === 'es') out.language = p.language
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

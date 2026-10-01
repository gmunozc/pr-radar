/** What PR Radar remembers between polls and restarts (state.json), per GitHub account. */
export interface PersistedState {
  v: 2
  login: string
  /** PR ids already seen, to tell which review requests are new. */
  seenIds: string[]
  dismissedIds: string[]
}

const stringArray = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

/** Reads state.json in any version written so far (v1 had no `v` and optional dismissals). */
export function migrateState(raw: unknown): PersistedState | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.login !== 'string' || !Array.isArray(r.seenIds)) return null
  return { v: 2, login: r.login, seenIds: stringArray(r.seenIds), dismissedIds: stringArray(r.dismissedIds) }
}

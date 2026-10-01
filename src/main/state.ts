import type { MyPrSnapshot } from './diff'

/** What PR Radar remembers between polls and restarts (state.json), per GitHub account. */
export interface PersistedState {
  v: 2
  login: string
  /** PR ids already seen, to tell which review requests are new. */
  seenIds: string[]
  dismissedIds: string[]
  /** Your PRs as of the last poll; missing means "take a silent baseline". */
  myPrs?: Record<string, MyPrSnapshot>
}

function snapshot(v: unknown): Record<string, MyPrSnapshot> | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined
  const out: Record<string, MyPrSnapshot> = {}
  for (const [id, raw] of Object.entries(v as Record<string, unknown>)) {
    const r = raw as Partial<MyPrSnapshot> | null
    if (!r || typeof r.status !== 'string') continue
    out[id] = {
      status: r.status,
      ...(typeof r.readyNotifiedOid === 'string' ? { readyNotifiedOid: r.readyNotifiedOid } : {})
    }
  }
  return out
}

const stringArray = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

/** Reads state.json in any version written so far (v1 had no `v` and optional dismissals). */
export function migrateState(raw: unknown): PersistedState | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.login !== 'string' || !Array.isArray(r.seenIds)) return null
  const myPrs = snapshot(r.myPrs)
  return {
    v: 2,
    login: r.login,
    seenIds: stringArray(r.seenIds),
    dismissedIds: stringArray(r.dismissedIds),
    ...(myPrs ? { myPrs } : {})
  }
}

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
  /** PR id → epoch ms when a snoozed review request comes back. */
  snoozed: Record<string, number>
  /** PR id → head commit when it was snoozed "until new commits"; it comes back when the head changes. */
  snoozedUntilPush: Record<string, string>
  /** Notifications held back by quiet hours, delivered together when they end. */
  queued: QueuedAlerts
  /** Local day ("YYYY-MM-DD") the last daily digest was handled. */
  lastDigestDay: string | null
}

/** PR ids per kind of alert held back during quiet hours. */
export interface QueuedAlerts {
  reviews: string[]
  reminders: string[]
  approved: string[]
  changes: string[]
  ready: string[]
  sessionExpired: boolean
}

export const emptyQueue = (): QueuedAlerts => ({
  reviews: [],
  reminders: [],
  approved: [],
  changes: [],
  ready: [],
  sessionExpired: false
})

function queue(v: unknown): QueuedAlerts {
  const r = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
  return {
    reviews: stringArray(r.reviews),
    reminders: stringArray(r.reminders),
    approved: stringArray(r.approved),
    changes: stringArray(r.changes),
    ready: stringArray(r.ready),
    sessionExpired: r.sessionExpired === true
  }
}

function snoozes(v: unknown): Record<string, number> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {}
  return Object.fromEntries(
    Object.entries(v as Record<string, unknown>).filter((e): e is [string, number] => typeof e[1] === 'number' && Number.isFinite(e[1]))
  )
}

function oids(v: unknown): Record<string, string> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {}
  return Object.fromEntries(
    Object.entries(v as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === 'string' && e[1] !== '')
  )
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
    ...(myPrs ? { myPrs } : {}),
    snoozed: snoozes(r.snoozed),
    snoozedUntilPush: oids(r.snoozedUntilPush),
    queued: queue(r.queued),
    lastDigestDay: typeof r.lastDigestDay === 'string' ? r.lastDigestDay : null
  }
}

import { describe, expect, it, vi } from 'vitest'
import { DeviceFlowError, type TokenSet } from '../src/main/deviceFlow'
import { Engine, type EngineDeps } from '../src/main/engine'
import { GithubError, type FetchResult } from '../src/main/github'
import type { Logger } from '../src/main/log'
import type { NotificationEvent } from '../src/main/notifications'
import { Session, type StoredAuth } from '../src/main/session'
import {
  DEFAULT_SETTINGS,
  type AppState,
  type MyPullRequest,
  type PullRequest,
  type Settings,
  type Warning
} from '../src/shared/types'

const HOUR = 3_600_000
const NOW = 100 * HOUR
const silent: Logger = { debug() {}, info() {}, warn() {}, error() {} }

const pr = (id: string): PullRequest => ({
  id,
  number: 1,
  title: `PR ${id}`,
  url: `https://github.com/acme/app/pull/${id}`,
  repo: 'acme/app',
  author: { login: 'octo', avatarUrl: '' },
  isDraft: false,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  additions: 1,
  deletions: 1,
  headOid: 'h',
  ci: 'none',
  source: { kind: 'direct' },
  lastReviewAt: null,
  newCommitsSinceReview: false
})

const myPr = (id: string, over: Partial<MyPullRequest> = {}): MyPullRequest => ({
  ...pr(id),
  status: 'waiting',
  pendingReviewers: [],
  reviews: [],
  readyToMerge: false,
  blocker: null,
  conflicts: false,
  ...over
})

const result = (ids: string[], login = 'me', warnings: Warning[] = [], myPrs: MyPullRequest[] = []): FetchResult => ({
  viewer: { login, avatarUrl: '' },
  prs: ids.map(pr),
  myPrs,
  warnings
})

const auth = (over: Partial<StoredAuth> = {}): StoredAuth => ({
  v: 2,
  method: 'oauth_app',
  clientId: 'client-1',
  accessToken: 'gho_old',
  expiresAt: NOW + 8 * HOUR,
  refreshToken: 'ghr_old',
  refreshTokenExpiresAt: NOW + 1000 * HOUR,
  updatedAt: 0,
  ...over
})

interface Options {
  stored?: unknown
  auth?: StoredAuth | null
  refresh?: (clientId: string, refreshToken: string) => Promise<TokenSet>
  settings?: Partial<Settings>
  online?: () => boolean
  now?: number
}

function setup(responses: Array<FetchResult | Error>, opts: Options = {}) {
  let stored: unknown = opts.stored ?? null
  let authValue: StoredAuth | null = opts.auth === undefined ? auth() : opts.auth
  const refresh =
    opts.refresh ??
    vi.fn(async () => ({ accessToken: 'gho_new', expiresAt: NOW + 8 * HOUR, refreshToken: 'ghr_new', refreshTokenExpiresAt: null }))
  let clock = opts.now ?? NOW
  const session = new Session({
    store: { load: () => authValue, save: (a) => (authValue = a), clear: () => (authValue = null) },
    refresh,
    now: () => clock,
    log: silent
  })
  const queue = [...responses]
  const fetchPullRequests = vi.fn(async (token: string, _settings?: Settings, _login?: string) => {
    const next = queue.shift()
    if (!next) throw new Error(`unexpected fetch with ${token}`)
    if (next instanceof Error) throw next
    return next
  })
  const events: NotificationEvent[] = []
  const published: AppState[] = []
  const settings: Settings = { ...DEFAULT_SETTINGS, ...opts.settings }
  const onSessionEnded = vi.fn()
  const deps: EngineDeps = {
    now: () => clock,
    settings: () => settings,
    session,
    fetchPullRequests,
    stateStore: { read: () => stored, write: (s) => (stored = s), remove: () => (stored = null) },
    notify: (e) => events.push(...e),
    publish: (s) => published.push(s),
    onSessionEnded,
    isOnline: opts.online ?? (() => true),
    locale: () => 'es',
    log: silent
  }
  const engine = new Engine(deps)
  return {
    engine,
    setNow: (t: number) => (clock = t),
    events,
    published,
    fetchPullRequests,
    refresh,
    onSessionEnded,
    session,
    get stored() {
      return stored as { login: string; seenIds: string[]; dismissedIds: string[] } | null
    }
  }
}

describe('Engine polling and notifications', () => {
  it('sends a single summary on the first poll and remembers the PRs', async () => {
    const t = setup([result(['a', 'b'])])
    await t.engine.poll()
    expect(t.events).toEqual([{ kind: 'reviews_summary', count: 2 }])
    expect(t.stored).toMatchObject({ v: 2, login: 'me', seenIds: ['a', 'b'], dismissedIds: [] })
    expect(t.engine.state).toMatchObject({ status: 'ready', viewer: { login: 'me' }, lastUpdated: new Date(NOW).toISOString() })
    expect(t.engine.state.prs.map((p) => p.id)).toEqual(['a', 'b'])
  })

  it('notifies new review requests individually, and groups more than three', async () => {
    const t = setup([result(['a']), result(['a', 'b']), result(['a', 'b', 'c', 'd', 'e', 'f'])])
    await t.engine.poll()
    t.events.length = 0
    await t.engine.poll()
    expect(t.events).toEqual([{ kind: 'review_requested', pr: pr('b') }])
    t.events.length = 0
    await t.engine.poll()
    expect(t.events).toMatchObject([{ kind: 'reviews_grouped' }])
  })

  it('notifies again when a review is requested again after leaving the list', async () => {
    const t = setup([result(['a', 'b']), result(['a']), result(['a', 'b'])])
    await t.engine.poll()
    await t.engine.poll()
    t.events.length = 0
    await t.engine.poll()
    expect(t.events).toEqual([{ kind: 'review_requested', pr: pr('b') }])
  })

  it('does not notify for PRs that appear because the filters changed', async () => {
    const t = setup([result(['a']), result(['a', 'b', 'c'])])
    await t.engine.poll()
    t.events.length = 0
    t.engine.filtersChanged()
    await t.engine.poll()
    expect(t.events).toEqual([])
    expect(t.stored?.seenIds).toEqual(['a', 'b', 'c'])
  })

  it('starts a fresh baseline when another account signs in', async () => {
    const t = setup([result(['a'], 'me')], { stored: { v: 2, login: 'someone-else', seenIds: ['a'], dismissedIds: ['a'] } })
    await t.engine.poll()
    expect(t.events).toEqual([{ kind: 'reviews_summary', count: 1 }])
    expect(t.engine.state.dismissedCount).toBe(0)
  })

  it('migrates state.json from 0.2.x without re-notifying', async () => {
    const t = setup([result(['a'])], { stored: { login: 'me', seenIds: ['a'] } })
    await t.engine.poll()
    expect(t.events).toEqual([])
  })

  it('stays silent when notifications are turned off', async () => {
    const t = setup([result(['a']), result(['a', 'b'])], { settings: { notifications: false } })
    await t.engine.poll()
    await t.engine.poll()
    expect(t.events).toEqual([])
  })
})

describe('Engine dismissals', () => {
  it('hides dismissed PRs, persists them and restores them without notifying', async () => {
    const t = setup([result(['a', 'b']), result(['a', 'b'])])
    await t.engine.poll()
    t.events.length = 0

    t.engine.dismiss('a')
    expect(t.engine.state.prs.map((p) => p.id)).toEqual(['b'])
    expect(t.engine.state.dismissedCount).toBe(1)
    expect(t.stored?.dismissedIds).toEqual(['a'])

    await t.engine.poll()
    expect(t.engine.state.prs.map((p) => p.id)).toEqual(['b'])

    t.engine.restoreHidden()
    expect(t.engine.state.prs.map((p) => p.id)).toEqual(['a', 'b'])
    expect(t.engine.state.dismissedCount).toBe(0)
    expect(t.events).toEqual([])
  })
})

describe('Engine sessions', () => {
  it('renews the token once on 401 and retries', async () => {
    const t = setup([new GithubError('unauthorized', 'expired'), result(['a'])])
    await t.engine.poll()
    expect(t.refresh).toHaveBeenCalledTimes(1)
    expect(t.fetchPullRequests.mock.calls.map((c) => c[0])).toEqual(['gho_old', 'gho_new'])
    expect(t.engine.state.status).toBe('ready')
  })

  it('ends the session after a second 401 but keeps the stored state', async () => {
    const t = setup([result(['a']), new GithubError('unauthorized', 'x'), new GithubError('unauthorized', 'x')])
    await t.engine.poll()
    t.engine.dismiss('a')
    t.events.length = 0

    await t.engine.poll()
    expect(t.engine.state).toMatchObject({ status: 'logged_out', authNotice: 'session_expired' })
    expect(t.session.current).toBeNull()
    expect(t.onSessionEnded).toHaveBeenCalledTimes(1)
    expect(t.events).toEqual([{ kind: 'session_expired' }])
    expect(t.stored).toMatchObject({ login: 'me', seenIds: ['a'], dismissedIds: ['a'] })
  })

  it('explains when the app cannot renew tokens', async () => {
    const refresh = vi.fn().mockRejectedValue(new DeviceFlowError('refresh_unsupported', 'needs secret'))
    const t = setup([], { auth: auth({ expiresAt: NOW + 60_000 }), refresh })
    await t.engine.poll()
    expect(t.engine.state).toMatchObject({ status: 'logged_out', authNotice: 'refresh_unsupported' })
  })

  it('wipes the stored state on an explicit logout', async () => {
    const t = setup([result(['a'])])
    await t.engine.poll()
    t.engine.logout()
    expect(t.stored).toBeNull()
    expect(t.session.current).toBeNull()
    expect(t.engine.state).toMatchObject({ status: 'logged_out', authNotice: null })
    expect(t.onSessionEnded).toHaveBeenCalledTimes(1)
  })

  it('does nothing while signed out', async () => {
    const t = setup([], { auth: null })
    await expect(t.engine.poll()).resolves.toBeUndefined()
    expect(t.fetchPullRequests).not.toHaveBeenCalled()
    expect(t.engine.state.status).toBe('logged_out')
  })

  it('shows session warnings next to GitHub warnings', async () => {
    const t = setup([result(['a'], 'me', [{ code: 'saml' }])])
    t.engine.loggedIn({ code: 'refresh_unsupported' })
    await t.engine.poll()
    expect(t.engine.state.warnings).toEqual([{ code: 'saml' }, { code: 'refresh_unsupported' }])
  })

  it('publishes the UI language with every state', async () => {
    const t = setup([result(['a'])])
    await t.engine.poll()
    expect(t.published.every((s) => s.locale === 'es')).toBe(true)
  })
})

describe('Engine errors', () => {
  it('keeps the last data on network errors and reports rate-limit retry times', async () => {
    const t = setup([
      result(['a']),
      new GithubError('network', 'offline'),
      new GithubError('rate_limited', 'slow down', NOW + 600_000)
    ])
    await t.engine.poll()
    await expect(t.engine.poll()).resolves.toEqual({ retryAt: undefined })
    expect(t.engine.state).toMatchObject({ status: 'ready', error: { code: 'network', detail: 'offline' } })
    expect(t.engine.state.prs.map((p) => p.id)).toEqual(['a'])
    expect(t.engine.consecutiveFailures).toBe(1)

    await expect(t.engine.poll()).resolves.toEqual({ retryAt: NOW + 600_000 })
    expect(t.engine.consecutiveFailures).toBe(2)
  })

  it('reports an error state when the very first poll fails', async () => {
    const t = setup([new GithubError('network', 'offline')])
    await t.engine.poll()
    expect(t.engine.state).toMatchObject({ status: 'error', error: { code: 'network', detail: 'offline' } })
  })
})

describe('Engine connection state', () => {
  it('only reports offline after two network failures in a row', async () => {
    const t = setup([result(['a']), new GithubError('network', 'x'), new GithubError('network', 'x'), result(['a'])])
    await t.engine.poll()
    await t.engine.poll()
    expect(t.engine.state.connection).toBe('ok')
    await t.engine.poll()
    expect(t.engine.state.connection).toBe('offline')
    await t.engine.poll()
    expect(t.engine.state.connection).toBe('ok')
  })

  it('reports offline right away when the OS says there is no network', async () => {
    const t = setup([result(['a']), new GithubError('network', 'x')], { online: () => false })
    await t.engine.poll()
    await t.engine.poll()
    expect(t.engine.state.connection).toBe('offline')
  })

  it('reports rate limits and other GitHub errors immediately, keeping the retry time', async () => {
    const t = setup([result(['a']), new GithubError('rate_limited', 'x', NOW + 60_000), new GithubError('unknown', 'boom')])
    await t.engine.poll()
    await t.engine.poll()
    expect(t.engine.state).toMatchObject({ connection: 'rate_limited', error: { code: 'rate_limited', retryAt: NOW + 60_000 } })
    await t.engine.poll()
    expect(t.engine.state.connection).toBe('error')
  })
})

describe('Engine and your own PRs', () => {
  const approved = myPr('m1', { status: 'approved', reviews: [{ login: 'ana', avatarUrl: '', state: 'APPROVED' }] })

  it('notifies about your PRs after the first poll, and passes your login to the query', async () => {
    const t = setup([result([], 'me', [], [myPr('m1')]), result([], 'me', [], [approved])])
    await t.engine.poll()
    expect(t.events).toEqual([])
    await t.engine.poll()
    expect(t.events).toMatchObject([{ kind: 'my_pr_approved', by: ['ana'] }])
    expect(t.fetchPullRequests.mock.calls[1][2]).toBe('me')
  })

  it('respects the "updates on my PRs" setting', async () => {
    const t = setup([result([], 'me', [], [myPr('m1')]), result([], 'me', [], [approved])], { settings: { notifyMyPrs: false } })
    await t.engine.poll()
    await t.engine.poll()
    expect(t.events).toEqual([])
  })

  it('takes a silent baseline for state written by 0.4.x (no snapshot of your PRs)', async () => {
    const t = setup([result(['a'], 'me', [], [approved])], { stored: { v: 2, login: 'me', seenIds: ['a'], dismissedIds: [] } })
    await t.engine.poll()
    expect(t.events).toEqual([])
    expect(t.stored).toMatchObject({ myPrs: { m1: { status: 'approved' } } })
  })

  it('summarizes many updates at once', async () => {
    const ids = ['m1', 'm2', 'm3', 'm4']
    const t = setup([result([], 'me', [], ids.map((id) => myPr(id))), result([], 'me', [], ids.map((id) => myPr(id, { status: 'approved' })))])
    await t.engine.poll()
    await t.engine.poll()
    expect(t.events).toEqual([{ kind: 'my_prs_grouped', count: 4 }])
  })
})

// 2026-10-05 is a Monday; tests run with TZ=UTC.
const at = (day: number, hhmm: string) => Date.parse(`2026-10-${String(day).padStart(2, '0')}T${hhmm}:00Z`)
const fresh = (over: Partial<StoredAuth> = {}) => auth({ expiresAt: null, refreshToken: null, ...over })

describe('Engine snooze', () => {
  it('hides a snoozed PR, then brings it back with a reminder', async () => {
    const t = setup([result(['a', 'b'])], { auth: fresh(), now: at(5, '10:00') })
    await t.engine.poll()
    t.events.length = 0

    t.engine.snooze('a', 'hour')
    expect(t.engine.state.prs.map((p) => p.id)).toEqual(['b'])
    expect(t.engine.state.snoozedCount).toBe(1)
    expect(t.stored).toMatchObject({ snoozed: { a: at(5, '11:00') } })

    t.setNow(at(5, '10:59'))
    t.engine.tick()
    expect(t.events).toEqual([])
    t.setNow(at(5, '11:00'))
    t.engine.tick()
    expect(t.engine.state.prs.map((p) => p.id)).toEqual(['a', 'b'])
    expect(t.events).toEqual([{ kind: 'snooze_returned', prs: [pr('a')] }])
  })

  it('snoozes "tomorrow" to the next working morning and restores without notifying', async () => {
    const t = setup([result(['a'])], { auth: fresh(), now: at(9, '17:00') })
    await t.engine.poll()
    t.engine.snooze('a', 'tomorrow')
    expect(t.stored).toMatchObject({ snoozed: { a: at(12, '09:00') } })
    expect(t.engine.state.snoozeTomorrowAt).toBe(at(12, '09:00'))
    t.events.length = 0
    t.engine.restoreHidden()
    expect(t.engine.state.prs.map((p) => p.id)).toEqual(['a'])
    expect(t.engine.state.snoozedCount).toBe(0)
    expect(t.events).toEqual([])
  })
})

describe('Engine quiet hours', () => {
  const quiet = { quietHours: true, digest: false }

  it('holds alerts back and sends one catch-up when working hours start', async () => {
    const mine = (status: MyPullRequest['status']) => myPr('m1', { status })
    const t = setup([result(['a'], 'me', [], [mine('waiting')]), result(['a', 'b', 'c'], 'me', [], [mine('approved')])], {
      auth: fresh(),
      settings: quiet,
      now: at(5, '07:00')
    })
    await t.engine.poll()
    await t.engine.poll()
    expect(t.events).toEqual([])
    expect(t.stored).toMatchObject({ queued: { reviews: ['b', 'c'], approved: ['m1'] } })
    expect(t.engine.state.quietUntil).toBe(at(5, '09:00'))

    t.setNow(at(5, '09:00'))
    t.engine.tick()
    expect(t.events).toEqual([
      { kind: 'catch_up', counts: { reviews: 2, reminders: 0, approved: 1, changes: 0, ready: 0, sessionExpired: false } }
    ])
    expect(t.stored).toMatchObject({ queued: { reviews: [], approved: [] } })
    expect(t.engine.state.quietUntil).toBeNull()
  })

  it('drops held-back alerts that no longer apply', async () => {
    const t = setup([result(['a']), result(['a', 'b']), result(['a'])], { auth: fresh(), settings: quiet, now: at(5, '07:00') })
    await t.engine.poll()
    await t.engine.poll()
    await t.engine.poll()
    t.setNow(at(5, '09:00'))
    t.engine.tick()
    expect(t.events).toEqual([])
  })

  it('folds held-back alerts into the digest when it is due soon after', async () => {
    const t = setup([result(['a']), result(['a', 'b'])], {
      auth: fresh(),
      settings: { quietHours: true, digest: true, digestTime: '09:30' },
      now: at(5, '07:00')
    })
    await t.engine.poll()
    await t.engine.poll()
    t.setNow(at(5, '09:00'))
    t.engine.tick()
    expect(t.events).toMatchObject([{ kind: 'digest', reviews: 2, caughtUp: { reviews: 1 } }])
    expect(t.stored).toMatchObject({ lastDigestDay: '2026-10-05' })
  })
})

describe('Engine daily digest', () => {
  it('sends one digest a day with what is pending', async () => {
    const created = (id: string, iso: string) => ({ ...pr(id), createdAt: iso })
    const res: FetchResult = { ...result([]), prs: [created('a', '2026-10-01T10:00:00Z'), created('b', '2026-10-04T10:00:00Z')] }
    const t = setup([res, res], { auth: fresh(), now: at(5, '09:31') })
    await t.engine.poll()
    expect(t.events).toEqual([
      { kind: 'reviews_summary', count: 2 },
      { kind: 'digest', reviews: 2, oldestDays: 3, ready: 0, changes: 0, caughtUp: null }
    ])
    t.events.length = 0
    t.setNow(at(5, '09:40'))
    await t.engine.poll()
    expect(t.events).toEqual([])
  })

  it('skips the digest when nothing is pending, and waits for fresh data', async () => {
    const t = setup([result([])], { auth: fresh(), now: at(5, '09:31') })
    await t.engine.poll()
    expect(t.events).toEqual([])
    expect(t.stored).toMatchObject({ lastDigestDay: '2026-10-05' })

    const u = setup([result(['a'])], { auth: fresh(), now: at(5, '08:00') })
    await u.engine.poll()
    u.events.length = 0
    u.setNow(at(5, '09:31'))
    u.engine.tick()
    expect(u.events).toEqual([])
  })
})

import { describe, expect, it, vi } from 'vitest'
import { DeviceFlowError, type TokenSet } from '../src/main/deviceFlow'
import { Engine, type EngineDeps } from '../src/main/engine'
import { GithubError, type FetchResult } from '../src/main/github'
import type { Logger } from '../src/main/log'
import type { NotificationEvent } from '../src/main/notifications'
import { Session, type StoredAuth } from '../src/main/session'
import { DEFAULT_SETTINGS, type AppState, type PullRequest, type Settings } from '../src/shared/types'

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
  source: { kind: 'direct' }
})

const result = (ids: string[], login = 'me', warnings: string[] = []): FetchResult => ({
  viewer: { login, avatarUrl: '' },
  prs: ids.map(pr),
  myPrs: [],
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
}

function setup(responses: Array<FetchResult | Error>, opts: Options = {}) {
  let stored: unknown = opts.stored ?? null
  let authValue: StoredAuth | null = opts.auth === undefined ? auth() : opts.auth
  const refresh =
    opts.refresh ??
    vi.fn(async () => ({ accessToken: 'gho_new', expiresAt: NOW + 8 * HOUR, refreshToken: 'ghr_new', refreshTokenExpiresAt: null }))
  const session = new Session({
    store: { load: () => authValue, save: (a) => (authValue = a), clear: () => (authValue = null) },
    refresh,
    now: () => NOW,
    log: silent
  })
  const queue = [...responses]
  const fetchPullRequests = vi.fn(async (token: string) => {
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
    now: () => NOW,
    settings: () => settings,
    session,
    fetchPullRequests,
    stateStore: { read: () => stored, write: (s) => (stored = s), remove: () => (stored = null) },
    notify: (e) => events.push(...e),
    publish: (s) => published.push(s),
    onSessionEnded,
    log: silent
  }
  const engine = new Engine(deps)
  return {
    engine,
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

    t.engine.restoreDismissed()
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
    const t = setup([result(['a'], 'me', ['from github'])])
    t.engine.loggedIn('renewal disabled')
    await t.engine.poll()
    expect(t.engine.state.warnings).toEqual(['from github', 'renewal disabled'])
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
    expect(t.engine.state).toMatchObject({ status: 'ready', error: { kind: 'network' } })
    expect(t.engine.state.prs.map((p) => p.id)).toEqual(['a'])
    expect(t.engine.consecutiveFailures).toBe(1)

    await expect(t.engine.poll()).resolves.toEqual({ retryAt: NOW + 600_000 })
    expect(t.engine.consecutiveFailures).toBe(2)
  })

  it('reports an error state when the very first poll fails', async () => {
    const t = setup([new GithubError('network', 'offline')])
    await t.engine.poll()
    expect(t.engine.state).toMatchObject({ status: 'error', error: { kind: 'network', message: 'offline' } })
  })
})

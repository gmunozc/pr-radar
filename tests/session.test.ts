import { describe, expect, it, vi } from 'vitest'
import { DeviceFlowError, type TokenSet } from '../src/main/deviceFlow'
import type { Logger } from '../src/main/log'
import {
  parseStoredAuth,
  REFRESH_MARGIN_MS,
  serializeAuth,
  Session,
  SessionExpiredError,
  type AuthStore,
  type StoredAuth
} from '../src/main/session'

const HOUR = 3_600_000
const silent: Logger = { debug() {}, info() {}, warn() {}, error() {} }

function memoryStore(initial: StoredAuth | null = null) {
  let value = initial
  const saves: StoredAuth[] = []
  const store: AuthStore = {
    load: () => value,
    save: (a) => {
      value = a
      saves.push(a)
    },
    clear: () => {
      value = null
    }
  }
  return { store, saves, get value() {
    return value
  } }
}

const stored = (over: Partial<StoredAuth> = {}): StoredAuth => ({
  v: 2,
  method: 'oauth_app',
  clientId: 'client-1',
  accessToken: 'gho_old',
  expiresAt: 10 * HOUR,
  refreshToken: 'ghr_old',
  refreshTokenExpiresAt: 1000 * HOUR,
  updatedAt: 0,
  ...over
})

const renewed: TokenSet = {
  accessToken: 'gho_new',
  expiresAt: 20 * HOUR,
  refreshToken: 'ghr_new',
  refreshTokenExpiresAt: 2000 * HOUR
}

function setup(initial: StoredAuth | null, refresh = vi.fn().mockResolvedValue(renewed), now = 0) {
  const mem = memoryStore(initial)
  let clock = now
  const session = new Session({ store: mem.store, refresh, now: () => clock, log: silent })
  return { session, mem, refresh, setNow: (t: number) => (clock = t) }
}

describe('Session.getAccessToken', () => {
  it('returns the current token while it is far from expiring', async () => {
    const { session, refresh } = setup(stored())
    await expect(session.getAccessToken()).resolves.toBe('gho_old')
    expect(refresh).not.toHaveBeenCalled()
  })

  it('never refreshes tokens that do not expire', async () => {
    const { session, refresh } = setup(stored({ expiresAt: null, refreshToken: null }), undefined, 999 * HOUR)
    await expect(session.getAccessToken()).resolves.toBe('gho_old')
    expect(refresh).not.toHaveBeenCalled()
  })

  it('refreshes inside the margin and persists the new pair before returning it', async () => {
    const { session, mem, refresh } = setup(stored(), undefined, 10 * HOUR - REFRESH_MARGIN_MS + 1)
    await expect(session.getAccessToken()).resolves.toBe('gho_new')
    expect(refresh).toHaveBeenCalledWith('client-1', 'ghr_old')
    expect(mem.saves).toHaveLength(1)
    expect(mem.value).toMatchObject({ accessToken: 'gho_new', refreshToken: 'ghr_new', expiresAt: 20 * HOUR })
  })

  it('runs a single refresh for concurrent callers', async () => {
    let resolve!: (t: TokenSet) => void
    const refresh = vi.fn().mockReturnValue(new Promise<TokenSet>((r) => (resolve = r)))
    const { session } = setup(stored(), refresh, 10 * HOUR)
    const a = session.getAccessToken()
    const b = session.getAccessToken()
    resolve(renewed)
    await expect(Promise.all([a, b])).resolves.toEqual(['gho_new', 'gho_new'])
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('keeps using a still-valid token when the refresh fails transiently', async () => {
    const refresh = vi.fn().mockRejectedValue(new DeviceFlowError('network', 'offline'))
    const { session } = setup(stored(), refresh, 10 * HOUR - 60_000)
    await expect(session.getAccessToken()).resolves.toBe('gho_old')
  })

  it('surfaces transient errors once the token has expired, without ending the session', async () => {
    const refresh = vi.fn().mockRejectedValue(new DeviceFlowError('network', 'offline'))
    const { session } = setup(stored(), refresh, 11 * HOUR)
    await expect(session.getAccessToken()).rejects.toMatchObject({ code: 'network' })
    expect(session.current).not.toBeNull()
  })

  it('ends the session when GitHub rejects the refresh token', async () => {
    const refresh = vi.fn().mockRejectedValue(new DeviceFlowError('bad_refresh_token', 'bad'))
    const { session } = setup(stored(), refresh, 11 * HOUR)
    await expect(session.getAccessToken()).rejects.toMatchObject({ reason: 'bad_refresh_token' })
  })

  it('reports apps that cannot refresh without a client secret', async () => {
    const refresh = vi.fn().mockRejectedValue(new DeviceFlowError('refresh_unsupported', 'secret needed'))
    const { session } = setup(stored(), refresh, 11 * HOUR)
    await expect(session.getAccessToken()).rejects.toMatchObject({ reason: 'refresh_unsupported' })
  })

  it('does not call GitHub when the refresh token itself has expired', async () => {
    const { session, refresh } = setup(stored({ refreshTokenExpiresAt: 5 * HOUR }), undefined, 11 * HOUR)
    await expect(session.getAccessToken()).rejects.toMatchObject({ reason: 'refresh_expired' })
    expect(refresh).not.toHaveBeenCalled()
  })
})

describe('Session.handleUnauthorized', () => {
  it('refreshes once and returns the new token', async () => {
    const { session } = setup(stored())
    await expect(session.handleUnauthorized('gho_old')).resolves.toBe('gho_new')
  })

  it('returns the current token when another caller already rotated it', async () => {
    const { session, refresh } = setup(stored({ accessToken: 'gho_rotated' }))
    await expect(session.handleUnauthorized('gho_old')).resolves.toBe('gho_rotated')
    expect(refresh).not.toHaveBeenCalled()
  })

  it('gives up without a refresh token (e.g. a legacy token that expired)', async () => {
    const { session } = setup(stored({ refreshToken: null, expiresAt: null }))
    const err = await session.handleUnauthorized('gho_old').catch((e) => e)
    expect(err).toBeInstanceOf(SessionExpiredError)
    expect(err.reason).toBe('no_refresh_token')
  })
})

describe('Session lifecycle', () => {
  it('stores logins as v2 and clears everything on logout', () => {
    const { session, mem } = setup(null, undefined, 1000)
    session.setFromLogin('oauth_app', 'client-1', renewed)
    expect(mem.value).toMatchObject({ v: 2, method: 'oauth_app', clientId: 'client-1', accessToken: 'gho_new', updatedAt: 1000 })
    session.setLogin('octo')
    expect(mem.value?.login).toBe('octo')
    session.clear()
    expect(mem.value).toBeNull()
    expect(session.current).toBeNull()
  })

  it('applies the development TTL override only to refreshable tokens', () => {
    const mem = memoryStore()
    const session = new Session({ store: mem.store, refresh: vi.fn(), now: () => 0, log: silent, ttlOverrideMs: 400_000 })
    session.setFromLogin('oauth_app', 'c', renewed)
    expect(mem.value?.expiresAt).toBe(400_000)
    session.setFromLogin('oauth_app', 'c', { ...renewed, refreshToken: null, expiresAt: null })
    expect(mem.value?.expiresAt).toBeNull()
  })
})

describe('parseStoredAuth', () => {
  it('migrates a bare legacy token', () => {
    expect(parseStoredAuth('gho_legacy\n', 'client-1')).toEqual({
      v: 2,
      method: 'oauth_app',
      clientId: 'client-1',
      accessToken: 'gho_legacy',
      expiresAt: null,
      refreshToken: null,
      refreshTokenExpiresAt: null,
      updatedAt: 0
    })
  })

  it('round-trips v2 JSON', () => {
    const auth = stored({ login: 'octo', method: 'github_app' })
    expect(parseStoredAuth(serializeAuth(auth), 'other')).toEqual(auth)
  })

  it('rejects garbage', () => {
    expect(parseStoredAuth('', 'c')).toBeNull()
    expect(parseStoredAuth('{"v":1}', 'c')).toBeNull()
    expect(parseStoredAuth('{not json', 'c')).toBeNull()
    expect(parseStoredAuth('two words', 'c')).toBeNull()
  })
})

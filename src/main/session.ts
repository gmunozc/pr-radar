/**
 * The signed-in GitHub session: stores the token pair and renews it before it expires.
 * Free of Electron APIs so it can be unit tested.
 */
import { DeviceFlowError, type TokenSet } from './deviceFlow'
import type { AuthMethod } from '../shared/types'
import type { Logger } from './log'

export type { AuthMethod }

export interface StoredAuth {
  v: 2
  method: AuthMethod
  clientId: string
  login?: string
  accessToken: string
  expiresAt: number | null
  refreshToken: string | null
  refreshTokenExpiresAt: number | null
  updatedAt: number
}

export interface AuthStore {
  load(): StoredAuth | null
  save(auth: StoredAuth): void
  clear(): void
}

export type ExpiryReason = 'no_refresh_token' | 'bad_refresh_token' | 'refresh_unsupported' | 'refresh_expired' | 'revoked'

/** The session can no longer be used; the user has to sign in again. */
export class SessionExpiredError extends Error {
  constructor(readonly reason: ExpiryReason) {
    super(`GitHub session expired (${reason})`)
    this.name = 'SessionExpiredError'
  }
}

/** Renew this long before the access token expires. */
export const REFRESH_MARGIN_MS = 5 * 60_000

export interface SessionDeps {
  store: AuthStore
  refresh(clientId: string, refreshToken: string): Promise<TokenSet>
  now(): number
  log: Logger
  /** Development aid: pretend refreshable tokens expire after this long. */
  ttlOverrideMs?: number
}

export class Session {
  private auth: StoredAuth | null
  private inflight: Promise<StoredAuth> | null = null

  constructor(private readonly deps: SessionDeps) {
    this.auth = deps.store.load()
  }

  get current(): StoredAuth | null {
    return this.auth
  }

  setFromLogin(method: AuthMethod, clientId: string, tokens: TokenSet): void {
    this.save({ v: 2, method, clientId, ...this.withTtlOverride(tokens), updatedAt: this.deps.now() })
  }

  setLogin(login: string): void {
    if (this.auth && this.auth.login !== login) this.save({ ...this.auth, login })
  }

  clear(): void {
    this.auth = null
    this.inflight = null
    this.deps.store.clear()
  }

  /** A usable access token, renewed first when it is about to expire. */
  async getAccessToken(): Promise<string> {
    const auth = this.auth
    if (!auth) throw new SessionExpiredError('revoked')
    const now = this.deps.now()
    if (auth.expiresAt === null || auth.expiresAt - now > REFRESH_MARGIN_MS) return auth.accessToken
    try {
      return (await this.refreshOnce()).accessToken
    } catch (err) {
      if (err instanceof SessionExpiredError) throw err
      // Transient failure (network, 5xx): keep using the old token while it is still valid.
      if (auth.expiresAt > now) {
        this.deps.log.warn('token refresh failed, using current token', err)
        return auth.accessToken
      }
      throw err
    }
  }

  /** Called after GitHub answered 401 for `failedToken`: renew once, or give up. */
  async handleUnauthorized(failedToken: string): Promise<string> {
    const auth = this.auth
    if (!auth) throw new SessionExpiredError('revoked')
    // Another caller already rotated the token.
    if (auth.accessToken !== failedToken) return auth.accessToken
    if (!auth.refreshToken) throw new SessionExpiredError('no_refresh_token')
    return (await this.refreshOnce()).accessToken
  }

  /** Renews right away; used after login to find out early whether renewal works. */
  async refreshNow(): Promise<void> {
    await this.refreshOnce()
  }

  private refreshOnce(): Promise<StoredAuth> {
    if (!this.inflight) {
      this.inflight = this.doRefresh().finally(() => {
        this.inflight = null
      })
    }
    return this.inflight
  }

  private async doRefresh(): Promise<StoredAuth> {
    const auth = this.auth
    if (!auth) throw new SessionExpiredError('revoked')
    if (!auth.refreshToken) throw new SessionExpiredError('no_refresh_token')
    if (auth.refreshTokenExpiresAt !== null && auth.refreshTokenExpiresAt <= this.deps.now()) {
      throw new SessionExpiredError('refresh_expired')
    }
    let tokens: TokenSet
    try {
      tokens = await this.deps.refresh(auth.clientId, auth.refreshToken)
    } catch (err) {
      if (err instanceof DeviceFlowError) {
        if (err.code === 'network' || err.code === 'http') throw err
        this.deps.log.warn('token refresh rejected', { code: err.code })
        throw new SessionExpiredError(err.code === 'refresh_unsupported' ? 'refresh_unsupported' : 'bad_refresh_token')
      }
      throw err
    }
    // A logout or a new login happened meanwhile: don't resurrect the old session.
    if (this.auth !== auth) {
      if (this.auth) return this.auth
      throw new SessionExpiredError('revoked')
    }
    const next: StoredAuth = {
      ...auth,
      ...this.withTtlOverride({ ...tokens, refreshToken: tokens.refreshToken ?? auth.refreshToken }),
      updatedAt: this.deps.now()
    }
    // Persist before anyone uses the new pair: the old refresh token is now invalid.
    this.save(next)
    this.deps.log.info('token refreshed', { expiresAt: next.expiresAt && new Date(next.expiresAt).toISOString() })
    return next
  }

  private save(auth: StoredAuth): void {
    this.deps.store.save(auth)
    this.auth = auth
  }

  private withTtlOverride(tokens: TokenSet): TokenSet {
    const ttl = this.deps.ttlOverrideMs
    if (!ttl || !tokens.refreshToken) return tokens
    return { ...tokens, expiresAt: this.deps.now() + ttl }
  }
}

/** Parses the decrypted contents of auth.bin: v2 JSON, or the bare token written by ≤ 0.2.1. */
export function parseStoredAuth(plaintext: string, legacyClientId: string): StoredAuth | null {
  const text = plaintext.trim()
  if (!text) return null
  if (text.startsWith('{')) {
    try {
      const raw = JSON.parse(text) as Partial<StoredAuth>
      if (raw.v !== 2 || typeof raw.accessToken !== 'string' || !raw.accessToken) return null
      const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
      return {
        v: 2,
        method: raw.method === 'github_app' ? 'github_app' : 'oauth_app',
        clientId: typeof raw.clientId === 'string' ? raw.clientId : legacyClientId,
        login: typeof raw.login === 'string' ? raw.login : undefined,
        accessToken: raw.accessToken,
        expiresAt: num(raw.expiresAt),
        refreshToken: typeof raw.refreshToken === 'string' && raw.refreshToken ? raw.refreshToken : null,
        refreshTokenExpiresAt: num(raw.refreshTokenExpiresAt),
        updatedAt: num(raw.updatedAt) ?? 0
      }
    } catch {
      return null
    }
  }
  // Legacy bare token: no expiry information and no refresh token.
  if (/\s/.test(text)) return null
  return {
    v: 2,
    method: 'oauth_app',
    clientId: legacyClientId,
    accessToken: text,
    expiresAt: null,
    refreshToken: null,
    refreshTokenExpiresAt: null,
    updatedAt: 0
  }
}

export function serializeAuth(auth: StoredAuth): string {
  return JSON.stringify(auth)
}

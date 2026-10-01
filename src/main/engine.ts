/**
 * The polling engine: fetches PRs, decides what is new, applies dismissals, persists state
 * and decides what to notify. Electron-free, with every dependency injected, so it can be
 * unit tested; index.ts wires it to the real app.
 */
import type { AppState, AuthNotice, PullRequest, Settings } from '../shared/types'
import { applyDismissals, diffPrs, planNotifications } from './diff'
import { GithubError, type FetchResult } from './github'
import type { Logger } from './log'
import { planToEvents, type NotificationEvent } from './notifications'
import { SessionExpiredError, type ExpiryReason, type Session } from './session'
import { migrateState, type PersistedState } from './state'

export type SessionLike = Pick<Session, 'current' | 'getAccessToken' | 'handleUnauthorized' | 'setLogin' | 'clear'>

export interface StateStore {
  read(): unknown
  write(state: PersistedState): void
  remove(): void
}

export interface EngineDeps {
  now(): number
  settings(): Settings
  session: SessionLike
  fetchPullRequests(token: string, settings: Settings): Promise<FetchResult>
  stateStore: StateStore
  notify(events: NotificationEvent[]): void
  publish(state: AppState): void
  /** The session ended (expired or logged out): stop polling and any login in progress. */
  onSessionEnded(): void
  log: Logger
}

export function loggedOutState(authNotice: AuthNotice | null = null): AppState {
  return {
    status: 'logged_out',
    viewer: null,
    prs: [],
    myPrs: [],
    lastUpdated: null,
    error: null,
    warnings: [],
    dismissedCount: 0,
    authNotice
  }
}

export class Engine {
  private current: AppState
  private persisted: PersistedState | null
  /** Last full result from GitHub, including dismissed PRs. */
  private allPrs: PullRequest[] = []
  /** When the search filter changes, the next result is a new baseline rather than "new" PRs. */
  private resetBaseline = false
  /** A problem with the session that doesn't stop polling, shown as a warning. */
  private sessionWarning: string | null = null
  private loggedTokenExpiration = false
  private failures = 0

  constructor(
    private readonly deps: EngineDeps,
    authNotice: AuthNotice | null = null
  ) {
    this.persisted = migrateState(deps.stateStore.read())
    this.current = deps.session.current ? { ...loggedOutState(), status: 'loading' } : loggedOutState(authNotice)
  }

  get state(): AppState {
    return this.current
  }

  /** Consecutive failed polls (for diagnostics). */
  get consecutiveFailures(): number {
    return this.failures
  }

  async poll(): Promise<{ retryAt?: number } | void> {
    if (!this.deps.session.current) return
    const settings = this.deps.settings()
    try {
      const result = await this.withToken((token) => this.deps.fetchPullRequests(token, settings))
      this.failures = 0
      this.deps.session.setLogin(result.viewer.login)
      if (!this.loggedTokenExpiration) {
        this.loggedTokenExpiration = true
        this.deps.log.info('token expiration header', { value: result.tokenExpiration ?? 'none' })
      }

      const stored = this.persisted?.login === result.viewer.login ? this.persisted : null
      const diff = diffPrs(this.resetBaseline ? result.prs.map((p) => p.id) : (stored?.seenIds ?? null), result.prs)
      this.resetBaseline = false
      this.allPrs = result.prs
      const { visible, dismissedIds } = applyDismissals(result.prs, stored?.dismissedIds ?? [])
      this.save({ v: 2, login: result.viewer.login, seenIds: diff.seenIds, dismissedIds })
      if (settings.notifications) this.emit(planToEvents(planNotifications(diff, visible.length)))

      this.publish({
        status: 'ready',
        viewer: result.viewer,
        prs: visible,
        myPrs: result.myPrs,
        lastUpdated: new Date(this.deps.now()).toISOString(),
        error: null,
        warnings: this.sessionWarning ? [...result.warnings, this.sessionWarning] : result.warnings,
        dismissedCount: dismissedIds.length,
        authNotice: null
      })
    } catch (err) {
      if (err instanceof SessionExpiredError) {
        this.expire(err.reason)
        return
      }
      this.failures++
      this.deps.log.warn('poll failed', err)
      const kind = err instanceof GithubError ? err.kind : 'network'
      this.publish({
        ...this.current,
        status: this.current.viewer ? 'ready' : 'error',
        error: { kind, message: (err as Error).message }
      })
      return { retryAt: err instanceof GithubError ? err.retryAt : undefined }
    }
  }

  dismiss(prId: string): void {
    if (!this.persisted) return
    this.setDismissed([...this.persisted.dismissedIds, prId])
  }

  restoreDismissed(): void {
    this.setDismissed([])
  }

  /** The search filters changed: the next poll sets a new baseline without notifying. */
  filtersChanged(): void {
    this.resetBaseline = true
  }

  /** A new login succeeded; `warning` explains a session problem that doesn't block polling. */
  loggedIn(warning: string | null): void {
    this.sessionWarning = warning
    this.failures = 0
    this.publish({ ...loggedOutState(), status: 'loading' })
  }

  /** The session can't be renewed: sign out but keep seen/dismissed PRs for the next login. */
  expire(reason: ExpiryReason): void {
    this.deps.log.warn('session expired', { reason })
    this.deps.session.clear()
    this.allPrs = []
    this.sessionWarning = null
    this.deps.onSessionEnded()
    this.publish(loggedOutState(reason === 'refresh_unsupported' ? 'refresh_unsupported' : 'session_expired'))
    if (this.deps.settings().notifications) this.emit([{ kind: 'session_expired' }])
  }

  /** Explicit "Cerrar sesión": forget the session and everything about this account. */
  logout(): void {
    this.deps.log.info('logout')
    this.deps.session.clear()
    this.deps.stateStore.remove()
    this.persisted = null
    this.allPrs = []
    this.sessionWarning = null
    this.deps.onSessionEnded()
    this.publish(loggedOutState())
  }

  /** Runs `fn` with a valid token; on 401 renews once and retries. */
  private async withToken<T>(fn: (token: string) => Promise<T>): Promise<T> {
    const token = await this.deps.session.getAccessToken()
    try {
      return await fn(token)
    } catch (err) {
      if (!(err instanceof GithubError && err.kind === 'unauthorized')) throw err
      this.deps.log.info('GitHub answered 401, renewing the token')
      const renewed = await this.deps.session.handleUnauthorized(token)
      try {
        return await fn(renewed)
      } catch (retryErr) {
        if (retryErr instanceof GithubError && retryErr.kind === 'unauthorized') throw new SessionExpiredError('revoked')
        throw retryErr
      }
    }
  }

  private setDismissed(ids: string[]): void {
    if (!this.persisted) return
    const { visible, dismissedIds } = applyDismissals(this.allPrs, ids)
    this.save({ ...this.persisted, dismissedIds })
    this.publish({ ...this.current, prs: visible, dismissedCount: dismissedIds.length })
  }

  private save(state: PersistedState): void {
    this.persisted = state
    this.deps.stateStore.write(state)
  }

  private emit(events: NotificationEvent[]): void {
    if (events.length > 0) this.deps.notify(events)
  }

  private publish(state: AppState): void {
    this.current = state
    this.deps.publish(state)
  }
}

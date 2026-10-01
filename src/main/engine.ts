/**
 * The polling engine: fetches PRs, decides what is new, applies dismissals, persists state
 * and decides what to notify. Electron-free, with every dependency injected, so it can be
 * unit tested; index.ts wires it to the real app.
 */
import type { Locale } from '../shared/i18n'
import type { AppState, AuthNotice, ConnectionState, PullRequest, Settings, Warning } from '../shared/types'
import { applyHidden, diffMyPrs, diffPrs, planNotifications, type MyPrEvent, type NotificationPlan } from './diff'
import { GithubError, type FetchResult } from './github'
import type { Logger } from './log'
import { capMyPrEvents, planToEvents, type CatchUp, type NotificationEvent } from './notifications'
import { SessionExpiredError, type ExpiryReason, type Session } from './session'
import { dayKey, digestDue, digestNear, isQuiet, nextWorkdayStart, quietEndsAt, snoozeUntil, type SnoozeOption } from './schedule'
import { emptyQueue, migrateState, type PersistedState, type QueuedAlerts } from './state'

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
  fetchPullRequests(token: string, settings: Settings, login?: string): Promise<FetchResult>
  stateStore: StateStore
  notify(events: NotificationEvent[]): void
  publish(state: AppState): void
  /** The session ended (expired or logged out): stop polling and any login in progress. */
  onSessionEnded(): void
  /** Whether the OS thinks there is a network connection. */
  isOnline(): boolean
  locale(): Locale
  log: Logger
}

/** Network failures in a row before the menu bar icon shows "offline". */
export const OFFLINE_AFTER_FAILURES = 2
/** The digest is only built from data at most this old. */
export const DIGEST_FRESHNESS_MS = 5 * 60_000
const DAY_MS = 24 * 3_600_000

/** Alerts produced by one poll (or tick), before quiet hours and grouping are applied. */
interface Alerts {
  reviewPlan: NotificationPlan
  returned: PullRequest[]
  mine: MyPrEvent[]
  sessionExpired?: boolean
}

const hasAny = (c: CatchUp) => c.reviews + c.reminders + c.approved + c.changes + c.ready > 0 || c.sessionExpired
const queueHasItems = (q: QueuedAlerts) =>
  q.reviews.length + q.reminders.length + q.approved.length + q.changes.length + q.ready.length > 0 || q.sessionExpired

export function loggedOutState(authNotice: AuthNotice | null = null, locale: Locale = 'en'): AppState {
  return {
    status: 'logged_out',
    viewer: null,
    prs: [],
    myPrs: [],
    lastUpdated: null,
    error: null,
    warnings: [],
    dismissedCount: 0,
    snoozedCount: 0,
    quietUntil: null,
    snoozeTomorrowAt: 0,
    update: null,
    authNotice,
    connection: 'ok',
    locale
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
  private sessionWarning: Warning | null = null
  private connection: ConnectionState = 'ok'
  private loggedTokenExpiration = false
  private failures = 0
  private lastSuccessAt: number | null = null
  private wasQuiet = false
  private updateInfo: AppState['update'] = null

  constructor(
    private readonly deps: EngineDeps,
    authNotice: AuthNotice | null = null
  ) {
    this.persisted = migrateState(deps.stateStore.read())
    const locale = deps.locale()
    this.current = deps.session.current
      ? { ...loggedOutState(null, locale), status: 'loading' }
      : loggedOutState(authNotice, locale)
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
      const login = this.deps.session.current?.login ?? this.persisted?.login
      const result = await this.withToken((token) => this.deps.fetchPullRequests(token, settings, login))
      this.failures = 0
      this.connection = 'ok'
      this.deps.session.setLogin(result.viewer.login)
      if (!this.loggedTokenExpiration) {
        this.loggedTokenExpiration = true
        this.deps.log.info('token expiration header', { value: result.tokenExpiration ?? 'none' })
      }

      const now = this.deps.now()
      const stored = this.persisted?.login === result.viewer.login ? this.persisted : null
      const diff = diffPrs(this.resetBaseline ? result.prs.map((p) => p.id) : (stored?.seenIds ?? null), result.prs)
      this.resetBaseline = false
      this.allPrs = result.prs
      const hidden = applyHidden(result.prs, { dismissedIds: stored?.dismissedIds ?? [], snoozed: stored?.snoozed ?? {} }, now)
      const mine = diffMyPrs(stored?.myPrs, result.myPrs)
      this.save({
        v: 2,
        login: result.viewer.login,
        seenIds: diff.seenIds,
        dismissedIds: hidden.dismissedIds,
        snoozed: hidden.snoozed,
        myPrs: mine.snapshot,
        queued: stored?.queued ?? emptyQueue(),
        lastDigestDay: stored?.lastDigestDay ?? null
      })
      this.lastSuccessAt = now

      this.publish({
        ...this.current,
        status: 'ready',
        viewer: result.viewer,
        prs: hidden.visible,
        myPrs: result.myPrs,
        lastUpdated: new Date(now).toISOString(),
        error: null,
        warnings: this.sessionWarning ? [...result.warnings, this.sessionWarning] : result.warnings,
        dismissedCount: hidden.dismissedIds.length,
        snoozedCount: Object.keys(hidden.snoozed).length,
        authNotice: null,
        connection: this.connection
      })
      this.dispatch({
        reviewPlan: planNotifications(diff, hidden.visible.length),
        returned: hidden.returned,
        mine: mine.events
      })
      this.tick()
    } catch (err) {
      if (err instanceof SessionExpiredError) {
        this.expire(err.reason)
        return
      }
      this.failures++
      this.deps.log.warn('poll failed', err)
      const code = err instanceof GithubError ? err.kind : 'network'
      const retryAt = err instanceof GithubError ? err.retryAt : undefined
      this.connection = this.connectionAfterFailure(code)
      this.publish({
        ...this.current,
        status: this.current.viewer ? 'ready' : 'error',
        error: { code, detail: (err as Error).message, retryAt },
        connection: this.connection
      })
      return { retryAt }
    }
  }

  /** Republishes the current state in the new UI language. */
  relocalize(): void {
    this.publish(this.current)
  }

  dismiss(prId: string): void {
    if (!this.persisted) return
    this.setHidden({ ...this.persisted, dismissedIds: [...this.persisted.dismissedIds, prId] })
  }

  /** Hides a review request until later ("in 1 hour" / next working day). */
  snooze(prId: string, option: SnoozeOption): void {
    if (!this.persisted) return
    const until = snoozeUntil(new Date(this.deps.now()), option, this.deps.settings()).getTime()
    this.setHidden({ ...this.persisted, snoozed: { ...this.persisted.snoozed, [prId]: until } })
  }

  /** Brings back every dismissed and snoozed PR, without notifying. */
  restoreHidden(): void {
    if (!this.persisted) return
    this.setHidden({ ...this.persisted, dismissedIds: [], snoozed: {} })
  }

  /**
   * Runs every minute and after each poll: brings back snoozes that ran out, delivers what
   * quiet hours held back once they end, and sends the daily digest.
   */
  tick(): void {
    const settings = this.deps.settings()
    const nowMs = this.deps.now()
    const now = new Date(nowMs)
    const persisted = this.persisted
    if (persisted && this.deps.session.current && Object.values(persisted.snoozed).some((until) => until <= nowMs)) {
      const hidden = applyHidden(this.allPrs, persisted, nowMs)
      this.save({ ...persisted, dismissedIds: hidden.dismissedIds, snoozed: hidden.snoozed })
      this.publish({ ...this.current, prs: hidden.visible, snoozedCount: Object.keys(hidden.snoozed).length })
      if (hidden.returned.length) this.dispatch({ reviewPlan: { kind: 'none' }, returned: hidden.returned, mine: [] })
    }

    const quiet = settings.notifications && isQuiet(now, settings)
    if (settings.notifications && !quiet) {
      if (this.persisted && queueHasItems(this.persisted.queued)) this.flushQueue(now)
      const fresh = this.lastSuccessAt !== null && nowMs - this.lastSuccessAt <= DIGEST_FRESHNESS_MS
      if (this.persisted && this.deps.session.current && fresh && digestDue(now, settings, this.persisted.lastDigestDay)) {
        this.sendDigest(now, null)
      }
    }
    // Keep "alerts paused until …" in the header in sync.
    if (quiet !== this.wasQuiet) {
      this.wasQuiet = quiet
      this.publish(this.current)
    }
  }

  /** A newer release is available (or null once installed/skipped). */
  setUpdate(update: AppState['update']): void {
    this.updateInfo = update
    this.publish(this.current)
  }

  /** Announces a new release once, unless notifications are off or it's quiet time. */
  announceUpdate(version: string, releaseUrl: string): void {
    const settings = this.deps.settings()
    if (!settings.notifications || isQuiet(new Date(this.deps.now()), settings)) return
    this.emit([{ kind: 'update_available', version, releaseUrl }])
  }

  /** Quiet hours, the digest or the notification settings changed. */
  settingsChanged(): void {
    this.tick()
    this.publish(this.current)
  }

  /** The search filters changed: the next poll sets a new baseline without notifying. */
  filtersChanged(): void {
    this.resetBaseline = true
  }

  /** A new login succeeded; `warning` explains a session problem that doesn't block polling. */
  loggedIn(warning: Warning | null): void {
    this.sessionWarning = warning
    this.failures = 0
    this.connection = 'ok'
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
    this.dispatch({ reviewPlan: { kind: 'none' }, returned: [], mine: [], sessionExpired: true })
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

  private setHidden(next: PersistedState): void {
    const hidden = applyHidden(this.allPrs, next, this.deps.now())
    this.save({ ...next, dismissedIds: hidden.dismissedIds, snoozed: hidden.snoozed })
    this.publish({
      ...this.current,
      prs: hidden.visible,
      dismissedCount: hidden.dismissedIds.length,
      snoozedCount: Object.keys(hidden.snoozed).length
    })
  }

  /** Delivers alerts now, or holds them back during quiet hours. */
  private dispatch(alerts: Alerts): void {
    const settings = this.deps.settings()
    if (!settings.notifications) return
    const mine = settings.notifyMyPrs ? alerts.mine : []
    const reviewEvents = planToEvents(alerts.reviewPlan)
    if (!reviewEvents.length && !alerts.returned.length && !mine.length && !alerts.sessionExpired) return

    if (isQuiet(new Date(this.deps.now()), settings) && this.persisted) {
      const q = this.persisted.queued
      const reviews = alerts.reviewPlan.kind === 'individual' || alerts.reviewPlan.kind === 'grouped' ? alerts.reviewPlan.prs : []
      const ids = (kind: MyPrEvent['kind']) => mine.filter((e) => e.kind === kind).map((e) => e.pr.id)
      // A first-run summary isn't queued: the digest covers what's pending.
      this.save({
        ...this.persisted,
        queued: {
          reviews: [...new Set([...q.reviews, ...reviews.map((p) => p.id)])],
          reminders: [...new Set([...q.reminders, ...alerts.returned.map((p) => p.id)])],
          approved: [...new Set([...q.approved, ...ids('my_pr_approved')])],
          changes: [...new Set([...q.changes, ...ids('my_pr_changes_requested')])],
          ready: [...new Set([...q.ready, ...ids('my_pr_ready')])],
          sessionExpired: q.sessionExpired || alerts.sessionExpired === true
        }
      })
      return
    }

    const events: NotificationEvent[] = [...reviewEvents]
    if (alerts.returned.length) events.push({ kind: 'snooze_returned', prs: alerts.returned })
    events.push(...capMyPrEvents(mine))
    if (alerts.sessionExpired) events.push({ kind: 'session_expired' })
    this.emit(events)
  }

  /** Quiet hours are over: one notification with what is still relevant. */
  private flushQueue(now: Date): void {
    const persisted = this.persisted!
    const q = persisted.queued
    const visible = new Set(this.current.prs.map((p) => p.id))
    const mine = new Map(this.current.myPrs.map((p) => [p.id, p]))
    const counts: CatchUp = {
      reviews: q.reviews.filter((id) => visible.has(id)).length,
      reminders: q.reminders.filter((id) => visible.has(id)).length,
      approved: q.approved.filter((id) => mine.get(id)?.status === 'approved').length,
      changes: q.changes.filter((id) => mine.get(id)?.status === 'changes_requested').length,
      ready: q.ready.filter((id) => mine.get(id)?.readyToMerge).length,
      sessionExpired: q.sessionExpired
    }
    this.save({ ...persisted, queued: emptyQueue() })
    if (!hasAny(counts)) return
    // Today's digest is (nearly) due: send one notification instead of two.
    if (this.deps.session.current && digestNear(now, this.deps.settings(), persisted.lastDigestDay)) {
      this.sendDigest(now, counts)
      return
    }
    this.emit([{ kind: 'catch_up', counts }])
  }

  private sendDigest(now: Date, caughtUp: CatchUp | null): void {
    const prs = this.current.prs
    const oldest = prs.reduce((min, p) => Math.min(min, Date.parse(p.createdAt)), Number.POSITIVE_INFINITY)
    const oldestDays = Number.isFinite(oldest) ? Math.floor((now.getTime() - oldest) / DAY_MS) : 0
    const ready = this.current.myPrs.filter((p) => p.readyToMerge).length
    const changes = this.current.myPrs.filter((p) => p.status === 'changes_requested').length
    if (this.persisted) this.save({ ...this.persisted, lastDigestDay: dayKey(now) })
    const caught = caughtUp && hasAny(caughtUp) ? caughtUp : null
    if (!prs.length && !ready && !changes && !caught) return
    this.emit([{ kind: 'digest', reviews: prs.length, oldestDays, ready, changes, caughtUp: caught }])
  }

  private save(state: PersistedState): void {
    this.persisted = state
    this.deps.stateStore.write(state)
  }

  private emit(events: NotificationEvent[]): void {
    if (events.length > 0) this.deps.notify(events)
  }

  private connectionAfterFailure(code: string): ConnectionState {
    if (code === 'rate_limited') return 'rate_limited'
    if (code !== 'network') return 'error'
    // A single blip is not worth a different icon; the OS knowing we're offline is.
    return this.failures >= OFFLINE_AFTER_FAILURES || !this.deps.isOnline() ? 'offline' : this.connection
  }

  private publish(state: AppState): void {
    const settings = this.deps.settings()
    const now = new Date(this.deps.now())
    const quietEnd = settings.notifications ? quietEndsAt(now, settings) : null
    this.current = {
      ...state,
      locale: this.deps.locale(),
      quietUntil: quietEnd ? quietEnd.getTime() : null,
      snoozeTomorrowAt: nextWorkdayStart(now, settings).getTime(),
      update: this.updateInfo
    }
    this.deps.publish(this.current)
  }
}

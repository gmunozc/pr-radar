/**
 * The polling engine: fetches PRs, decides what is new, applies dismissals, persists state
 * and decides what to notify. Electron-free, with every dependency injected, so it can be
 * unit tested; index.ts wires it to the real app.
 */
import type { Locale } from '../shared/i18n'
import type {
  ActionErrorCode,
  ActionResult,
  AppState,
  AuthNotice,
  ConnectionState,
  MergeMethod,
  MyPullRequest,
  PrAction,
  PrDetail,
  PullRequest,
  Settings,
  Warning
} from '../shared/types'
import type { ActionTarget, RemoteAction } from './actions'
import {
  applyHidden,
  diffMyPrs,
  diffPrs,
  planNotifications,
  type HiddenPrs,
  type HiddenResult,
  type MyPrEvent,
  type NotificationPlan
} from './diff'
import { GithubError, installationWarnings, type FetchResult, type InstallationInfo } from './github'
import type { Logger } from './log'
import { capMyPrEvents, planToEvents, staleNotifications, type CatchUp, type NotificationEvent } from './notifications'
import { SessionExpiredError, type ExpiryReason, type Session } from './session'
import { dayKey, digestDue, digestNear, isQuiet, nextWorkdayStart, quietEndsAt, snoozeUntil } from './schedule'
import type { SnoozeOption } from '../shared/types'
import { emptyQueue, migrateState, type ArmedMerge, type PersistedState, type QueuedAlerts } from './state'

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
  /** The cheap change probe between full polls (see Engine.probe); absent means no fast mode. */
  fetchFingerprint?(token: string, settings: Settings): Promise<string>
  /** GitHub App sessions only: where the app is installed. */
  fetchInstallations?(token: string): Promise<InstallationInfo[]>
  /** Writes to GitHub (merge, update branch, …); absent when the build can't write. */
  runPrAction?(token: string, pr: ActionTarget, action: RemoteAction): Promise<ActionResult>
  /** Asks for a poll soon, e.g. after an action changed a PR. */
  requestPoll?(): void
  /** Description and counts for the detail view. */
  fetchDetail?(token: string, prId: string): Promise<PrDetail | null>
  stateStore: StateStore
  notify(events: NotificationEvent[]): void
  /** Removes delivered notifications that no longer apply (reviewed, merged, dismissed, checks green again). */
  retireNotifications?(ids: string[]): void
  /** Removes every delivered notification (sign-out). */
  clearNotifications?(): void
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
/** How often a GitHub App session re-checks its installations (more often while there are none). */
export const INSTALLATION_CHECK_MS = 30 * 60_000
export const INSTALLATION_RECHECK_EMPTY_MS = 5 * 60_000
/**
 * An armed merge fires once GitHub has reported the PR mergeable this many polls in a row with
 * the same head: absorbs UNKNOWN→CLEAN flips and pushes still in flight.
 */
export const READY_POLLS_BEFORE_MERGE = 2
const DAY_MS = 24 * 3_600_000

export interface ProbeResult {
  /** `changed` asks for a full poll now; `failed` pauses probes (GitHub said when, if `retryAt`). */
  outcome: 'changed' | 'same' | 'skipped' | 'failed'
  retryAt?: number
}

interface MergeDone {
  pr: MyPullRequest
  method: MergeMethod
}

interface MergeFailure {
  pr: MyPullRequest
  code: ActionErrorCode
  detail?: string
}

/** Alerts produced by one poll (or tick), before quiet hours and grouping are applied. */
interface Alerts {
  reviewPlan: NotificationPlan
  returned: PullRequest[]
  mine: MyPrEvent[]
  merged?: MergeDone[]
  mergeFailed?: MergeFailure[]
  sessionExpired?: boolean
}

const hasAny = (c: CatchUp) =>
  c.reviews + c.reminders + c.approved + c.changes + c.ready + c.ciFailed + c.conflicts + c.merged + c.mergeFailed > 0 ||
  c.sessionExpired
const snoozedCount = (h: Pick<HiddenResult, 'snoozed' | 'snoozedUntilPush'>) =>
  Object.keys(h.snoozed).length + Object.keys(h.snoozedUntilPush).length
const queueHasItems = (q: QueuedAlerts) =>
  q.reviews.length +
    q.reminders.length +
    q.approved.length +
    q.changes.length +
    q.ready.length +
    q.ciFailed.length +
    q.conflicts.length +
    q.merged.length +
    q.mergeFailed.length >
    0 || q.sessionExpired

export function loggedOutState(authNotice: AuthNotice | null = null, locale: Locale = 'en'): AppState {
  return {
    status: 'logged_out',
    viewer: null,
    prs: [],
    myPrs: [],
    involved: [],
    lastUpdated: null,
    error: null,
    warnings: [],
    dismissedCount: 0,
    snoozedCount: 0,
    quietUntil: null,
    snoozeTomorrowAt: 0,
    update: null,
    authMethod: null,
    installations: null,
    authNotice,
    connection: 'ok',
    locale,
    canWrite: false,
    pendingActions: {},
    armedMerges: {}
  }
}

export class Engine {
  private current: AppState
  private persisted: PersistedState | null
  /** Last full result from GitHub, including dismissed PRs. */
  private allPrs: PullRequest[] = []
  private allInvolved: PullRequest[] = []
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
  private installs: InstallationInfo[] | null = null
  private installWarnings: Warning[] = []
  private lastInstallCheckAt = 0
  /** Armed merges: how many polls in a row GitHub reported the PR mergeable with this head. */
  private readyStreak = new Map<string, { headOid: string; count: number }>()
  /** Detail view cache, keyed by PR id and last update, so reopening a PR costs nothing. */
  private details = new Map<string, PrDetail>()
  /** What the last change probe saw; null until one runs (or after the searches change). */
  private fingerprint: string | null = null

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
      await this.checkInstallations()
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
      this.allInvolved = result.involved
      const hidden = this.hideAll(
        { dismissedIds: stored?.dismissedIds ?? [], snoozed: stored?.snoozed ?? {}, snoozedUntilPush: stored?.snoozedUntilPush ?? {} },
        now
      )
      const mine = diffMyPrs(stored?.myPrs, result.myPrs)
      const stale = staleNotifications(stored?.seenIds ?? [], result.prs, stored?.myPrs, result.myPrs)
      if (stale.length) this.deps.retireNotifications?.(stale)
      const armed = await this.fireArmedMerges(stored?.mergeWhenReady ?? {}, result.myPrs)
      this.save({
        v: 2,
        login: result.viewer.login,
        seenIds: diff.seenIds,
        dismissedIds: hidden.dismissedIds,
        snoozed: hidden.snoozed,
        snoozedUntilPush: hidden.snoozedUntilPush,
        mergeWhenReady: armed.remaining,
        myPrs: mine.snapshot,
        queued: stored?.queued ?? emptyQueue(),
        lastDigestDay: stored?.lastDigestDay ?? null
      })
      this.lastSuccessAt = now

      this.publish({
        ...this.current,
        status: 'ready',
        viewer: result.viewer,
        prs: hidden.prs,
        myPrs: result.myPrs,
        involved: hidden.involved,
        lastUpdated: new Date(now).toISOString(),
        error: null,
        warnings: [...result.warnings, ...this.installWarnings, ...(this.sessionWarning ? [this.sessionWarning] : [])],
        dismissedCount: hidden.dismissedIds.length,
        snoozedCount: snoozedCount(hidden),
        authNotice: null,
        connection: this.connection
      })
      this.dispatch({
        reviewPlan: planNotifications(diff, hidden.prs.length),
        returned: hidden.returned,
        mine: mine.events,
        merged: armed.merged,
        mergeFailed: armed.failed
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

  /**
   * Cheap "did anything change?" check between full polls (2 rate-limit points against ~6).
   * The first probe only takes a baseline; later ones compare with it, and a difference makes
   * the poller run a full poll right away, so a notification arrives seconds after the event.
   */
  async probe(): Promise<ProbeResult> {
    const fetchFingerprint = this.deps.fetchFingerprint
    if (!fetchFingerprint || !this.deps.session.current || this.current.status !== 'ready' || this.current.error) {
      return { outcome: 'skipped' }
    }
    try {
      const fingerprint = await this.withToken((token) => fetchFingerprint(token, this.deps.settings()))
      const changed = this.fingerprint !== null && fingerprint !== this.fingerprint
      this.fingerprint = fingerprint
      if (changed) this.deps.log.debug('probe saw a change')
      return { outcome: changed ? 'changed' : 'same' }
    } catch (err) {
      if (err instanceof SessionExpiredError) {
        this.expire(err.reason)
        return { outcome: 'failed' }
      }
      // The next full poll reports the problem, if it persists.
      this.deps.log.debug('probe failed', err)
      const retryAt = err instanceof GithubError && err.kind === 'rate_limited' ? err.retryAt : undefined
      return { outcome: 'failed', retryAt }
    }
  }

  /** Republishes the current state in the new UI language. */
  relocalize(): void {
    this.publish(this.current)
  }

  dismiss(prId: string): void {
    if (!this.persisted) return
    this.deps.retireNotifications?.([prId])
    this.setHidden({ ...this.persisted, dismissedIds: [...this.persisted.dismissedIds, prId] })
  }

  /** Hides a review request until later: an hour, the next working morning, or the author's next push. */
  snooze(prId: string, option: SnoozeOption): void {
    if (!this.persisted) return
    this.deps.retireNotifications?.([prId])
    if (option === 'push') {
      const head = this.allPrs.find((p) => p.id === prId)?.headOid
      if (head) {
        this.setHidden({ ...this.persisted, snoozedUntilPush: { ...this.persisted.snoozedUntilPush, [prId]: head } })
        return
      }
      // Without a known head commit there is nothing to compare against; fall back to an hour.
      this.deps.log.warn('snooze until push without a head commit; snoozing for an hour instead', { prId })
      option = 'hour'
    }
    const until = snoozeUntil(new Date(this.deps.now()), option, this.deps.settings()).getTime()
    this.setHidden({ ...this.persisted, snoozed: { ...this.persisted.snoozed, [prId]: until } })
  }

  /**
   * Runs a write action on one of your PRs, or approves a review request. Only OAuth App
   * sessions can write (the GitHub App is installed read-only). The panel shows the result;
   * the state itself is refreshed by the poll requested after a success.
   */
  async runAction(prId: string, action: PrAction): Promise<ActionResult> {
    const session = this.deps.session.current
    if (!session || session.method !== 'oauth_app' || !this.deps.runPrAction) return { ok: false, code: 'forbidden' }
    if (action.kind === 'arm_merge' || action.kind === 'disarm_merge') return this.setArmed(prId, action)
    const target = this.actionTarget(prId, action)
    if (!target.ok) return target
    if (this.current.pendingActions[prId]) return { ok: false, code: 'unknown', detail: 'Another action is still running' }
    const runPrAction = this.deps.runPrAction
    const { repo, number } = target.target
    this.setPending(prId, action.kind)
    try {
      const result = await this.withToken((token) => runPrAction(token, target.target, action))
      if (result.ok) {
        this.deps.log.info('pr action ok', { kind: action.kind, repo, number })
        this.deps.requestPoll?.()
      } else {
        this.deps.log.warn('pr action failed', { kind: action.kind, repo, number, code: result.code, detail: result.detail })
      }
      return result
    } catch (err) {
      if (err instanceof SessionExpiredError) {
        this.expire(err.reason)
        return { ok: false, code: 'unauthorized' }
      }
      const code: ActionErrorCode = err instanceof GithubError ? err.kind : 'unknown'
      this.deps.log.warn('pr action failed', { kind: action.kind, repo, number, code, detail: (err as Error).message })
      return { ok: false, code, detail: (err as Error).message }
    } finally {
      this.setPending(prId, null)
    }
  }

  /**
   * "Merge when ready": remembered locally and fired by `poll` once GitHub reports the PR
   * mergeable (see fireArmedMerges). For repositories without GitHub's own auto-merge.
   */
  private setArmed(prId: string, action: Extract<PrAction, { kind: 'arm_merge' | 'disarm_merge' }>): ActionResult {
    if (!this.persisted) return { ok: false, code: 'unknown', detail: 'No state yet' }
    const pr = this.current.myPrs.find((p) => p.id === prId)
    if (!pr) return { ok: false, code: 'not_found' }
    const mergeWhenReady = { ...this.persisted.mergeWhenReady }
    if (action.kind === 'arm_merge') {
      if (!pr.can.merge) return { ok: false, code: 'forbidden' }
      mergeWhenReady[prId] = { headOid: pr.headOid, method: action.method, armedAt: this.deps.now(), sawChecks: pr.ci !== 'none' }
      this.deps.log.info('merge armed', { repo: pr.repo, number: pr.number, method: action.method })
    } else {
      delete mergeWhenReady[prId]
      this.readyStreak.delete(prId)
      this.deps.log.info('merge disarmed', { repo: pr.repo, number: pr.number })
    }
    this.save({ ...this.persisted, mergeWhenReady })
    this.publish(this.current)
    return { ok: true }
  }

  /**
   * Merges armed PRs that GitHub has reported mergeable for READY_POLLS_BEFORE_MERGE polls in a
   * row. Stays armed across pushes (like GitHub's auto-merge) but never merges before the checks
   * of a new push exist, and always with the head commit seen in this poll. Anything that fails
   * disarms the PR and is reported.
   */
  private async fireArmedMerges(
    armed: Record<string, ArmedMerge>,
    myPrs: MyPullRequest[]
  ): Promise<{ remaining: Record<string, ArmedMerge>; merged: MergeDone[]; failed: MergeFailure[] }> {
    const remaining: Record<string, ArmedMerge> = {}
    const merged: MergeDone[] = []
    const failed: MergeFailure[] = []
    const runPrAction = this.deps.runPrAction
    const canWrite = this.deps.session.current?.method === 'oauth_app'
    for (const [prId, entry] of Object.entries(armed)) {
      const pr = myPrs.find((p) => p.id === prId)
      if (!pr) {
        // Merged or closed by someone else: nothing left to do.
        this.deps.log.info('armed merge dropped, PR no longer open', { prId })
        this.readyStreak.delete(prId)
        continue
      }
      const sawChecks = entry.sawChecks || pr.ci !== 'none'
      const ready = pr.mergeable && pr.can.merge && !pr.isDraft && (!sawChecks || pr.ci === 'success')
      const streak = this.readyStreak.get(prId)
      const count = ready ? (streak && streak.headOid === pr.headOid ? streak.count + 1 : 1) : 0
      if (ready) this.readyStreak.set(prId, { headOid: pr.headOid, count })
      else this.readyStreak.delete(prId)
      if (!ready || count < READY_POLLS_BEFORE_MERGE || !runPrAction || !canWrite) {
        remaining[prId] = { ...entry, headOid: pr.headOid, sawChecks }
        continue
      }
      const target: ActionTarget = { id: pr.id, headOid: pr.headOid, repo: pr.repo, number: pr.number }
      try {
        const result = await this.withToken((token) => runPrAction(token, target, { kind: 'merge', method: entry.method }))
        if (result.ok) {
          this.deps.log.info('armed merge done', { repo: pr.repo, number: pr.number, method: entry.method })
          merged.push({ pr, method: entry.method })
        } else {
          this.deps.log.warn('armed merge failed', { repo: pr.repo, number: pr.number, code: result.code, detail: result.detail })
          failed.push({ pr, code: result.code, detail: result.detail })
        }
      } catch (err) {
        if (err instanceof SessionExpiredError) throw err
        const code: ActionErrorCode = err instanceof GithubError ? err.kind : 'unknown'
        this.deps.log.warn('armed merge failed', { repo: pr.repo, number: pr.number, code, detail: (err as Error).message })
        failed.push({ pr, code, detail: (err as Error).message })
      }
      this.readyStreak.delete(prId)
    }
    if (merged.length) this.deps.requestPoll?.()
    return { remaining, merged, failed }
  }

  private armedView(): AppState['armedMerges'] {
    const out: AppState['armedMerges'] = {}
    for (const [id, entry] of Object.entries(this.persisted?.mergeWhenReady ?? {})) {
      out[id] = { method: entry.method, armedAt: entry.armedAt }
    }
    return out
  }

  /** The PR an action applies to, as last seen; approvals target review requests, the rest your own PRs. */
  private actionTarget(
    prId: string,
    action: RemoteAction
  ): { ok: true; target: ActionTarget } | Exclude<ActionResult, { ok: true }> {
    if (action.kind === 'approve') {
      const pr = [...this.allPrs, ...this.allInvolved].find((p) => p.id === prId)
      if (!pr) return { ok: false, code: 'not_found' }
      if (pr.viewerDidAuthor) return { ok: false, code: 'forbidden', detail: 'You cannot approve your own pull request' }
      return { ok: true, target: { id: pr.id, headOid: pr.headOid, repo: pr.repo, number: pr.number } }
    }
    const pr = this.current.myPrs.find((p) => p.id === prId)
    if (!pr) return { ok: false, code: 'not_found' }
    const target: ActionTarget = { id: pr.id, headOid: pr.headOid, repo: pr.repo, number: pr.number }
    if (action.kind === 'rerequest_review') {
      // Ask those who requested changes; failing that, everyone who reviewed.
      const withId = pr.reviews.filter((r) => r.id)
      const changed = withId.filter((r) => r.state === 'CHANGES_REQUESTED')
      target.reviewerIds = (changed.length ? changed : withId).map((r) => r.id!)
      if (!target.reviewerIds.length) return { ok: false, code: 'not_found', detail: 'No reviewer to ask again' }
    }
    return { ok: true, target }
  }

  private setPending(prId: string, kind: PrAction['kind'] | null): void {
    const pendingActions = { ...this.current.pendingActions }
    if (kind) pendingActions[prId] = kind
    else delete pendingActions[prId]
    this.publish({ ...this.current, pendingActions })
  }

  /** Description and counts for a PR the panel shows; only PRs in the current state are looked up. */
  async loadDetail(prId: string): Promise<PrDetail | null> {
    const pr = [...this.allPrs, ...this.current.myPrs, ...this.allInvolved].find((p) => p.id === prId)
    if (!pr || !this.deps.fetchDetail || !this.deps.session.current) return null
    const key = `${pr.id}@${pr.updatedAt}`
    const cached = this.details.get(key)
    if (cached) return cached
    const fetchDetail = this.deps.fetchDetail
    try {
      const detail = await this.withToken((token) => fetchDetail(token, prId))
      if (detail) {
        // Keep the cache small: entries for PRs that are gone are useless.
        if (this.details.size > 100) this.details.clear()
        this.details.set(key, detail)
      }
      return detail
    } catch (err) {
      if (err instanceof SessionExpiredError) {
        this.expire(err.reason)
        return null
      }
      this.deps.log.warn('could not load PR detail', err)
      return null
    }
  }

  /** Brings back every dismissed and snoozed PR, without notifying. */
  restoreHidden(): void {
    if (!this.persisted) return
    this.setHidden({ ...this.persisted, dismissedIds: [], snoozed: {}, snoozedUntilPush: {} })
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
      const hidden = this.hideAll(persisted, nowMs)
      this.save({ ...persisted, dismissedIds: hidden.dismissedIds, snoozed: hidden.snoozed, snoozedUntilPush: hidden.snoozedUntilPush })
      this.publish({ ...this.current, prs: hidden.prs, involved: hidden.involved, snoozedCount: snoozedCount(hidden) })
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
    this.fingerprint = null
  }

  /** A new login succeeded; `warning` explains a session problem that doesn't block polling. */
  loggedIn(warning: Warning | null): void {
    this.sessionWarning = warning
    this.failures = 0
    this.connection = 'ok'
    this.fingerprint = null
    this.resetInstallations()
    this.publish({ ...loggedOutState(), status: 'loading' })
  }

  /** Check where the GitHub App is installed on the next poll (e.g. after "Ya la instalé"). */
  forceInstallationCheck(): void {
    this.lastInstallCheckAt = 0
  }

  /** Signs out to sign in with another method, keeping seen/dismissed PRs and without alerts. */
  switchMethod(): void {
    this.deps.log.info('switching sign-in method')
    this.deps.session.clear()
    this.allPrs = []
    this.allInvolved = []
    this.fingerprint = null
    this.sessionWarning = null
    this.resetInstallations()
    this.deps.onSessionEnded()
    this.publish(loggedOutState())
  }

  /** The session can't be renewed: sign out but keep seen/dismissed PRs for the next login. */
  expire(reason: ExpiryReason): void {
    this.deps.log.warn('session expired', { reason })
    this.deps.session.clear()
    this.allPrs = []
    this.allInvolved = []
    this.fingerprint = null
    this.sessionWarning = null
    this.resetInstallations()
    this.deps.onSessionEnded()
    this.publish(loggedOutState(reason === 'refresh_unsupported' ? 'refresh_unsupported' : 'session_expired'))
    this.dispatch({ reviewPlan: { kind: 'none' }, returned: [], mine: [], sessionExpired: true })
  }

  /** Explicit "Cerrar sesión": forget the session and everything about this account. */
  logout(): void {
    this.deps.log.info('logout')
    this.deps.session.clear()
    this.deps.stateStore.remove()
    this.deps.clearNotifications?.()
    this.persisted = null
    this.allPrs = []
    this.allInvolved = []
    this.fingerprint = null
    this.sessionWarning = null
    this.resetInstallations()
    this.deps.onSessionEnded()
    this.publish(loggedOutState())
  }

  private resetInstallations(): void {
    this.installs = null
    this.installWarnings = []
    this.lastInstallCheckAt = 0
  }

  /**
   * GitHub App sessions only see repositories where the app is installed: find out where,
   * so the panel can explain an empty list. Failures are logged and retried later.
   */
  private async checkInstallations(): Promise<void> {
    const session = this.deps.session.current
    if (session?.method !== 'github_app' || !this.deps.fetchInstallations) return
    const now = this.deps.now()
    const every = this.installs?.length ? INSTALLATION_CHECK_MS : INSTALLATION_RECHECK_EMPTY_MS
    if (this.lastInstallCheckAt && now - this.lastInstallCheckAt < every) return
    this.lastInstallCheckAt = now
    try {
      const fetchInstallations = this.deps.fetchInstallations
      this.installs = await this.withToken((token) => fetchInstallations(token))
      this.installWarnings = installationWarnings(this.installs)
      this.deps.log.info('app installations', { accounts: this.installs.map((i) => i.login) })
    } catch (err) {
      if (err instanceof SessionExpiredError) throw err
      this.deps.log.warn('installation check failed', err)
    }
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
    const hidden = this.hideAll(next, this.deps.now())
    this.save({ ...next, dismissedIds: hidden.dismissedIds, snoozed: hidden.snoozed, snoozedUntilPush: hidden.snoozedUntilPush })
    this.publish({
      ...this.current,
      prs: hidden.prs,
      involved: hidden.involved,
      dismissedCount: hidden.dismissedIds.length,
      snoozedCount: snoozedCount(hidden)
    })
  }

  /**
   * Dismissals and snoozes apply to review requests and to PRs you take part in, with one shared
   * list of ids, so the pruning of ids that left looks at both lists. Reminders only concern
   * review requests (a PR you take part in can't be snoozed).
   */
  private hideAll(hidden: HiddenPrs, now: number): HiddenResult & { prs: PullRequest[]; involved: PullRequest[] } {
    const all = applyHidden([...this.allPrs, ...this.allInvolved], hidden, now)
    const visible = new Set(all.visible.map((p) => p.id))
    const involvedIds = new Set(this.allInvolved.map((p) => p.id))
    return {
      ...all,
      prs: this.allPrs.filter((p) => visible.has(p.id)),
      involved: this.allInvolved.filter((p) => visible.has(p.id)),
      returned: all.returned.filter((p) => !involvedIds.has(p.id))
    }
  }

  /** Delivers alerts now, or holds them back during quiet hours. */
  private dispatch(alerts: Alerts): void {
    const settings = this.deps.settings()
    if (!settings.notifications) return
    const mine = settings.notifyMyPrs ? alerts.mine : []
    // Merges the user armed are always reported, whatever the "updates on my PRs" setting.
    const merged = alerts.merged ?? []
    const mergeFailed = alerts.mergeFailed ?? []
    const reviewEvents = planToEvents(alerts.reviewPlan)
    if (
      !reviewEvents.length &&
      !alerts.returned.length &&
      !mine.length &&
      !merged.length &&
      !mergeFailed.length &&
      !alerts.sessionExpired
    ) {
      return
    }

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
          ciFailed: [...new Set([...q.ciFailed, ...ids('my_pr_ci_failed')])],
          conflicts: [...new Set([...q.conflicts, ...ids('my_pr_conflicts')])],
          merged: [...new Set([...q.merged, ...merged.map((m) => m.pr.id)])],
          mergeFailed: [...new Set([...q.mergeFailed, ...mergeFailed.map((m) => m.pr.id)])],
          sessionExpired: q.sessionExpired || alerts.sessionExpired === true
        }
      })
      return
    }

    const events: NotificationEvent[] = [...reviewEvents]
    if (alerts.returned.length) events.push({ kind: 'snooze_returned', prs: alerts.returned })
    events.push(...capMyPrEvents(mine))
    for (const m of merged) events.push({ kind: 'my_pr_merged', pr: m.pr, method: m.method })
    for (const f of mergeFailed) events.push({ kind: 'merge_failed', pr: f.pr, code: f.code, detail: f.detail })
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
      ciFailed: q.ciFailed.filter((id) => mine.get(id)?.ci === 'failure').length,
      conflicts: q.conflicts.filter((id) => mine.get(id)?.conflicts).length,
      merged: q.merged.length,
      mergeFailed: q.mergeFailed.length,
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
      update: this.updateInfo,
      authMethod: this.deps.session.current?.method ?? null,
      installations: this.installs ? this.installs.map(({ login, type }) => ({ login, type })) : null,
      // Only the OAuth App asks for `repo`; the GitHub App is installed read-only.
      canWrite: this.deps.session.current?.method === 'oauth_app',
      armedMerges: this.armedView()
    }
    this.deps.publish(this.current)
  }
}

import type { LanguagePref, Locale } from './i18n'

export type ReviewSource = { kind: 'direct' } | { kind: 'team'; slug: string }

interface PullRequestBase {
  id: string
  number: number
  title: string
  url: string
  repo: string
  author: { login: string; avatarUrl: string } | null
  isDraft: boolean
  createdAt: string
  updatedAt: string
  additions: number
  deletions: number
}

/** A PR someone asked you to review. */
export interface PullRequest extends PullRequestBase {
  source: ReviewSource
}

export type Reviewer = { kind: 'user'; login: string; avatarUrl: string } | { kind: 'team'; slug: string }

export type ReviewState = 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED' | 'PENDING'

export type MyReviewStatus = 'approved' | 'changes_requested' | 'waiting' | 'no_reviewers'

/** A PR you opened, with where its review stands. */
export interface MyPullRequest extends PullRequestBase {
  status: MyReviewStatus
  pendingReviewers: Reviewer[]
  reviews: Array<{ login: string; avatarUrl: string; state: ReviewState }>
}

export interface Viewer {
  login: string
  avatarUrl: string
}

export type AppStatus = 'logged_out' | 'loading' | 'ready' | 'error'

export type GithubErrorKind = 'unauthorized' | 'rate_limited' | 'network' | 'unknown'

/** Non-fatal problems shown as banners; translated in the panel. */
export type WarningCode = 'saml' | 'partial' | 'truncated_requested' | 'truncated_mine' | 'refresh_unsupported'
export interface Warning {
  code: WarningCode
  params?: Record<string, string | number>
}

/** Health of the connection to GitHub, as shown by the menu bar icon. */
export type ConnectionState = 'ok' | 'offline' | 'rate_limited' | 'error'

export interface AppState {
  status: AppStatus
  viewer: Viewer | null
  /** Review requests for you, newest first. */
  prs: PullRequest[]
  /** Your own open PRs, newest first. */
  myPrs: MyPullRequest[]
  lastUpdated: string | null
  /** The last poll failed; `detail` is GitHub's raw message (untranslated). */
  error: { code: GithubErrorKind; detail?: string; retryAt?: number } | null
  /** Non-fatal problems, e.g. SAML SSO hiding some organizations. */
  warnings: Warning[]
  connection: ConnectionState
  /** Language the UI should use. */
  locale: Locale
  /** PRs hidden by the user; not included in `prs`. */
  dismissedCount: number
  /** Why the user is signed out (shown on the login screen), or null. */
  authNotice: AuthNotice | null
}

export type AuthNotice = 'session_expired' | 'refresh_unsupported' | 'keychain_denied'

export interface Settings {
  includeTeams: boolean
  notifications: boolean
  showDrafts: boolean
  pollIntervalSec: number
  clientId: string
  language: LanguagePref
}

export const DEFAULT_SETTINGS: Settings = {
  includeTeams: true,
  notifications: true,
  showDrafts: true,
  pollIntervalSec: 30,
  clientId: '',
  language: 'system'
}

export const MIN_POLL_INTERVAL_SEC = 15

export type NotifyResult = { ok: true } | { ok: false; error: string }

export type AuthStatus =
  | { phase: 'idle' }
  | { phase: 'waiting'; userCode: string; verificationUri: string; expiresAt: number }
  | { phase: 'success' }
  | { phase: 'error'; code: AuthErrorCode; detail?: string }

export type AuthErrorCode =
  | 'device_flow_disabled'
  | 'invalid_client'
  | 'expired_token'
  | 'access_denied'
  | 'network'
  | 'http'
  | 'missing_client_id'
  | 'unknown'

export interface PrRadarApi {
  platform: string
  getState(): Promise<AppState>
  onState(cb: (state: AppState) => void): () => void
  refresh(): Promise<void>
  dismiss(prId: string): Promise<void>
  restoreDismissed(): Promise<void>
  auth: {
    start(): Promise<void>
    cancel(): Promise<void>
    logout(): Promise<void>
    hasClientId(): Promise<boolean>
    /** GitHub page where the user grants this OAuth App access to their organizations. */
    accessUrl(): Promise<string>
  }
  onAuthStatus(cb: (status: AuthStatus) => void): () => void
  settings: {
    get(): Promise<Settings & { openAtLogin: boolean }>
    set(patch: Partial<Settings> & { openAtLogin?: boolean }): Promise<Settings & { openAtLogin: boolean }>
  }
  openExternal(url: string): Promise<void>
  testNotification(): Promise<NotifyResult>
  openNotificationSettings(): Promise<void>
  appInfo(): Promise<{ version: string; packaged: boolean }>
  copyDiagnostics(): Promise<{ ok: boolean }>
  openLogs(): Promise<void>
  quit(): Promise<void>
}

export const IPC = {
  getState: 'state:get',
  state: 'state:update',
  refresh: 'state:refresh',
  dismiss: 'prs:dismiss',
  restoreDismissed: 'prs:restore',
  authStart: 'auth:start',
  authCancel: 'auth:cancel',
  authLogout: 'auth:logout',
  authHasClientId: 'auth:has-client-id',
  authAccessUrl: 'auth:access-url',
  authStatus: 'auth:status',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  openExternal: 'shell:open-external',
  testNotification: 'notify:test',
  openNotificationSettings: 'notify:open-settings',
  appInfo: 'app:info',
  copyDiagnostics: 'diagnostics:copy',
  openLogs: 'logs:open',
  quit: 'app:quit'
} as const

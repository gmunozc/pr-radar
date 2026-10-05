import type { LanguagePref, Locale } from './i18n'

export type ReviewSource = { kind: 'direct' } | { kind: 'team'; slug: string }

/** How the user signed in: the read-only GitHub App, or the OAuth App (broad `repo` scope). */
export type AuthMethod = 'oauth_app' | 'github_app'

/** An account (user or organization) where the GitHub App is installed. */
export interface Installation {
  login: string
  type: 'User' | 'Organization'
}

/** Combined status of the checks on a PR's head commit; `unknown` when it can't be read. */
export type CiState = 'success' | 'failure' | 'pending' | 'none' | 'unknown'

export type CheckState = 'success' | 'failure' | 'pending' | 'skipped'

/** One check run or commit status on the head commit. */
export interface CheckInfo {
  name: string
  state: CheckState
  /** Where the check reports its details (may be outside github.com). */
  url: string | null
}

export interface Label {
  name: string
  /** Hex without '#', as GitHub stores it. */
  color: string
}

export type MergeMethod = 'MERGE' | 'SQUASH' | 'REBASE'

export type RepoPermission = 'ADMIN' | 'MAINTAIN' | 'WRITE' | 'TRIAGE' | 'READ'

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
  /** Head commit SHA. */
  headOid: string
  ci: CiState
  /** Head branch name. */
  branch: string
  labels: Label[]
  /** Checks on the head commit, failing ones first; `checksTotal` counts all of them. */
  checks: CheckInfo[]
  checksTotal: number
}

/** A PR someone asked you to review. */
export interface PullRequest extends PullRequestBase {
  source: ReviewSource
  /** You opened it (GitHub doesn't let you approve your own PR). */
  viewerDidAuthor: boolean
  /** When you last submitted a review on it, if ever. */
  lastReviewAt: string | null
  /** The author pushed after your last review. */
  newCommitsSinceReview: boolean
}

/** Why an approved PR of yours can't be merged yet. */
export type MergeBlocker = 'conflicts' | 'behind' | 'blocked' | 'ci_failing' | 'ci_pending' | 'draft'

export type Reviewer = { kind: 'user'; login: string; avatarUrl: string } | { kind: 'team'; slug: string }

export type ReviewState = 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED' | 'PENDING'

export type MyReviewStatus = 'approved' | 'changes_requested' | 'waiting' | 'no_reviewers'

/** What the signed-in user may do to one of their PRs (repository permission, not readiness). */
export interface PrCapabilities {
  updateBranch: boolean
  enableAutoMerge: boolean
  disableAutoMerge: boolean
  merge: boolean
  requestReviews: boolean
}

/** Merge settings of the PR's repository. */
export interface MergeOptions {
  /** Methods the repository allows; empty when unknown. */
  methods: MergeMethod[]
  defaultMethod: MergeMethod
  deleteBranchOnMerge: boolean
  /** Whether GitHub's own auto-merge can be enabled in this repository. */
  autoMergeAllowed: boolean
}

/** A PR you opened, with where its review stands. */
export interface MyPullRequest extends PullRequestBase {
  status: MyReviewStatus
  pendingReviewers: Reviewer[]
  reviews: Array<{ login: string; avatarUrl: string; state: ReviewState; id?: string }>
  /** Approved, checks green, no conflicts and mergeable per branch protection. */
  readyToMerge: boolean
  /** Set when approved but not ready; null otherwise (or while GitHub is still computing). */
  blocker: MergeBlocker | null
  /** Merge conflicts with the base branch (shown whatever the review status). */
  conflicts: boolean
  /** GitHub would accept a merge right now (clean or hooks-only), whatever the review status. */
  mergeable: boolean
  baseBranch: string
  /** Your permission on the repository; null when GitHub didn't say. */
  permission: RepoPermission | null
  can: PrCapabilities
  /** GitHub's auto-merge, when enabled on this PR. */
  autoMerge: { method: MergeMethod; enabledAt: string } | null
  merge: MergeOptions
  /** Review threads nobody resolved yet; null when unreadable. */
  unresolvedThreads: number | null
  /** Approvals the base branch's protection rule requires; null when unknown or unprotected. */
  requiredApprovals: number | null
}

/** An action on a PR, as requested by the panel; the main process adds the head commit it expects. */
export type PrAction =
  | { kind: 'update_branch' }
  | { kind: 'enable_auto_merge'; method: MergeMethod }
  | { kind: 'disable_auto_merge' }
  | { kind: 'merge'; method: MergeMethod }
  | { kind: 'rerequest_review' }
  | { kind: 'approve'; body?: string }

export type ActionErrorCode =
  /** The PR changed since the panel showed it; refresh and look again. */
  | 'stale'
  | 'not_mergeable'
  /** Auto-merge can't be enabled because the PR can be merged right now. */
  | 'already_mergeable'
  | 'auto_merge_unavailable'
  | 'forbidden'
  | 'not_found'
  | 'unauthorized'
  | 'rate_limited'
  | 'network'
  | 'unknown'

export type ActionResult = { ok: true } | { ok: false; code: ActionErrorCode; detail?: string }

export interface Viewer {
  login: string
  avatarUrl: string
}

export type AppStatus = 'logged_out' | 'loading' | 'ready' | 'error'

export type GithubErrorKind = 'unauthorized' | 'rate_limited' | 'network' | 'unknown'

/** Non-fatal problems shown as banners; translated in the panel. */
export type WarningCode =
  | 'saml'
  | 'partial'
  | 'truncated_requested'
  | 'truncated_mine'
  | 'refresh_unsupported'
  | 'missing_permission'
  | 'app_not_installed'
  | 'app_permissions_pending'
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
  snoozedCount: number
  /** While quiet hours hold notifications back: when they end (epoch ms). */
  quietUntil: number | null
  /** When "snooze until tomorrow" would bring a PR back (epoch ms). */
  snoozeTomorrowAt: number
  /** A newer PR Radar release, unless the user skipped it. */
  update: { version: string; releaseUrl: string; downloadUrl: string | null } | null
  /** How the current session signed in (null when signed out). */
  authMethod: AuthMethod | null
  /** GitHub App only: where it's installed (null until checked, or with the OAuth App). */
  installations: Installation[] | null
  /** Why the user is signed out (shown on the login screen), or null. */
  authNotice: AuthNotice | null
  /** The session can write to GitHub (OAuth App with `repo` scope); the GitHub App is read-only. */
  canWrite: boolean
  /** PR id → action the main process is running on it right now. */
  pendingActions: Record<string, PrAction['kind']>
}

export type AuthNotice = 'session_expired' | 'refresh_unsupported' | 'keychain_denied'

export interface Settings {
  includeTeams: boolean
  notifications: boolean
  showDrafts: boolean
  pollIntervalSec: number
  clientId: string
  language: LanguagePref
  /** Notify when your PRs are approved, get changes requested or become ready to merge. */
  notifyMyPrs: boolean
  /** Only notify during working hours; alerts outside them arrive together afterwards. */
  quietHours: boolean
  /** "HH:MM", local time. */
  workStart: string
  workEnd: string
  /** 0 = Sunday … 6 = Saturday. */
  workDays: number[]
  /** A summary notification on working days at `digestTime`. */
  digest: boolean
  digestTime: string
  /** Look for new PR Radar releases on GitHub. */
  checkUpdates: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  includeTeams: true,
  notifications: true,
  showDrafts: true,
  pollIntervalSec: 30,
  clientId: '',
  language: 'system',
  notifyMyPrs: true,
  quietHours: false,
  workStart: '09:00',
  workEnd: '19:00',
  workDays: [1, 2, 3, 4, 5],
  digest: true,
  digestTime: '09:30',
  checkUpdates: true
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
  snooze(prId: string, option: 'hour' | 'tomorrow'): Promise<void>
  restoreDismissed(): Promise<void>
  auth: {
    start(method?: AuthMethod): Promise<void>
    cancel(): Promise<void>
    logout(): Promise<void>
    /** Signs out keeping seen/dismissed PRs, to sign in with another method. */
    switchMethod(): Promise<void>
    hasClientId(): Promise<boolean>
    methods(): Promise<{ available: Record<AuthMethod, boolean>; preferred: AuthMethod }>
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
  /** Sends a panel error to the main-process log. */
  reportError(message: string): void
  updates: {
    check(): Promise<void>
    download(): Promise<void>
    openNotes(): Promise<void>
    skip(): Promise<void>
  }
}

export const IPC = {
  getState: 'state:get',
  state: 'state:update',
  refresh: 'state:refresh',
  dismiss: 'prs:dismiss',
  snooze: 'prs:snooze',
  restoreDismissed: 'prs:restore',
  authStart: 'auth:start',
  authCancel: 'auth:cancel',
  authLogout: 'auth:logout',
  authHasClientId: 'auth:has-client-id',
  authMethods: 'auth:methods',
  authSwitch: 'auth:switch',
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
  rendererError: 'renderer:error',
  updateCheck: 'update:check',
  updateDownload: 'update:download',
  updateNotes: 'update:notes',
  updateSkip: 'update:skip',
  quit: 'app:quit'
} as const

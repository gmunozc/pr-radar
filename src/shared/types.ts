export type ReviewSource = { kind: 'direct' } | { kind: 'team'; slug: string }

export interface PullRequest {
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
  source: ReviewSource
}

export interface Viewer {
  login: string
  avatarUrl: string
}

export type AppStatus = 'logged_out' | 'loading' | 'ready' | 'error'

export type GithubErrorKind = 'unauthorized' | 'rate_limited' | 'network' | 'unknown'

export interface AppState {
  status: AppStatus
  viewer: Viewer | null
  prs: PullRequest[]
  lastUpdated: string | null
  error: { kind: GithubErrorKind; message: string } | null
  /** Non-fatal problems, e.g. SAML SSO hiding some organizations. */
  warnings: string[]
}

export interface Settings {
  includeTeams: boolean
  notifications: boolean
  showDrafts: boolean
  pollIntervalSec: number
  clientId: string
}

export const DEFAULT_SETTINGS: Settings = {
  includeTeams: true,
  notifications: true,
  showDrafts: true,
  pollIntervalSec: 30,
  clientId: ''
}

export const MIN_POLL_INTERVAL_SEC = 15

export type AuthStatus =
  | { phase: 'idle' }
  | { phase: 'waiting'; userCode: string; verificationUri: string; expiresAt: number }
  | { phase: 'success' }
  | { phase: 'error'; message: string }

export interface PrRadarApi {
  platform: string
  getState(): Promise<AppState>
  onState(cb: (state: AppState) => void): () => void
  refresh(): Promise<void>
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
  testNotification(): Promise<void>
  quit(): Promise<void>
}

export const IPC = {
  getState: 'state:get',
  state: 'state:update',
  refresh: 'state:refresh',
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
  quit: 'app:quit'
} as const

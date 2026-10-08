/**
 * A stand-in for the preload API, used only when the renderer runs in a plain browser during
 * development (`electron-vite dev --rendererOnly`, then http://localhost:5173). Fictional data;
 * actions mutate it locally so the panel can be exercised and screenshotted without GitHub.
 */
import type {
  ActionResult,
  AppState,
  AuthStatus,
  InstallState,
  MyPullRequest,
  PrAction,
  PrRadarApi,
  PullRequest,
  Settings,
  SnoozeOption
} from '../shared/types'
import { DEFAULT_SETTINGS } from '../shared/types'

type SettingsView = Settings & { openAtLogin: boolean }

const DAY = 86_400_000
const now = Date.now()
const ago = (ms: number) => new Date(now - ms).toISOString()

/** A coloured circle with a letter, as a data: URI (the CSP allows no other image hosts). */
function avatar(letter: string, color: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><circle cx="32" cy="32" r="32" fill="${color}"/>` +
    `<text x="32" y="41" font-family="-apple-system,Helvetica" font-size="30" font-weight="600" fill="#fff" text-anchor="middle">${letter}</text></svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

const people = {
  you: { login: 'you', avatarUrl: avatar('Y', '#0969da') },
  ana: { login: 'ana', avatarUrl: avatar('A', '#8250df') },
  bob: { login: 'bob', avatarUrl: avatar('B', '#1a7f37') },
  cris: { login: 'cris', avatarUrl: avatar('C', '#bf8700') },
  bot: { login: 'dependabot', avatarUrl: avatar('D', '#59636e') }
}

const base = {
  isDraft: false,
  additions: 120,
  deletions: 34,
  ci: 'success' as const,
  branch: 'feature/search-filters',
  labels: [],
  checks: [],
  checksTotal: 0
}

const reviews: PullRequest[] = [
  {
    ...base,
    id: 'R1',
    number: 482,
    title: 'Add server-side filters to the search endpoint',
    url: 'https://github.com/acme/web/pull/482',
    repo: 'acme/web',
    author: people.ana,
    createdAt: ago(3 * 3_600_000),
    updatedAt: ago(3_600_000),
    headOid: 'a1',
    source: { kind: 'direct' },
    viewerDidAuthor: false,
    lastReviewAt: null,
    newCommitsSinceReview: false,
    labels: [
      { name: 'backend', color: '0e8a16' },
      { name: 'needs tests', color: 'd93f0b' }
    ],
    checksTotal: 6
  },
  {
    ...base,
    id: 'R2',
    number: 91,
    title: 'Migrate the billing worker to the new queue',
    url: 'https://github.com/acme/billing/pull/91',
    repo: 'acme/billing',
    author: people.bob,
    createdAt: ago(8 * DAY),
    updatedAt: ago(2 * DAY),
    headOid: 'b2',
    ci: 'failure',
    source: { kind: 'team', slug: 'platform' },
    viewerDidAuthor: false,
    lastReviewAt: ago(5 * DAY),
    newCommitsSinceReview: true,
    labels: [{ name: 'urgent', color: 'b60205' }],
    checks: [
      { name: 'Pytest shard 1/4', state: 'failure', url: 'https://github.com/acme/billing/actions/runs/1/job/11' },
      { name: 'Lint', state: 'success', url: 'https://github.com/acme/billing/actions/runs/1/job/12' }
    ],
    checksTotal: 5
  },
  {
    ...base,
    id: 'R3',
    number: 1207,
    title: 'chore(deps): bump vite from 7.3.5 to 7.3.6',
    url: 'https://github.com/globex/console/pull/1207',
    repo: 'globex/console',
    author: people.bot,
    createdAt: ago(26 * 3_600_000),
    updatedAt: ago(26 * 3_600_000),
    headOid: 'c3',
    ci: 'pending',
    source: { kind: 'direct' },
    viewerDidAuthor: false,
    lastReviewAt: null,
    newCommitsSinceReview: false,
    labels: [{ name: 'dependencies', color: '0366d6' }],
    additions: 4,
    deletions: 4
  },
  {
    ...base,
    id: 'R4',
    number: 15,
    title: 'Draft: rework onboarding copy',
    url: 'https://github.com/globex/docs/pull/15',
    repo: 'globex/docs',
    author: people.cris,
    createdAt: ago(2 * DAY),
    updatedAt: ago(DAY),
    headOid: 'd4',
    isDraft: true,
    ci: 'none',
    source: { kind: 'direct' },
    viewerDidAuthor: false,
    lastReviewAt: null,
    newCommitsSinceReview: false
  }
]

const myBase = {
  ...base,
  author: people.you,
  viewerDidAuthor: true,
  pendingReviewers: [],
  readyToMerge: false,
  blocker: null,
  conflicts: false,
  mergeable: false,
  baseBranch: 'main',
  permission: 'WRITE' as const,
  can: { updateBranch: false, enableAutoMerge: false, disableAutoMerge: false, merge: true, requestReviews: true },
  autoMerge: null,
  merge: { methods: ['MERGE', 'SQUASH', 'REBASE'] as MyPullRequest['merge']['methods'], defaultMethod: 'SQUASH' as const, deleteBranchOnMerge: true, autoMergeAllowed: true },
  unresolvedThreads: 0,
  requiredApprovals: 1
}

const mine: MyPullRequest[] = [
  {
    ...myBase,
    id: 'M1',
    number: 488,
    title: 'Show failing checks in the panel',
    url: 'https://github.com/acme/web/pull/488',
    repo: 'acme/web',
    createdAt: ago(5 * 3_600_000),
    updatedAt: ago(600_000),
    headOid: 'm1',
    status: 'approved',
    reviews: [{ login: 'ana', avatarUrl: people.ana.avatarUrl, state: 'APPROVED', id: 'U_ana' }],
    readyToMerge: true,
    mergeable: true,
    labels: [{ name: 'frontend', color: '1d76db' }]
  },
  {
    ...myBase,
    id: 'M2',
    number: 93,
    title: 'Retry failed webhook deliveries with backoff',
    url: 'https://github.com/acme/billing/pull/93',
    repo: 'acme/billing',
    createdAt: ago(4 * DAY),
    updatedAt: ago(3_600_000),
    headOid: 'm2',
    status: 'changes_requested',
    reviews: [
      { login: 'bob', avatarUrl: people.bob.avatarUrl, state: 'CHANGES_REQUESTED', id: 'U_bob' },
      { login: 'cris', avatarUrl: people.cris.avatarUrl, state: 'APPROVED', id: 'U_cris' },
      { login: 'ana', avatarUrl: people.ana.avatarUrl, state: 'COMMENTED', id: 'U_ana' }
    ],
    unresolvedThreads: 3,
    can: { ...myBase.can, updateBranch: true },
    blocker: null
  },
  {
    ...myBase,
    id: 'M3',
    number: 1210,
    title: 'Upgrade the console to React 19.3',
    url: 'https://github.com/globex/console/pull/1210',
    repo: 'globex/console',
    createdAt: ago(DAY),
    updatedAt: ago(7_200_000),
    headOid: 'm3',
    ci: 'pending',
    status: 'waiting',
    pendingReviewers: [{ kind: 'user', login: 'ana', avatarUrl: people.ana.avatarUrl }, { kind: 'team', slug: 'frontend' }],
    reviews: [],
    autoMerge: { method: 'SQUASH', enabledAt: ago(3_600_000) },
    can: { ...myBase.can, disableAutoMerge: true },
    permission: 'ADMIN',
    merge: { ...myBase.merge, autoMergeAllowed: false }
  }
]

/** PRs the user takes part in without a review request (the "Involved" tab). */
const involved: PullRequest[] = [
  {
    ...base,
    id: 'I1',
    number: 530,
    title: 'Design review: new empty states',
    url: 'https://github.com/acme/web/pull/530',
    repo: 'acme/web',
    author: people.cris,
    createdAt: ago(6 * 3_600_000),
    updatedAt: ago(1_800_000),
    headOid: 'i1',
    source: { kind: 'involved' },
    viewerDidAuthor: false,
    lastReviewAt: null,
    newCommitsSinceReview: false,
    labels: [{ name: 'design', color: 'c5def5' }]
  }
]

export function createMockApi(): PrRadarApi {
  let settings: SettingsView = { ...DEFAULT_SETTINGS, language: 'es', openAtLogin: false }
  const stateListeners = new Set<(s: AppState) => void>()
  const settingsListeners = new Set<(s: SettingsView) => void>()
  let state: AppState = {
    status: 'ready',
    viewer: people.you,
    prs: reviews,
    myPrs: mine,
    involved,
    lastUpdated: ago(20_000),
    error: null,
    warnings: [],
    connection: 'ok',
    locale: 'es',
    dismissedCount: 0,
    snoozedCount: 0,
    quietUntil: null,
    snoozeTomorrowAt: now + 16 * 3_600_000,
    update: {
      version: '9.9.9',
      releaseUrl: 'https://github.com/gmunozc/pr-radar/releases/tag/v9.9.9',
      downloadUrl: 'https://github.com/gmunozc/pr-radar/releases/download/v9.9.9/PR-Radar-9.9.9-arm64.dmg'
    },
    authMethod: 'oauth_app',
    installations: null,
    authNotice: null,
    canWrite: true,
    pendingActions: {},
    armedMerges: {}
  }
  const publish = (patch: Partial<AppState>) => {
    state = { ...state, ...patch }
    for (const cb of stateListeners) cb(state)
  }
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
  let install: InstallState = { phase: 'idle' }
  const checkedListeners = new Set<(at: number) => void>()
  // Fast mode confirms the data every few seconds.
  setInterval(() => {
    for (const cb of checkedListeners) cb(Date.now())
  }, 5000)
  const focusListeners = new Set<(prId: string) => void>()
  // From the DevTools console: prRadarMock.focusPr('M2') plays a notification click.
  ;(window as unknown as { prRadarMock?: { focusPr(prId: string): void } }).prRadarMock = {
    focusPr: (prId) => {
      for (const cb of focusListeners) cb(prId)
    }
  }
  const installListeners = new Set<(s: InstallState) => void>()
  const setInstall = (s: InstallState) => {
    install = s
    for (const cb of installListeners) cb(s)
  }
  const hide = (prId: string, key: 'dismissedCount' | 'snoozedCount') =>
    publish({
      prs: state.prs.filter((p) => p.id !== prId),
      involved: state.involved.filter((p) => p.id !== prId),
      [key]: state[key] + 1
    })

  const action = async (prId: string, a: PrAction): Promise<ActionResult> => {
    publish({ pendingActions: { ...state.pendingActions, [prId]: a.kind } })
    await sleep(700)
    const done = () => {
      const { [prId]: _done, ...rest } = state.pendingActions
      publish({ pendingActions: rest })
    }
    const edit = (f: (pr: MyPullRequest) => MyPullRequest) => publish({ myPrs: state.myPrs.map((p) => (p.id === prId ? f(p) : p)) })
    switch (a.kind) {
      case 'merge':
        publish({ myPrs: state.myPrs.filter((p) => p.id !== prId) })
        break
      case 'approve':
        publish({ prs: state.prs.filter((p) => p.id !== prId) })
        break
      case 'update_branch':
        edit((p) => ({ ...p, can: { ...p.can, updateBranch: false } }))
        break
      case 'enable_auto_merge':
        edit((p) => ({ ...p, autoMerge: { method: a.method, enabledAt: new Date().toISOString() }, can: { ...p.can, enableAutoMerge: false, disableAutoMerge: true } }))
        break
      case 'disable_auto_merge':
        edit((p) => ({ ...p, autoMerge: null, can: { ...p.can, enableAutoMerge: true, disableAutoMerge: false } }))
        break
      case 'rerequest_review':
        edit((p) => ({ ...p, status: 'waiting', pendingReviewers: [{ kind: 'user', login: 'bob', avatarUrl: people.bob.avatarUrl }] }))
        break
      case 'arm_merge':
        publish({ armedMerges: { ...state.armedMerges, [prId]: { method: a.method, armedAt: Date.now() } } })
        break
      case 'disarm_merge': {
        const { [prId]: _gone, ...rest } = state.armedMerges
        publish({ armedMerges: rest })
        break
      }
    }
    done()
    return { ok: true }
  }

  return {
    platform: 'darwin',
    getState: async () => state,
    onState: (cb) => {
      stateListeners.add(cb)
      return () => stateListeners.delete(cb)
    },
    onChecked: (cb) => {
      checkedListeners.add(cb)
      return () => checkedListeners.delete(cb)
    },
    onFocusPr: (cb) => {
      focusListeners.add(cb)
      return () => focusListeners.delete(cb)
    },
    refresh: async () => {
      await sleep(400)
      publish({ lastUpdated: new Date().toISOString() })
    },
    dismiss: async (prId) => hide(prId, 'dismissedCount'),
    snooze: async (prId, _option: SnoozeOption) => hide(prId, 'snoozedCount'),
    restoreDismissed: async () => publish({ prs: reviews, dismissedCount: 0, snoozedCount: 0 }),
    hidePanel: async () => console.info('[mock] hide panel'),
    prs: {
      action,
      detail: async (prId) => {
        await sleep(500)
        if (prId === 'R4') return { body: '', changedFiles: 2, commits: 1, comments: 0 }
        return {
          body:
            'Adds server-side filtering to /search so the web client stops downloading the whole result set.\n\n' +
            '- New `filters` query parameter (repo, author, label)\n- Index on (repo_id, created_at)\n- Backfill script for existing rows\n\n' +
            'Closes #470.',
          changedFiles: 14,
          commits: 6,
          comments: 9
        }
      }
    },
    copyText: async (text) => {
      console.info('[mock] copied', text)
      return { ok: true }
    },
    copyLink: async (link) => {
      console.info('[mock] copied link', link)
      return { ok: true }
    },
    relaunch: async () => console.info('[mock] relaunch'),
    auth: {
      start: async () => {},
      cancel: async () => {},
      logout: async () => publish({ status: 'logged_out', viewer: null, prs: [], myPrs: [] }),
      switchMethod: async () => {},
      hasClientId: async () => true,
      methods: async () => ({ available: { github_app: false, oauth_app: true }, preferred: 'oauth_app' }),
      accessUrl: async () => 'https://github.com/settings/applications'
    },
    onAuthStatus: (_cb: (status: AuthStatus) => void) => () => {},
    settings: {
      get: async () => settings,
      set: async (patch) => {
        settings = { ...settings, ...patch }
        for (const cb of settingsListeners) cb(settings)
        if (patch.language) publish({ locale: patch.language === 'system' ? 'en' : patch.language })
        return settings
      }
    },
    onSettings: (cb) => {
      settingsListeners.add(cb)
      return () => settingsListeners.delete(cb)
    },
    openExternal: async (url) => console.info('[mock] open', url),
    openCheck: async (url) => console.info('[mock] open check', url),
    testNotification: async () => ({ ok: true }),
    openNotificationSettings: async () => {},
    appInfo: async () => ({ version: 'dev', packaged: false }),
    copyDiagnostics: async () => ({ ok: true }),
    openLogs: async () => {},
    quit: async () => {},
    reportError: (message) => console.error('[mock]', message),
    updates: {
      check: async () => {},
      download: async () => console.info('[mock] download'),
      openNotes: async () => {},
      skip: async () => publish({ update: null }),
      install: async () => {
        for (let percent = 0; percent <= 1; percent += 0.25) {
          setInstall({ phase: 'downloading', percent })
          await sleep(350)
          if (install.phase !== 'downloading') return
        }
        setInstall({ phase: 'verifying' })
        await sleep(500)
        setInstall({ phase: 'ready', path: '/tmp/PR-Radar-9.9.9-arm64.dmg' })
      },
      cancelInstall: async () => setInstall({ phase: 'error', code: 'cancelled' }),
      openInstaller: async () => console.info('[mock] open installer'),
      installState: async () => install,
      onInstallState: (cb) => {
        installListeners.add(cb)
        return () => installListeners.delete(cb)
      }
    }
  }
}

import { app, powerMonitor } from 'electron'
import { join } from 'node:path'
import {
  DEFAULT_SETTINGS,
  IPC,
  type AppState,
  type AuthNotice,
  type AuthStatus,
  type PullRequest,
  type Settings
} from '../shared/types'
import { createAuthStore, DeviceLogin } from './auth'
import { refreshAccessToken } from './deviceFlow'
import { applyDismissals, diffPrs, planNotifications } from './diff'
import { fetchPullRequests, GithubError, type FetchResult } from './github'
import { registerIpc } from './ipc'
import { logger } from './log'
import { notify, notifyLoggedOut } from './notifier'
import { Poller } from './poller'
import { Session, SessionExpiredError, type ExpiryReason } from './session'
import { JsonFile } from './store'
import { AppTray } from './tray'
import { Panel } from './window'

interface SeenState {
  login: string
  seenIds: string[]
  dismissedIds?: string[]
}

// Development runs use their own data folder (and a plain-text session, see createAuthStore)
// so they never touch the installed app's session, Keychain item or single-instance lock.
if (!app.isPackaged) app.setPath('userData', join(app.getPath('appData'), 'PR Radar Dev'))

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  if (process.platform === 'win32') app.setAppUserModelId('com.gmunozc.prradar')
  // Keep running in the menu bar when the (hidden) panel is the only window.
  app.on('window-all-closed', () => {})
  void app.whenReady().then(main)
}

function main(): void {
  if (process.platform === 'darwin') app.dock?.hide()

  const userData = app.getPath('userData')
  logger.init({
    file: join(userData, 'logs', 'pr-radar.log'),
    minLevel: process.env.PR_RADAR_DEBUG ? 'debug' : 'info',
    echo: !app.isPackaged
  })
  logger.info('PR Radar starting', { version: app.getVersion(), os: `${process.platform} ${process.arch}` })

  const settingsFile = new JsonFile<Settings>(join(userData, 'settings.json'), () => DEFAULT_SETTINGS)
  const seenFile = new JsonFile<SeenState | null>(join(userData, 'state.json'), () => null)

  let settings: Settings = { ...DEFAULT_SETTINGS, ...settingsFile.read() }
  const clientId = () => import.meta.env.MAIN_VITE_GITHUB_CLIENT_ID?.trim() || settings.clientId.trim()

  const authStore = createAuthStore(join(userData, 'auth.bin'), clientId, logger, { plain: !app.isPackaged })
  const devTtlSec = Number(process.env.PR_RADAR_DEV_TOKEN_TTL_SEC)
  const session = new Session({
    store: authStore,
    refresh: (id, refreshToken) => refreshAccessToken(id, refreshToken),
    now: Date.now,
    log: logger,
    ttlOverrideMs: !app.isPackaged && devTtlSec > 0 ? devTtlSec * 1000 : undefined
  })
  if (session.current) {
    const s = session.current
    logger.info('session loaded', { method: s.method, expires: s.expiresAt !== null, hasRefresh: s.refreshToken !== null })
  }
  // Problems with the session that don't stop polling (shown as warnings in the panel).
  let sessionWarning: string | null = null
  let seen = seenFile.read()
  // Last full result from GitHub, including dismissed PRs.
  let allPrs: PullRequest[] = []
  // When the search filter changes, the next result is a new baseline rather than "new" PRs.
  let resetBaseline = false

  let state: AppState = {
    status: session.current ? 'loading' : 'logged_out',
    viewer: null,
    prs: [],
    myPrs: [],
    lastUpdated: null,
    error: null,
    warnings: [],
    dismissedCount: 0,
    authNotice: authStore.readError
  }

  const panel = new Panel()
  const showPanel = () => panel.show(tray.getBounds())

  const publish = (next: AppState) => {
    state = next
    tray.update(state)
    if (!panel.win.isDestroyed()) panel.win.webContents.send(IPC.state, state)
  }

  const publishAuth = (status: AuthStatus) => {
    if (!panel.win.isDestroyed()) panel.win.webContents.send(IPC.authStatus, status)
  }

  const loggedOutState = (authNotice: AuthNotice | null = null): AppState => ({
    status: 'logged_out',
    viewer: null,
    prs: [],
    myPrs: [],
    lastUpdated: null,
    error: null,
    warnings: [],
    dismissedCount: 0,
    authNotice
  })

  const saveSeen = (next: SeenState) => {
    seen = next
    seenFile.write(next)
  }

  const setDismissed = (ids: string[]) => {
    if (!seen) return
    const { visible, dismissedIds } = applyDismissals(allPrs, ids)
    saveSeen({ ...seen, dismissedIds })
    publish({ ...state, prs: visible, dismissedCount: dismissedIds.length })
  }

  /** Explicit "Cerrar sesión": forget the session and everything about this account. */
  const logout = () => {
    logger.info('logout')
    deviceLogin.cancel()
    poller.stop()
    session.clear()
    seenFile.remove()
    seen = null
    allPrs = []
    sessionWarning = null
    publish(loggedOutState())
  }

  /** The session can't be renewed: sign out but keep seen/dismissed PRs for the next login. */
  const expireSession = (reason: ExpiryReason) => {
    logger.warn('session expired', { reason })
    deviceLogin.cancel()
    poller.stop()
    session.clear()
    allPrs = []
    sessionWarning = null
    publish(loggedOutState(reason === 'refresh_unsupported' ? 'refresh_unsupported' : 'session_expired'))
    if (settings.notifications) notifyLoggedOut(showPanel)
  }

  let loggedTokenExpiration = false

  /** Fetches with a valid token; on 401 renews once and retries. */
  const fetchWithSession = async (): Promise<FetchResult> => {
    const token = await session.getAccessToken()
    try {
      return await fetchPullRequests(token, settings)
    } catch (err) {
      if (!(err instanceof GithubError && err.kind === 'unauthorized')) throw err
      logger.info('GitHub answered 401, renewing the token')
      const renewed = await session.handleUnauthorized(token)
      try {
        return await fetchPullRequests(renewed, settings)
      } catch (retryErr) {
        if (retryErr instanceof GithubError && retryErr.kind === 'unauthorized') throw new SessionExpiredError('revoked')
        throw retryErr
      }
    }
  }

  const pollOnce = async (): Promise<{ retryAt?: number } | void> => {
    if (!session.current) return
    try {
      const result = await fetchWithSession()
      session.setLogin(result.viewer.login)
      if (!loggedTokenExpiration) {
        loggedTokenExpiration = true
        logger.info('token expiration header', { value: result.tokenExpiration ?? 'none' })
      }
      const stored = seen?.login === result.viewer.login ? seen : null
      const diff = diffPrs(resetBaseline ? result.prs.map((p) => p.id) : (stored?.seenIds ?? null), result.prs)
      resetBaseline = false
      allPrs = result.prs
      const { visible, dismissedIds } = applyDismissals(result.prs, stored?.dismissedIds ?? [])
      saveSeen({ login: result.viewer.login, seenIds: diff.seenIds, dismissedIds })
      if (settings.notifications) notify(planNotifications(diff, visible.length), showPanel)
      publish({
        status: 'ready',
        viewer: result.viewer,
        prs: visible,
        myPrs: result.myPrs,
        lastUpdated: new Date().toISOString(),
        error: null,
        warnings: sessionWarning ? [...result.warnings, sessionWarning] : result.warnings,
        dismissedCount: dismissedIds.length,
        authNotice: null
      })
    } catch (err) {
      if (err instanceof SessionExpiredError) {
        expireSession(err.reason)
        return
      }
      logger.warn('poll failed', err)
      const kind = err instanceof GithubError ? err.kind : 'network'
      publish({
        ...state,
        status: state.viewer ? 'ready' : 'error',
        error: { kind, message: (err as Error).message }
      })
      return { retryAt: err instanceof GithubError ? err.retryAt : undefined }
    }
  }

  const poller = new Poller(pollOnce, () => settings.pollIntervalSec)

  const deviceLogin = new DeviceLogin(publishAuth)

  const tray = new AppTray(panel, {
    refresh: () => void poller.runNow(),
    logout,
    isLoggedIn: () => session.current !== null
  })

  registerIpc({
    getState: () => state,
    refresh: () => poller.runNow(),
    dismiss: (prId) => setDismissed([...(seen?.dismissedIds ?? []), prId]),
    restoreDismissed: () => setDismissed([]),
    hasClientId: () => clientId() !== '',
    accessUrl: () =>
      clientId()
        ? `https://github.com/settings/connections/applications/${encodeURIComponent(clientId())}`
        : 'https://github.com/settings/applications',
    startLogin: async () => {
      const id = clientId()
      if (!id) {
        publishAuth({ phase: 'error', message: 'Falta el Client ID de la OAuth App.' })
        return
      }
      const tokens = await deviceLogin.start(id)
      if (!tokens) return
      session.setFromLogin('oauth_app', id, tokens)
      logger.info('login', {
        method: 'oauth_app',
        hasRefresh: tokens.refreshToken !== null,
        expiresInSec: tokens.expiresAt === null ? null : Math.round((tokens.expiresAt - Date.now()) / 1000)
      })
      sessionWarning = null
      // Renew once right away so we know now, not in 8 h, whether renewal works for this app.
      if (tokens.refreshToken) {
        try {
          await session.refreshNow()
          logger.info('refresh probe ok')
        } catch (err) {
          logger.warn('refresh probe failed', err)
          if (err instanceof SessionExpiredError && err.reason === 'refresh_unsupported') {
            sessionWarning =
              'GitHub no permite renovar la sesión de esta OAuth App: caducará en 8 h. En la OAuth App, desmarca "Expire user authorization tokens" y vuelve a conectar.'
          }
        }
      }
      publish({ ...loggedOutState(), status: 'loading' })
      poller.start()
    },
    cancelLogin: () => deviceLogin.cancel(),
    logout,
    getSettings: () => ({ ...settings, openAtLogin: app.getLoginItemSettings().openAtLogin }),
    setSettings: (patch) => {
      const { openAtLogin, ...rest } = patch
      if (openAtLogin !== undefined) app.setLoginItemSettings({ openAtLogin })
      const filtersChanged =
        (rest.includeTeams !== undefined && rest.includeTeams !== settings.includeTeams) ||
        (rest.showDrafts !== undefined && rest.showDrafts !== settings.showDrafts)
      settings = { ...settings, ...rest }
      settingsFile.write(settings)
      if (filtersChanged && session.current) {
        resetBaseline = true
        void poller.runNow()
      }
      return { ...settings, openAtLogin: app.getLoginItemSettings().openAtLogin }
    },
    showPanel
  })

  powerMonitor.on('suspend', () => poller.stop())
  const wake = () => {
    if (session.current && !poller.isActive) poller.start()
  }
  powerMonitor.on('resume', wake)
  powerMonitor.on('unlock-screen', wake)

  app.on('second-instance', showPanel)

  tray.update(state)
  if (session.current) {
    poller.start()
  } else {
    // First launch: open the panel so the user sees how to connect.
    panel.win.once('ready-to-show', showPanel)
  }
}

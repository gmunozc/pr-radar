import { app, powerMonitor } from 'electron'
import { join } from 'node:path'
import { DEFAULT_SETTINGS, IPC, type AppState, type AuthStatus, type PullRequest, type Settings } from '../shared/types'
import { clearToken, DeviceLogin, loadToken } from './auth'
import { applyDismissals, diffPrs, planNotifications } from './diff'
import { fetchPullRequests, GithubError } from './github'
import { registerIpc } from './ipc'
import { notify, notifyLoggedOut } from './notifier'
import { Poller } from './poller'
import { JsonFile } from './store'
import { AppTray } from './tray'
import { Panel } from './window'

interface SeenState {
  login: string
  seenIds: string[]
  dismissedIds?: string[]
}

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
  const settingsFile = new JsonFile<Settings>(join(userData, 'settings.json'), () => DEFAULT_SETTINGS)
  const seenFile = new JsonFile<SeenState | null>(join(userData, 'state.json'), () => null)

  let settings: Settings = { ...DEFAULT_SETTINGS, ...settingsFile.read() }
  let token = loadToken()
  let seen = seenFile.read()
  // Last full result from GitHub, including dismissed PRs.
  let allPrs: PullRequest[] = []
  // When the search filter changes, the next result is a new baseline rather than "new" PRs.
  let resetBaseline = false

  let state: AppState = {
    status: token ? 'loading' : 'logged_out',
    viewer: null,
    prs: [],
    myPrs: [],
    lastUpdated: null,
    error: null,
    warnings: [],
    dismissedCount: 0
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

  const loggedOutState = (): AppState => ({
    status: 'logged_out',
    viewer: null,
    prs: [],
    myPrs: [],
    lastUpdated: null,
    error: null,
    warnings: [],
    dismissedCount: 0
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

  const logout = () => {
    deviceLogin.cancel()
    poller.stop()
    clearToken()
    seenFile.remove()
    seen = null
    allPrs = []
    token = null
    publish(loggedOutState())
  }

  const pollOnce = async (): Promise<{ retryAt?: number } | void> => {
    if (!token) return
    try {
      const result = await fetchPullRequests(token, settings)
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
        warnings: result.warnings,
        dismissedCount: dismissedIds.length
      })
    } catch (err) {
      if (err instanceof GithubError && err.kind === 'unauthorized') {
        logout()
        if (settings.notifications) notifyLoggedOut(showPanel)
        return
      }
      const kind = err instanceof GithubError ? err.kind : 'unknown'
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
    isLoggedIn: () => token !== null
  })

  const clientId = () => import.meta.env.MAIN_VITE_GITHUB_CLIENT_ID?.trim() || settings.clientId.trim()

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
      const newToken = await deviceLogin.start(id)
      if (!newToken) return
      token = newToken
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
      if (filtersChanged && token) {
        resetBaseline = true
        void poller.runNow()
      }
      return { ...settings, openAtLogin: app.getLoginItemSettings().openAtLogin }
    },
    showPanel
  })

  powerMonitor.on('suspend', () => poller.stop())
  const wake = () => {
    if (token && !poller.isActive) poller.start()
  }
  powerMonitor.on('resume', wake)
  powerMonitor.on('unlock-screen', wake)

  app.on('second-instance', showPanel)

  tray.update(state)
  if (token) {
    poller.start()
  } else {
    // First launch: open the panel so the user sees how to connect.
    panel.win.once('ready-to-show', showPanel)
  }
}

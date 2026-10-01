/** Composition root: wires the engine, session, poller, tray, panel and IPC together. */
import { app, clipboard, net, Notification, powerMonitor, screen, shell } from 'electron'
import { dirname, join } from 'node:path'
import { IPC, type AuthStatus, type Settings, type Warning } from '../shared/types'
import { createAuthStore, DeviceLogin } from './auth'
import { debugMenu, FaultInjector } from './debug'
import { refreshAccessToken } from './deviceFlow'
import { buildDiagnostics } from './diagnostics'
import { Engine } from './engine'
import { fetchPullRequests } from './github'
import { applyLanguage, currentLocale } from './i18n'
import { registerIpc } from './ipc'
import { logger } from './log'
import { deliverEvents } from './notifier'
import { Poller } from './poller'
import { Session, SessionExpiredError } from './session'
import { normalizeSettings } from './settings'
import { JsonFile } from './store'
import { AppTray } from './tray'
import { Panel } from './window'

// Development runs use their own data folder (and a plain-text session, see createAuthStore)
// so they never touch the installed app's session, Keychain item or single-instance lock.
if (!app.isPackaged) app.setPath('userData', join(app.getPath('appData'), 'PR Radar Dev'))

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  if (process.platform === 'win32') app.setAppUserModelId('com.gmunozc.prradar')
  // Keep running in the menu bar when the (hidden) panel is the only window.
  app.on('window-all-closed', () => {})
  process.on('uncaughtException', (err) => logger.error('uncaught exception', err))
  process.on('unhandledRejection', (reason) => logger.error('unhandled rejection', reason))
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

  const settingsFile = new JsonFile<unknown>(join(userData, 'settings.json'), () => ({}))
  const stateFile = new JsonFile<unknown>(join(userData, 'state.json'), () => null)
  let settings: Settings = normalizeSettings(settingsFile.read())
  const clientId = () => import.meta.env.MAIN_VITE_GITHUB_CLIENT_ID?.trim() || settings.clientId.trim()
  applyLanguage(settings.language, app.getPreferredSystemLanguages())

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

  const faults = app.isPackaged ? null : new FaultInjector()
  const panel = new Panel()
  const showPanel = () => panel.show(tray.getBounds())

  const publishAuth = (status: AuthStatus) => {
    if (!panel.win.isDestroyed()) panel.win.webContents.send(IPC.authStatus, status)
  }
  const deviceLogin = new DeviceLogin(publishAuth)

  const engine = new Engine(
    {
      now: Date.now,
      settings: () => settings,
      session,
      fetchPullRequests: faults ? faults.wrap(fetchPullRequests) : fetchPullRequests,
      stateStore: {
        read: () => stateFile.read(),
        write: (state) => stateFile.write(state),
        remove: () => stateFile.remove()
      },
      notify: (events) => deliverEvents(events, showPanel),
      publish: (state) => {
        tray.update(state)
        if (!panel.win.isDestroyed()) panel.win.webContents.send(IPC.state, state)
      },
      onSessionEnded: () => {
        poller.stop()
        deviceLogin.cancel()
      },
      isOnline: () => net.isOnline(),
      locale: currentLocale,
      log: logger
    },
    authStore.readError
  )

  const poller = new Poller(() => engine.poll(), () => settings.pollIntervalSec)

  const diagnostics = () =>
    buildDiagnostics({
      app: { version: app.getVersion(), packaged: app.isPackaged },
      versions: { electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node },
      os: { platform: process.platform, arch: process.arch, release: process.getSystemVersion() },
      locales: app.getPreferredSystemLanguages(),
      displays: screen.getAllDisplays().map((d) => ({
        id: d.id,
        bounds: d.bounds,
        scaleFactor: d.scaleFactor,
        primary: d.id === screen.getPrimaryDisplay().id
      })),
      panelDisplayId: panel.displayId,
      settings,
      clientIdConfigured: clientId() !== '',
      auth: session.current,
      state: engine.state,
      consecutiveFailures: engine.consecutiveFailures,
      notificationsSupported: Notification.isSupported(),
      logs: logger.recent(50, 'warn'),
      now: Date.now()
    })
  const copyDiagnostics = async () => {
    try {
      await clipboard.writeText(diagnostics())
      logger.info('diagnostics copied')
      return { ok: true }
    } catch (err) {
      logger.error('could not copy diagnostics', err)
      return { ok: false }
    }
  }

  const tray = new AppTray(panel, {
    refresh: () => void poller.runNow(),
    logout: () => engine.logout(),
    isLoggedIn: () => session.current !== null,
    extraMenu: faults
      ? () =>
          debugMenu({
            faults,
            pollNow: () => void poller.runNow(),
            renewToken: async () => {
              try {
                await session.refreshNow()
              } catch (err) {
                logger.warn('manual renewal failed', err)
              }
            },
            copyDiagnostics: () => void copyDiagnostics()
          })
      : undefined
  })

  registerIpc({
    getState: () => engine.state,
    refresh: () => poller.runNow(),
    dismiss: (prId) => engine.dismiss(prId),
    restoreDismissed: () => engine.restoreDismissed(),
    hasClientId: () => clientId() !== '',
    accessUrl: () =>
      clientId()
        ? `https://github.com/settings/connections/applications/${encodeURIComponent(clientId())}`
        : 'https://github.com/settings/applications',
    startLogin: async () => {
      const id = clientId()
      if (!id) {
        publishAuth({ phase: 'error', code: 'missing_client_id' })
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
      let warning: Warning | null = null
      // Renew once right away so we know now, not in 8 h, whether renewal works for this app.
      if (tokens.refreshToken) {
        try {
          await session.refreshNow()
          logger.info('refresh probe ok')
        } catch (err) {
          logger.warn('refresh probe failed', err)
          if (err instanceof SessionExpiredError && err.reason === 'refresh_unsupported') {
            warning = { code: 'refresh_unsupported' }
          }
        }
      }
      engine.loggedIn(warning)
      poller.start()
    },
    cancelLogin: () => deviceLogin.cancel(),
    logout: () => engine.logout(),
    getSettings: () => ({ ...settings, openAtLogin: app.getLoginItemSettings().openAtLogin }),
    setSettings: (patch) => {
      const { openAtLogin, ...rest } = patch
      if (openAtLogin !== undefined) app.setLoginItemSettings({ openAtLogin })
      const filtersChanged =
        (rest.includeTeams !== undefined && rest.includeTeams !== settings.includeTeams) ||
        (rest.showDrafts !== undefined && rest.showDrafts !== settings.showDrafts)
      settings = { ...settings, ...rest }
      settingsFile.write(settings)
      if (applyLanguage(settings.language, app.getPreferredSystemLanguages())) {
        logger.info('language changed', { locale: currentLocale() })
        engine.relocalize()
      }
      if (filtersChanged && session.current) {
        engine.filtersChanged()
        void poller.runNow()
      }
      return { ...settings, openAtLogin: app.getLoginItemSettings().openAtLogin }
    },
    showPanel,
    appInfo: () => ({ version: app.getVersion(), packaged: app.isPackaged }),
    copyDiagnostics,
    openLogs: async () => {
      const file = logger.file
      if (file) await shell.openPath(dirname(file))
    }
  })

  powerMonitor.on('suspend', () => poller.stop())
  const wake = () => {
    if (session.current && !poller.isActive) poller.start()
  }
  powerMonitor.on('resume', wake)
  powerMonitor.on('unlock-screen', wake)

  app.on('second-instance', showPanel)

  tray.update(engine.state)
  if (session.current) {
    poller.start()
  } else {
    // First launch: open the panel so the user sees how to connect.
    panel.win.once('ready-to-show', showPanel)
  }
}

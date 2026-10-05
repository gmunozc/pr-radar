/** Composition root: wires the engine, session, poller, tray, panel and IPC together. */
import { app, clipboard, net, Notification, powerMonitor, screen, shell } from 'electron'
import { dirname, join } from 'node:path'
import { IPC, type AuthMethod, type AuthStatus, type Settings, type Warning } from '../shared/types'
import { createAuthStore, DeviceLogin } from './auth'
import { debugMenu, FaultInjector } from './debug'
import { refreshAccessToken } from './deviceFlow'
import { buildDiagnostics } from './diagnostics'
import { Engine } from './engine'
import { fetchInstallations, fetchPullRequests } from './github'
import { applyLanguage, currentLocale } from './i18n'
import { registerIpc } from './ipc'
import { logger } from './log'
import { deliverEvents } from './notifier'
import { Poller } from './poller'
import { Session, SessionExpiredError } from './session'
import { normalizeSettings } from './settings'
import { JsonFile } from './store'
import { AppTray } from './tray'
import { fetchLatestRelease, isReleaseUrl, UpdateChecker, type UpdateCheckerState } from './updates'
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
  const appClientId = import.meta.env.MAIN_VITE_GITHUB_APP_CLIENT_ID?.trim() ?? ''
  const appSlug = import.meta.env.MAIN_VITE_GITHUB_APP_SLUG?.trim() ?? ''
  const authMethods = () => ({
    available: { github_app: appClientId !== '', oauth_app: clientId() !== '' },
    preferred: (appClientId ? 'github_app' : 'oauth_app') as AuthMethod
  })
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
      fetchInstallations: (token) => fetchInstallations(token),
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

  // Update notice: packaged builds only, against this repository's GitHub releases.
  const updateRepo = (import.meta.env.MAIN_VITE_UPDATE_REPO ?? 'gmunozc/pr-radar').trim()
  const appFile = new JsonFile<UpdateCheckerState>(join(userData, 'app.json'), () => ({}))
  const updates =
    app.isPackaged && updateRepo
      ? new UpdateChecker({
          repo: updateRepo,
          currentVersion: app.getVersion(),
          now: Date.now,
          load: () => appFile.read(),
          save: (state) => appFile.write(state),
          // An Intel build running under Rosetta is offered the Apple Silicon dmg.
          fetchLatest: (repo, etag) => fetchLatestRelease(repo, etag, app.runningUnderARM64Translation ? 'arm64' : process.arch),
          log: logger
        })
      : null
  const runUpdateCheck = async (force = false) => {
    if (!updates || (!force && !settings.checkUpdates)) return
    const announce = await updates.check(force)
    engine.setUpdate(updates.available)
    if (announce) engine.announceUpdate(announce.version, announce.releaseUrl)
  }
  const openRelease = async (url: string | null | undefined) => {
    if (url && isReleaseUrl(url, updateRepo)) await shell.openExternal(url)
  }

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
    refresh: () => {
      engine.forceInstallationCheck()
      void poller.runNow()
    },
    downloadUpdate: () => void openRelease(updates?.available?.downloadUrl ?? updates?.available?.releaseUrl),
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
    refresh: () => {
      engine.forceInstallationCheck()
      return poller.runNow()
    },
    dismiss: (prId) => engine.dismiss(prId),
    restoreDismissed: () => engine.restoreHidden(),
    snooze: (prId, option) => engine.snooze(prId, option),
    hasClientId: () => clientId() !== '',
    authMethods,
    switchMethod: () => engine.switchMethod(),
    accessUrl: () => {
      const method = session.current?.method ?? authMethods().preferred
      if (method === 'github_app') {
        return appSlug ? `https://github.com/apps/${appSlug}/installations/new` : 'https://github.com/settings/installations'
      }
      return clientId()
        ? `https://github.com/settings/connections/applications/${encodeURIComponent(clientId())}`
        : 'https://github.com/settings/applications'
    },
    startLogin: async (requested) => {
      const method = requested ?? authMethods().preferred
      const id = method === 'github_app' ? appClientId : clientId()
      if (!id) {
        publishAuth({ phase: 'error', code: 'missing_client_id' })
        return
      }
      const tokens = await deviceLogin.start(id, method === 'github_app' ? null : undefined)
      if (!tokens) return
      session.setFromLogin(method, id, tokens)
      logger.info('login', {
        method,
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
      engine.settingsChanged()
      return { ...settings, openAtLogin: app.getLoginItemSettings().openAtLogin }
    },
    showPanel,
    appInfo: () => ({ version: app.getVersion(), packaged: app.isPackaged }),
    copyDiagnostics,
    openLogs: async () => {
      const file = logger.file
      if (file) await shell.openPath(dirname(file))
    },
    checkUpdates: () => runUpdateCheck(true),
    downloadUpdate: () => openRelease(updates?.available?.downloadUrl ?? updates?.available?.releaseUrl),
    openUpdateNotes: () => openRelease(updates?.available?.releaseUrl),
    skipUpdate: () => {
      const available = updates?.available
      if (!available || !updates) return
      updates.skip(available.version)
      engine.setUpdate(null)
    }
  })

  powerMonitor.on('suspend', () => poller.stop())
  const wake = () => {
    if (session.current && !poller.isActive) poller.start()
    void runUpdateCheck()
  }
  powerMonitor.on('resume', wake)
  powerMonitor.on('unlock-screen', wake)

  app.on('second-instance', showPanel)

  // Snoozes, quiet hours and the digest are time-based: check them every minute.
  setInterval(() => engine.tick(), 60_000)

  // Show a release found earlier right away; check GitHub shortly after launch and then
  // hourly (the checker itself only hits GitHub every 6 h unless asked).
  engine.setUpdate(updates?.available ?? null)
  setTimeout(() => void runUpdateCheck(), 30_000)
  setInterval(() => void runUpdateCheck(), 3_600_000)

  tray.update(engine.state)
  if (session.current) {
    poller.start()
  } else {
    // First launch: open the panel so the user sees how to connect.
    panel.win.once('ready-to-show', showPanel)
  }
}

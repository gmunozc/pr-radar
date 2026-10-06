/** Composition root: wires the engine, session, poller, tray, panel and IPC together. */
import { app, clipboard, globalShortcut, net, Notification, powerMonitor, screen, session, shell, type DownloadItem } from 'electron'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { IPC, type AuthMethod, type AuthStatus, type InstallState, type Settings, type Warning } from '../shared/types'
import { runPrAction } from './actions'
import { createAuthStore, DeviceLogin } from './auth'
import { debugMenu, FaultInjector } from './debug'
import { refreshAccessToken } from './deviceFlow'
import { buildDiagnostics } from './diagnostics'
import { Engine } from './engine'
import { fetchInstallations, fetchPullRequestDetail, fetchPullRequests } from './github'
import { applyLanguage, currentLocale } from './i18n'
import { isKnownCheckUrl, registerIpc } from './ipc'
import { logger } from './log'
import { deliverEvents, retire, retireAll } from './notifier'
import { Poller } from './poller'
import { Session, SessionExpiredError } from './session'
import { normalizeSettings } from './settings'
import { applyShortcut } from './shortcut'
import { JsonFile } from './store'
import { AppTray } from './tray'
import { fetchLatestRelease, isReleaseUrl, sha256File, UpdateChecker, UpdateInstaller, type UpdateCheckerState } from './updates'
import { Panel } from './window'

// CI smoke tests (PR_RADAR_SMOKE=1) start from an empty data folder and exit once the panel
// has rendered. Development runs use their own data folder (and a plain-text session, see
// createAuthStore) so they never touch the installed app's session, Keychain item or
// single-instance lock.
const smoke = process.env.PR_RADAR_SMOKE === '1'
if (smoke) app.setPath('userData', mkdtempSync(join(tmpdir(), 'pr-radar-smoke-')))
else if (!app.isPackaged) app.setPath('userData', join(app.getPath('appData'), 'PR Radar Dev'))

const settingsFile = new JsonFile<unknown>(join(app.getPath('userData'), 'settings.json'), () => ({}))
let settings: Settings = normalizeSettings(settingsFile.read())
// Chromium's own UI (time fields, context menus, spellcheck) follows its locale, which is
// fixed before the app is ready; make it follow the language chosen in Settings.
if (settings.language !== 'system') app.commandLine.appendSwitch('lang', settings.language)

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
    echo: !app.isPackaged || smoke
  })
  logger.info('PR Radar starting', { version: app.getVersion(), os: `${process.platform} ${process.arch}` })

  const stateFile = new JsonFile<unknown>(join(userData, 'state.json'), () => null)
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
  panel.resize(settings.panelSize)
  const showPanel = () => panel.show(tray?.getBounds())
  const togglePanel = () => panel.toggle(tray?.getBounds())

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
      runPrAction: (token, pr, action) => runPrAction(token, pr, action),
      requestPoll: () => void poller.runNow(),
      fetchDetail: (token, prId) => fetchPullRequestDetail(token, prId),
      stateStore: {
        read: () => stateFile.read(),
        write: (state) => stateFile.write(state),
        remove: () => stateFile.remove()
      },
      notify: (events) =>
        deliverEvents(events, {
          openPanel: showPanel,
          perform: (action) => {
            if (action.kind === 'snooze') engine.snooze(action.prId, action.option)
            else if (action.kind === 'dismiss') engine.dismiss(action.prId)
          }
        }),
      retireNotifications: retire,
      clearNotifications: retireAll,
      publish: (state) => {
        tray?.update(state)
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

  // Update notice: packaged builds only, against this repository's GitHub releases. In
  // development, PR_RADAR_DEV_VERSION=0.0.1 pretends to be that version to exercise the flow.
  const updateRepo = (import.meta.env.MAIN_VITE_UPDATE_REPO ?? 'gmunozc/pr-radar').trim()
  const devVersion = !app.isPackaged ? process.env.PR_RADAR_DEV_VERSION : undefined
  const appFile = new JsonFile<UpdateCheckerState>(join(userData, 'app.json'), () => ({}))
  const updates =
    (app.isPackaged || devVersion) && updateRepo
      ? new UpdateChecker({
          repo: updateRepo,
          currentVersion: devVersion || app.getVersion(),
          now: Date.now,
          load: () => appFile.read(),
          save: (state) => appFile.write(state),
          // An Intel build running under Rosetta is offered the Apple Silicon dmg.
          fetchLatest: (repo, etag) => fetchLatestRelease(repo, etag, app.runningUnderARM64Translation ? 'arm64' : process.arch),
          log: logger
        })
      : null

  // Installing an update: download the dmg here, verify it, open it. Leftovers from a previous
  // run are useless, so start clean.
  const updatesDir = join(userData, 'updates')
  rmSync(updatesDir, { recursive: true, force: true })
  const installer = new UpdateInstaller({
    dir: updatesDir,
    download: downloadFile,
    fetchText: async (url, signal) => {
      const res = await fetch(url, { signal, headers: { 'User-Agent': 'pr-radar' } })
      if (!res.ok) throw new Error(`GitHub answered ${res.status}`)
      return res.text()
    },
    sha256: sha256File,
    openPath: async (path) => {
      const error = await shell.openPath(path)
      if (error) throw Object.assign(new Error(error), { code: 'EOPEN' })
    },
    removeFile: (path) => rmSync(path, { force: true }),
    joinPath: join,
    onChange: (state: InstallState) => {
      if (!panel.win.isDestroyed()) panel.win.webContents.send(IPC.updateInstallState, state)
    },
    log: logger
  })
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

  // Some Linux desktops have no tray host; the app must still run (with the panel open).
  let tray: AppTray | null = null
  try {
    tray = new AppTray(panel, {
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
  } catch (err) {
    logger.error('could not create the tray icon', err)
  }

  registerIpc({
    getState: () => engine.state,
    refresh: () => {
      engine.forceInstallationCheck()
      return poller.runNow()
    },
    dismiss: (prId) => engine.dismiss(prId),
    restoreDismissed: () => engine.restoreHidden(),
    snooze: (prId, option) => engine.snooze(prId, option),
    hidePanel: () => panel.hide(),
    prAction: (prId, action) => engine.runAction(prId, action),
    prDetail: (prId) => engine.loadDetail(prId),
    copyText: async (text) => {
      try {
        await clipboard.writeText(text)
        return { ok: true }
      } catch (err) {
        logger.warn('could not copy to the clipboard', err)
        return { ok: false }
      }
    },
    openCheck: async (url) => {
      if (isKnownCheckUrl(engine.state, url)) await shell.openExternal(url)
      else logger.warn('refused to open an unknown check URL', { url })
    },
    relaunch: () => {
      logger.info('relaunching')
      app.relaunch()
      app.quit()
    },
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
      // Settings that change what GitHub is asked for: the next result is a new baseline.
      const searchKeys = ['includeTeams', 'showDrafts', 'hideBots', 'excludeRepos', 'excludeAuthors'] as const
      const filtersChanged = searchKeys.some(
        (key) => rest[key] !== undefined && JSON.stringify(rest[key]) !== JSON.stringify(settings[key])
      )
      settings = { ...settings, ...rest }
      // A shortcut another app owns can't be registered: fall back to none so the UI says so.
      if (rest.shortcut !== undefined && !applyShortcut(settings.shortcut, togglePanel)) settings = { ...settings, shortcut: '' }
      if (rest.panelSize !== undefined) panel.resize(settings.panelSize)
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
      const view = { ...settings, openAtLogin: app.getLoginItemSettings().openAtLogin }
      if (!panel.win.isDestroyed()) panel.win.webContents.send(IPC.settingsChanged, view)
      return view
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
    installUpdate: async () => {
      const available = updates?.available
      if (!available || !isReleaseUrl(available.downloadUrl ?? '', updateRepo)) return
      mkdirSync(updatesDir, { recursive: true })
      await installer.install(available)
    },
    cancelInstall: () => installer.cancel(),
    openInstaller: () => installer.openInstaller(),
    installState: () => installer.state,
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

  if (!applyShortcut(settings.shortcut, togglePanel)) {
    settings = { ...settings, shortcut: '' }
    settingsFile.write(settings)
  }
  app.on('will-quit', () => globalShortcut.unregisterAll())

  // Snoozes, quiet hours and the digest are time-based: check them every minute.
  setInterval(() => engine.tick(), 60_000)

  // Show a release found earlier right away; check GitHub shortly after launch and then
  // hourly (the checker itself only hits GitHub every 6 h unless asked).
  engine.setUpdate(updates?.available ?? null)
  setTimeout(() => void runUpdateCheck(), 30_000)
  setInterval(() => void runUpdateCheck(), 3_600_000)

  tray?.update(engine.state)
  if (smoke) {
    runSmokeTest(panel)
  } else if (session.current) {
    poller.start()
  } else {
    // First launch (or no tray icon): open the panel so the user sees how to connect.
    panel.win.once('ready-to-show', showPanel)
  }
}

/**
 * Downloads `url` to `dest` through Chromium's download manager (follows GitHub's redirect to
 * objects.githubusercontent.com), reporting progress; `signal` cancels it.
 */
function downloadFile(url: string, dest: string, onProgress: (percent: number | null) => void, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const ses = session.defaultSession
    const onWillDownload = (_e: Electron.Event, item: DownloadItem) => {
      if (item.getURLChain()[0] !== url) return
      ses.removeListener('will-download', onWillDownload)
      item.setSavePath(dest)
      const abort = () => item.cancel()
      signal.addEventListener('abort', abort, { once: true })
      item.on('updated', () => {
        const total = item.getTotalBytes()
        onProgress(total > 0 ? Math.min(1, item.getReceivedBytes() / total) : null)
      })
      item.once('done', (_ev, state) => {
        signal.removeEventListener('abort', abort)
        if (state === 'completed') resolve()
        else reject(new Error(`download ${state}`))
      })
    }
    ses.on('will-download', onWillDownload)
    ses.downloadURL(url)
  })
}

/** CI: exit 0 once the panel has rendered, 1 after 60 s without it, 2 on an uncaught error. */
function runSmokeTest(panel: Panel): void {
  const fail = (why: string, code: number) => {
    logger.error(`smoke test failed: ${why}`)
    app.exit(code)
  }
  const deadline = setTimeout(() => fail('timeout', 1), 60_000)
  process.on('uncaughtException', (err) => fail(String(err), 2))
  const probe = setInterval(() => {
    const wc = panel.win.webContents
    if (wc.isLoading()) return
    wc.executeJavaScript('document.getElementById("root")?.childElementCount ?? 0').then(
      (mounted) => {
        if (Number(mounted) <= 0) return
        clearInterval(probe)
        clearTimeout(deadline)
        logger.info('smoke test ok')
        app.exit(0)
      },
      (err) => fail(`probe failed: ${String(err)}`, 3)
    )
  }, 250)
}

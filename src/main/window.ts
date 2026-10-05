import { BrowserWindow, screen, type Rectangle } from 'electron'
import { join } from 'node:path'
import { logger } from './log'
import { displayNearest, placePanel } from './position'

export const PANEL_WIDTH = 380
export const PANEL_HEIGHT = 540
/** Check the panel this long after a load starts; a load still running by then is stuck. */
const LOAD_CHECK_MS = 5000
/** After the page loads, give React this long to mount before checking. */
const MOUNT_CHECK_MS = 1500
/** A health probe that takes longer than this counts as a failure. */
const PROBE_TIMEOUT_MS = 3000

export class Panel {
  readonly win: BrowserWindow
  private lastHiddenAt = 0
  private lastDisplayId: number | null = null
  private loadFailures = 0
  private loadCheck: NodeJS.Timeout | undefined
  private loadStartedAt = 0

  constructor() {
    const isMac = process.platform === 'darwin'
    this.win = new BrowserWindow({
      width: PANEL_WIDTH,
      height: PANEL_HEIGHT,
      show: false,
      frame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      // A plain window can't open over another app's full-screen Space (macOS switches to a
      // desktop instead); a non-activating panel can, like Spotlight.
      ...(isMac
        ? {
            type: 'panel',
            vibrancy: 'popover' as const,
            visualEffectState: 'active' as const,
            backgroundColor: '#00000000'
          }
        : { backgroundColor: '#1f2328' }),
      roundedCorners: true,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        spellcheck: false
      }
    })

    this.win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

    this.win.on('blur', () => {
      logger.debug('panel blur', { visible: this.win.isVisible() })
      if (this.win.webContents.isDevToolsOpened()) return
      this.hide()
    })

    // Never let external links navigate the panel itself.
    this.win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    this.win.webContents.on('will-navigate', (event) => event.preventDefault())

    // The panel lives for days; recover if it fails to load, loads blank, or its renderer dies.
    this.win.webContents.on('did-fail-load', (_e, code, desc, _url, isMainFrame) => {
      if (!isMainFrame || code === -3 /* ERR_ABORTED */) return
      logger.warn('panel failed to load', { code, desc })
      this.retryLoad()
    })
    this.win.webContents.on('did-finish-load', () => this.scheduleCheck(MOUNT_CHECK_MS))
    this.win.webContents.on('render-process-gone', (_e, details) => {
      logger.error('panel renderer gone', { reason: details.reason })
      this.retryLoad()
    })

    this.load()
  }

  private scheduleCheck(ms: number): void {
    clearTimeout(this.loadCheck)
    this.loadCheck = setTimeout(() => void this.checkHealth('timer'), ms)
  }

  /**
   * Reloads the panel unless the app is mounted. Covers loads that never finish (seen when
   * Chromium's network service restarts mid-load) and pages that load but stay empty.
   * Never relies on executeJavaScript alone: it waits for a pending load and can hang.
   */
  private async checkHealth(reason: 'timer' | 'show'): Promise<void> {
    clearTimeout(this.loadCheck)
    if (this.win.isDestroyed()) return
    const wc = this.win.webContents
    if (wc.isLoading()) {
      // Give a load that just started time to finish before calling it stuck.
      const age = Date.now() - this.loadStartedAt
      if (age < LOAD_CHECK_MS) {
        this.scheduleCheck(LOAD_CHECK_MS - age)
        return
      }
      logger.warn('panel load is stuck, restarting it', { reason, url: wc.getURL(), ms: age })
      wc.stop()
      if (reason === 'show') this.loadFailures = 0
      this.retryLoad()
      return
    }
    const mounted = await Promise.race([
      wc.executeJavaScript('document.getElementById("root")?.childElementCount ?? 0').catch(() => -1) as Promise<number>,
      new Promise<number>((resolve) => setTimeout(() => resolve(-1), PROBE_TIMEOUT_MS))
    ])
    if (mounted > 0) {
      this.loadFailures = 0
      return
    }
    logger.warn('panel is blank, reloading', { reason, url: wc.getURL(), mounted })
    if (reason === 'show') this.loadFailures = 0
    this.retryLoad()
  }

  private retryLoad(): void {
    if (this.loadFailures >= 5) {
      logger.error('panel keeps failing to load; will retry when it is opened')
      return
    }
    this.loadFailures++
    setTimeout(() => this.load(), 1000 * this.loadFailures)
  }

  private load(): void {
    if (this.win.isDestroyed()) return
    this.loadStartedAt = Date.now()
    this.scheduleCheck(LOAD_CHECK_MS)
    if (process.env.ELECTRON_RENDERER_URL) {
      void this.win.loadURL(process.env.ELECTRON_RENDERER_URL)
    } else {
      void this.win.loadFile(join(__dirname, '../renderer/index.html'))
    }
  }

  /** Display the panel was last opened on (for diagnostics). */
  get displayId(): number | null {
    return this.lastDisplayId
  }

  hide(): void {
    if (!this.win.isVisible()) return
    this.lastHiddenAt = Date.now()
    this.win.hide()
  }

  show(trayBounds?: Rectangle): void {
    const [width, height] = this.win.getSize()
    const target = placePanel({
      cursor: screen.getCursorScreenPoint(),
      displays: screen.getAllDisplays(),
      trayBounds,
      size: { width, height },
      platform: process.platform
    })
    this.lastDisplayId = target.displayId
    this.win.setPosition(target.x, target.y, false)
    this.win.show()
    this.win.focus()
    logger.debug('panel shown', { visible: this.win.isVisible(), focused: this.win.isFocused(), target })
    // If the panel is somehow blank, fix it now that the user is looking at it.
    void this.checkHealth('show')
    // macOS can keep a window on the screen it was last shown on; move it again if so.
    const [x, y] = this.win.getPosition()
    if (x !== target.x || y !== target.y) this.win.setPosition(target.x, target.y, false)
  }

  toggle(trayBounds?: Rectangle): void {
    logger.debug('panel toggle', { visible: this.win.isVisible(), sinceHidden: Date.now() - this.lastHiddenAt, trayBounds })
    if (this.win.isVisible()) {
      this.hide()
      return
    }
    // On macOS clicking the tray icon blurs (and hides) the panel right before the
    // click event arrives; don't reopen it in that case, unless the click came from
    // the menu bar of another display.
    const sameDisplay = displayNearest(screen.getAllDisplays(), screen.getCursorScreenPoint()).id === this.lastDisplayId
    if (Date.now() - this.lastHiddenAt < 250 && sameDisplay) return
    this.show(trayBounds)
  }
}

import { app, BrowserWindow, screen, type Rectangle } from 'electron'
import { join } from 'node:path'
import type { PanelSize } from '../shared/types'
import { logger } from './log'
import { decideBlur, decideClick, decideOffScreen, showVerdict, VERIFY_MS, type ClickSource, type Displayed, type HideReason } from './panelDecision'
import { displayNearest, placePanel } from './position'

export const PANEL_WIDTH = 380
export const PANEL_HEIGHT = 540
/** Heights per Settings → Panel size; the width stays the same. */
export const PANEL_HEIGHTS: Record<PanelSize, number> = { compact: 460, default: PANEL_HEIGHT, large: 680 }
/** Check the panel this long after a load starts; a load still running by then is stuck. */
const LOAD_CHECK_MS = 5000
/** After the page loads, give React this long to mount before checking. */
const MOUNT_CHECK_MS = 1500
/** A health probe that takes longer than this counts as a failure. */
const PROBE_TIMEOUT_MS = 3000
/**
 * Window level on macOS. Measured on macOS 27 with `scripts/spaces-probe.swift`: once the window
 * is transient (see the constructor), both the floating level (3) and the status level (25, where
 * the menu bar's own windows live) are displayed over another app's full-screen Space. Status is
 * kept; the log still says when macOS keeps the panel off screen (`panel not displayed after showing`).
 */
const PANEL_LEVEL = 'status'

export class Panel {
  readonly win: BrowserWindow
  private lastHide: { at: number; by: HideReason } = { at: 0, by: 'none' }
  private lastDisplayId: number | null = null
  private loadFailures = 0
  private loadCheck: NodeJS.Timeout | undefined
  private loadStartedAt = 0
  /** While above 0 (a native dialog is open over the panel), losing focus doesn't hide it. */
  private keepOpenCount = 0
  /**
   * Shown and not hidden since. Our own flag: `isVisible()` also says yes for a window that is
   * ordered in but not on screen (another Space), which made a click hide an invisible panel.
   */
  private open = false
  private shownAt = 0
  /** Whether macOS says the window is on screen: its `show`/`hide` events follow occlusion. */
  private displayed: Displayed = 'unknown'
  private blursInGrace = 0
  private reshownOnce = false

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

    // The dock is already hidden (app.dock.hide, LSUIElement): don't let this transform the process again.
    this.win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
    // Development only: PR_RADAR_DEV_PANEL_LEVEL tries another level without rebuilding.
    const devLevel = app.isPackaged ? undefined : process.env.PR_RADAR_DEV_PANEL_LEVEL
    if (isMac) this.win.setAlwaysOnTop(true, (devLevel as typeof PANEL_LEVEL | undefined) ?? PANEL_LEVEL)
    // Chromium marks every always-on-top window "managed" (it takes part in Spaces like a document
    // window) on top of the all-Spaces tag above. On macOS 26/27, closing a full-screen Space
    // rebuilds a managed window's Space list down to the one it is on; ordered front on another
    // Space it then gets the focus but stays off screen, with no occlusion event, or turns up on
    // the old Space. A transient window (what a real NSPanel is) joins every Space again each time
    // it is ordered front. This flag is Electron's only way to the transient behaviour, and a menu
    // bar popover has no business in Mission Control anyway. Measured with scripts/spaces-probe.swift.
    if (isMac) this.win.setHiddenInMissionControl(true)

    this.win.on('show', () => {
      this.displayed = 'yes'
      logger.debug('panel displayed', { msSinceShow: Date.now() - this.shownAt })
    })
    this.win.on('hide', () => {
      const facts = {
        open: this.open,
        wasDisplayed: this.displayed === 'yes',
        keepOpen: this.keepOpenCount > 0,
        devToolsOpen: this.win.webContents.isDevToolsOpened()
      }
      this.displayed = 'no'
      const decision = decideOffScreen(facts)
      logger.debug('panel off screen', { decision, msSinceShow: Date.now() - this.shownAt, ...facts })
      // Not from inside the occlusion notification: let AppKit finish with the window first.
      if (decision === 'hide') setImmediate(() => this.hide('offscreen'))
    })

    this.win.on('blur', () => {
      const facts = {
        msSinceShow: Date.now() - this.shownAt,
        blursInGrace: this.blursInGrace,
        focused: this.win.isFocused(),
        devToolsOpen: this.win.webContents.isDevToolsOpened(),
        keepOpen: this.keepOpenCount > 0
      }
      const decision = decideBlur(facts)
      logger.debug('panel blur', { decision, ...facts })
      if (decision === 'hide') this.hide('blur')
      else if (decision === 'refocus') {
        // The window lost focus before the user could have left: bring it back once.
        this.blursInGrace++
        logger.info('panel blurred right after showing, focusing it again', { msSinceShow: facts.msSinceShow })
        this.win.show()
      } else if (this.open && facts.msSinceShow < 1000 && !facts.devToolsOpen && !facts.keepOpen && !facts.focused) {
        logger.warn('panel keeps losing focus right after showing, leaving it open', { msSinceShow: facts.msSinceShow })
      }
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

  /** Applies Settings → Panel size; a visible panel is placed again so it stays on screen. */
  resize(size: PanelSize): void {
    const height = PANEL_HEIGHTS[size] ?? PANEL_HEIGHT
    if (this.win.getSize()[1] === height) return
    this.win.setSize(PANEL_WIDTH, height, false)
    if (this.open) this.show()
  }

  /**
   * Runs `fn` (a native dialog) with the panel kept on screen: the dialog takes focus, which
   * would otherwise hide the panel and the dialog's sheet with it. Focus returns afterwards.
   */
  async keepOpen<T>(fn: () => Promise<T>): Promise<T> {
    this.keepOpenCount++
    try {
      return await fn()
    } finally {
      this.keepOpenCount--
      if (!this.win.isDestroyed() && this.open && !this.win.isFocused()) this.win.show()
    }
  }

  hide(by: HideReason = 'user'): void {
    if (!this.open) return
    this.open = false
    this.displayed = 'no'
    this.lastHide = { at: Date.now(), by }
    this.win.hide()
    logger.debug('panel hidden', { by })
  }

  /** What the window server and Chromium think of the panel; for the development menu and the logs. */
  async logState(label: string): Promise<void> {
    if (this.win.isDestroyed()) return
    const visibilityState = await Promise.race([
      this.win.webContents.executeJavaScript('document.visibilityState').catch(() => 'error') as Promise<string>,
      new Promise<string>((resolve) => setTimeout(() => resolve('timeout'), 1000))
    ])
    logger.debug(`panel ${label}`, {
      isVisible: this.win.isVisible(),
      isFocused: this.win.isFocused(),
      displayed: this.displayed,
      visibilityState,
      position: this.win.getPosition(),
      cursorDisplay: displayNearest(screen.getAllDisplays(), screen.getCursorScreenPoint()).id,
      msSinceShow: Date.now() - this.shownAt
    })
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
    // A window already on screen gets no new occlusion event when shown again (resize, activate,
    // a notification click): keep what macOS last said in that case.
    if (!this.open || this.displayed !== 'yes') this.displayed = 'unknown'
    this.open = true
    this.shownAt = Date.now()
    this.blursInGrace = 0
    this.reshownOnce = false
    // show() makes the window key without activating the app (it is a panel); focus() would do
    // nothing before the window is visible.
    this.win.show()
    logger.debug('panel shown', { visible: this.win.isVisible(), focused: this.win.isFocused(), target })
    setTimeout(() => this.verify(), VERIFY_MS)
    // If the panel is somehow blank, fix it now that the user is looking at it.
    void this.checkHealth('show')
    // macOS can keep a window on the screen it was last shown on; move it again if so.
    const [x, y] = this.win.getPosition()
    if (x !== target.x || y !== target.y) this.win.setPosition(target.x, target.y, false)
  }

  /** A look shortly after showing: is the panel on screen and focused? Quiet unless something is wrong. */
  private verify(): void {
    if (!this.open || this.win.isDestroyed()) return
    void this.logState('verify')
    const focused = this.win.isFocused()
    const verdict = showVerdict({ displayed: this.displayed, focused })
    if (verdict === 'unfocused') {
      logger.info('panel shown without focus', { displayed: this.displayed })
      this.win.show()
    } else if (verdict === 'not_displayed') {
      logger.warn('panel not displayed after showing', { focused, displayed: this.displayed, level: PANEL_LEVEL })
      // The next click brings it back (once) instead of hiding something nobody sees.
      this.displayed = 'no'
    }
  }

  /** The tray icon was clicked, or the shortcut pressed: open, close, or bring back a stray panel. */
  toggle(trayBounds?: Rectangle, source: ClickSource = 'tray'): void {
    const facts = {
      source,
      open: this.open,
      sameDisplay: displayNearest(screen.getAllDisplays(), screen.getCursorScreenPoint()).id === this.lastDisplayId,
      displayed: this.displayed,
      msSinceHide: Date.now() - this.lastHide.at,
      hiddenBy: this.lastHide.by,
      reshownOnce: this.reshownOnce,
      keepOpen: this.keepOpenCount > 0
    }
    const decision = decideClick(facts)
    logger.debug('panel toggle', { decision, focused: this.win.isFocused(), ...facts })
    switch (decision) {
      case 'show':
        this.show(trayBounds)
        break
      case 'hide':
        this.hide('user')
        break
      case 'refocus':
        logger.info('panel shown again', { reason: !facts.sameDisplay ? 'other display' : 'not displayed', displayed: this.displayed })
        this.show(trayBounds)
        this.reshownOnce = true
        break
      case 'ignore':
        if (!facts.keepOpen) logger.info('panel click ignored', { msSinceHide: facts.msSinceHide })
        break
    }
  }
}

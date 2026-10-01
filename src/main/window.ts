import { BrowserWindow, screen, type Rectangle } from 'electron'
import { join } from 'node:path'
import { displayNearest, placePanel } from './position'

export const PANEL_WIDTH = 380
export const PANEL_HEIGHT = 540

export class Panel {
  readonly win: BrowserWindow
  private lastHiddenAt = 0
  private lastDisplayId: number | null = null
  private loadFailures = 0

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
      ...(isMac
        ? { vibrancy: 'popover' as const, visualEffectState: 'active' as const, backgroundColor: '#00000000' }
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
      if (this.win.webContents.isDevToolsOpened()) return
      this.hide()
    })

    // Never let external links navigate the panel itself.
    this.win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    this.win.webContents.on('will-navigate', (event) => event.preventDefault())

    // The panel lives for days; recover if it fails to load, loads blank, or its renderer dies.
    this.win.webContents.on('did-fail-load', (_e, code, _desc, _url, isMainFrame) => {
      if (isMainFrame && code !== -3 /* ERR_ABORTED */) this.retryLoad()
    })
    this.win.webContents.on('did-finish-load', () => {
      this.win.webContents
        .executeJavaScript('Boolean(document.getElementById("root"))')
        .then((ok) => (ok ? (this.loadFailures = 0) : this.retryLoad()))
        .catch(() => this.retryLoad())
    })
    this.win.webContents.on('render-process-gone', () => this.retryLoad())

    this.load()
  }

  private retryLoad(): void {
    if (this.loadFailures >= 5) return
    this.loadFailures++
    setTimeout(() => this.load(), 1000 * this.loadFailures)
  }

  private load(): void {
    if (this.win.isDestroyed()) return
    if (process.env.ELECTRON_RENDERER_URL) {
      void this.win.loadURL(process.env.ELECTRON_RENDERER_URL)
    } else {
      void this.win.loadFile(join(__dirname, '../renderer/index.html'))
    }
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
    // macOS can keep a window on the screen it was last shown on; move it again if so.
    const [x, y] = this.win.getPosition()
    if (x !== target.x || y !== target.y) this.win.setPosition(target.x, target.y, false)
  }

  toggle(trayBounds?: Rectangle): void {
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

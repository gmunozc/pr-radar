import { BrowserWindow, screen, type Rectangle } from 'electron'
import { join } from 'node:path'

export const PANEL_WIDTH = 380
export const PANEL_HEIGHT = 540
const GAP = 6

export class Panel {
  readonly win: BrowserWindow
  private lastHiddenAt = 0
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
    this.position(trayBounds)
    this.win.show()
    this.win.focus()
  }

  toggle(trayBounds?: Rectangle): void {
    if (this.win.isVisible()) {
      this.hide()
      return
    }
    // On macOS clicking the tray icon blurs (and hides) the panel right before the
    // click event arrives; don't reopen it in that case.
    if (Date.now() - this.lastHiddenAt < 250) return
    this.show(trayBounds)
  }

  private position(trayBounds?: Rectangle): void {
    const hasBounds = trayBounds && trayBounds.width > 0 && trayBounds.height > 0
    const anchor = hasBounds
      ? { x: trayBounds.x + trayBounds.width / 2, y: trayBounds.y, height: trayBounds.height }
      : { ...screen.getCursorScreenPoint(), height: 0 }

    const { workArea } = screen.getDisplayNearestPoint({ x: Math.round(anchor.x), y: Math.round(anchor.y) })
    const [width, height] = this.win.getSize()

    let x = Math.round(anchor.x - width / 2)
    x = Math.min(Math.max(x, workArea.x + GAP), workArea.x + workArea.width - width - GAP)

    // Tray in the top half (macOS menu bar, some Linux panels) → open below it; otherwise above.
    const trayAtTop = anchor.y < workArea.y + workArea.height / 2
    let y = trayAtTop ? Math.round(anchor.y + anchor.height + GAP) : Math.round(anchor.y - height - GAP)
    y = Math.min(Math.max(y, workArea.y + GAP), workArea.y + workArea.height - height - GAP)

    this.win.setPosition(x, y, false)
  }
}

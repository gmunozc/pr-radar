import { app, Menu, nativeImage, Tray, type MenuItemConstructorOptions } from 'electron'
import { join } from 'node:path'
import { formatClock } from '../shared/format'
import type { AppState } from '../shared/types'
import { currentLocale, t } from './i18n'
import { trayVisual, type TrayIcon, type TrayStatus } from './trayState'
import type { Panel } from './window'

const isMac = process.platform === 'darwin'
const isLinux = process.platform === 'linux'

function resourcesDir(): string {
  return app.isPackaged ? join(process.resourcesPath, 'resources') : join(__dirname, '../../resources')
}

function icon(name: string) {
  const img = nativeImage.createFromPath(join(resourcesDir(), name))
  if (isMac) img.setTemplateImage(true)
  return img
}

// macOS uses template images (tinted by the system); Windows/Linux use coloured icons.
const ICON_FILES: Record<TrayIcon, string> = isMac
  ? { idle: 'trayTemplate.png', active: 'trayTemplate.png', offline: 'trayOfflineTemplate.png', alert: 'trayAlertTemplate.png' }
  : { idle: 'tray.png', active: 'trayActive.png', offline: 'trayOffline.png', alert: 'trayAlert.png' }

export interface TrayActions {
  refresh(): void
  downloadUpdate?(): void
  logout(): void
  isLoggedIn(): boolean
  /** Extra items at the end of the context menu (development tools). */
  extraMenu?(): MenuItemConstructorOptions[]
}

function statusLabel(status: TrayStatus): string | null {
  switch (status.kind) {
    case 'offline':
      return t('tray.statusOffline')
    case 'rate_limited':
      return status.retryAt
        ? t('tray.statusRateLimited', { time: formatClock(status.retryAt, currentLocale()) })
        : t('tray.statusRateLimitedSoon')
    case 'error':
      return t('tray.statusError')
    case 'session_expired':
      return t('tray.statusSessionExpired')
    default:
      return null
  }
}

export class AppTray {
  private readonly tray: Tray
  private readonly icons = Object.fromEntries(
    (Object.keys(ICON_FILES) as TrayIcon[]).map((k) => [k, icon(ICON_FILES[k])])
  ) as Record<TrayIcon, Electron.NativeImage>
  private count = 0
  private status: TrayStatus = { kind: 'signed_out' }
  private updateVersion: string | null = null
  private iconKind: TrayIcon = 'idle'

  constructor(
    private readonly panel: Panel,
    private readonly actions: TrayActions
  ) {
    this.tray = new Tray(this.icons.idle)
    this.tray.setToolTip('PR Radar')
    if (isMac) this.tray.setIgnoreDoubleClickEvents(true)

    this.tray.on('click', (_e, bounds) => this.panel.toggle(bounds))
    this.tray.on('right-click', () => this.tray.popUpContextMenu(this.buildMenu()))

    // Most Linux tray hosts (AppIndicator) only support a context menu, not click events.
    if (isLinux) this.tray.setContextMenu(this.buildMenu())
  }

  update(state: AppState): void {
    const visual = trayVisual(state)
    this.count = visual.count ?? 0
    this.updateVersion = state.update?.version ?? null
    this.status = visual.status
    if (visual.icon !== this.iconKind) {
      this.iconKind = visual.icon
      this.tray.setImage(this.icons[visual.icon])
    }
    if (isMac) this.tray.setTitle(visual.count ? ` ${visual.count}` : '', { fontType: 'monospacedDigit' })

    let tooltip: string
    if (state.status === 'logged_out') tooltip = t('tray.tooltipSignedOut')
    else if (this.count > 0) tooltip = t('tray.tooltipPending', { count: this.count })
    else tooltip = state.status === 'ready' ? t('tray.tooltipNone') : 'PR Radar'
    const status = statusLabel(visual.status)
    this.tray.setToolTip(status ? `${tooltip}\n${status}` : tooltip)

    if (isLinux) this.tray.setContextMenu(this.buildMenu())
  }

  getBounds() {
    return this.tray.getBounds()
  }

  private buildMenu(): Menu {
    const loggedIn = this.actions.isLoggedIn()
    const openAtLogin = app.getLoginItemSettings().openAtLogin
    const status = statusLabel(this.status)
    const statusItems: MenuItemConstructorOptions[] = status
      ? [
          this.status.kind === 'session_expired'
            ? { label: status, click: () => this.panel.show(this.tray.getBounds()) }
            : { label: status, enabled: false },
          { type: 'separator' }
        ]
      : []
    const updateItems: MenuItemConstructorOptions[] = this.updateVersion
      ? [
          { label: t('tray.downloadUpdate', { version: this.updateVersion }), click: () => this.actions.downloadUpdate?.() },
          { type: 'separator' }
        ]
      : []
    return Menu.buildFromTemplate([
      ...statusItems,
      ...updateItems,
      {
        label: this.count > 0 ? t('tray.openCount', { count: this.count }) : t('tray.open'),
        click: () => this.panel.show(this.tray.getBounds())
      },
      { label: t('tray.refresh'), enabled: loggedIn, click: () => this.actions.refresh() },
      { type: 'separator' },
      {
        label: t('tray.openAtLogin'),
        type: 'checkbox',
        checked: openAtLogin,
        visible: !isLinux,
        click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked })
      },
      { label: t('tray.logout'), enabled: loggedIn, click: () => this.actions.logout() },
      { type: 'separator' },
      { label: t('tray.quit'), accelerator: isMac ? 'Cmd+Q' : undefined, click: () => app.quit() },
      ...(this.actions.extraMenu?.() ?? [])
    ])
  }
}

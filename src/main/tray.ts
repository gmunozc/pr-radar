import { app, Menu, nativeImage, Tray, type MenuItemConstructorOptions } from 'electron'
import { join } from 'node:path'
import type { AppState } from '../shared/types'
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

export interface TrayActions {
  refresh(): void
  logout(): void
  isLoggedIn(): boolean
  /** Extra items at the end of the context menu (development tools). */
  extraMenu?(): MenuItemConstructorOptions[]
}

export class AppTray {
  private readonly tray: Tray
  private readonly idleIcon = icon(isMac ? 'trayTemplate.png' : 'tray.png')
  private readonly activeIcon = isMac ? this.idleIcon : icon('trayActive.png')
  private count = 0

  constructor(
    private readonly panel: Panel,
    private readonly actions: TrayActions
  ) {
    this.tray = new Tray(this.idleIcon)
    this.tray.setToolTip('PR Radar')
    if (isMac) this.tray.setIgnoreDoubleClickEvents(true)

    this.tray.on('click', (_e, bounds) => this.panel.toggle(bounds))
    this.tray.on('right-click', () => this.tray.popUpContextMenu(this.buildMenu()))

    // Most Linux tray hosts (AppIndicator) only support a context menu, not click events.
    if (isLinux) this.tray.setContextMenu(this.buildMenu())
  }

  update(state: AppState): void {
    const count = state.status === 'ready' || state.status === 'error' ? state.prs.length : 0
    this.count = count
    if (isMac) {
      this.tray.setTitle(count > 0 ? ` ${count}` : '', { fontType: 'monospacedDigit' })
    } else {
      this.tray.setImage(count > 0 ? this.activeIcon : this.idleIcon)
    }

    let tooltip = 'PR Radar'
    if (state.status === 'logged_out') tooltip += ' — sin conectar'
    else if (count > 0) tooltip += ` — ${count} ${count === 1 ? 'PR pendiente' : 'PRs pendientes'}`
    else if (state.status === 'ready') tooltip += ' — nada pendiente'
    if (state.error) tooltip += ` (${state.error.message})`
    this.tray.setToolTip(tooltip)

    if (isLinux) this.tray.setContextMenu(this.buildMenu())
  }

  getBounds() {
    return this.tray.getBounds()
  }

  private buildMenu(): Menu {
    const loggedIn = this.actions.isLoggedIn()
    const openAtLogin = app.getLoginItemSettings().openAtLogin
    return Menu.buildFromTemplate([
      {
        label: this.count > 0 ? `Abrir PR Radar (${this.count})` : 'Abrir PR Radar',
        click: () => this.panel.show(this.tray.getBounds())
      },
      { label: 'Actualizar ahora', enabled: loggedIn, click: () => this.actions.refresh() },
      { type: 'separator' },
      {
        label: 'Abrir al iniciar sesión',
        type: 'checkbox',
        checked: openAtLogin,
        visible: !isLinux,
        click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked })
      },
      { label: 'Cerrar sesión de GitHub', enabled: loggedIn, click: () => this.actions.logout() },
      { type: 'separator' },
      { label: 'Salir', accelerator: isMac ? 'Cmd+Q' : undefined, click: () => app.quit() },
      ...(this.actions.extraMenu?.() ?? [])
    ])
  }
}

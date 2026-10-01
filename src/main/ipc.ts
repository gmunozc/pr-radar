import { app, ipcMain, shell } from 'electron'
import { IPC, type AppState, type AuthMethod, type Settings } from '../shared/types'
import { logger } from './log'
import { testNotification } from './notifier'
import { sanitizeSettingsPatch, type SettingsPatch } from './settings'

type SettingsView = Settings & { openAtLogin: boolean }

export interface IpcContext {
  getState(): AppState
  refresh(): Promise<void>
  dismiss(prId: string): void
  snooze(prId: string, option: 'hour' | 'tomorrow'): void
  restoreDismissed(): void
  hasClientId(): boolean
  authMethods(): { available: Record<AuthMethod, boolean>; preferred: AuthMethod }
  switchMethod(): void
  accessUrl(): string
  startLogin(method?: AuthMethod): Promise<void>
  cancelLogin(): void
  logout(): void
  getSettings(): SettingsView
  setSettings(patch: SettingsPatch): SettingsView
  showPanel(): void
  appInfo(): { version: string; packaged: boolean }
  copyDiagnostics(): Promise<{ ok: boolean }>
  openLogs(): Promise<void>
  checkUpdates(): Promise<void>
  downloadUpdate(): Promise<void>
  openUpdateNotes(): Promise<void>
  skipUpdate(): void
}

export function isAllowedExternalUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && (u.hostname === 'github.com' || u.hostname.endsWith('.github.com'))
  } catch {
    return false
  }
}

export function registerIpc(ctx: IpcContext): void {
  ipcMain.handle(IPC.getState, () => ctx.getState())
  ipcMain.handle(IPC.refresh, () => ctx.refresh())
  ipcMain.handle(IPC.dismiss, (_e, prId: unknown) => {
    if (typeof prId === 'string') ctx.dismiss(prId)
  })
  ipcMain.handle(IPC.snooze, (_e, prId: unknown, option: unknown) => {
    if (typeof prId === 'string' && (option === 'hour' || option === 'tomorrow')) ctx.snooze(prId, option)
  })
  ipcMain.handle(IPC.restoreDismissed, () => ctx.restoreDismissed())
  ipcMain.handle(IPC.authHasClientId, () => ctx.hasClientId())
  ipcMain.handle(IPC.authAccessUrl, () => ctx.accessUrl())
  // Login runs in the background; progress is pushed through IPC.authStatus.
  ipcMain.handle(IPC.authStart, (_e, method: unknown) => {
    void ctx.startLogin(method === 'github_app' || method === 'oauth_app' ? method : undefined)
  })
  ipcMain.handle(IPC.authMethods, () => ctx.authMethods())
  ipcMain.handle(IPC.authSwitch, () => ctx.switchMethod())
  ipcMain.handle(IPC.authCancel, () => ctx.cancelLogin())
  ipcMain.handle(IPC.authLogout, () => ctx.logout())
  ipcMain.handle(IPC.settingsGet, () => ctx.getSettings())
  ipcMain.handle(IPC.settingsSet, (_e, patch: unknown) => ctx.setSettings(sanitizeSettingsPatch(patch)))
  ipcMain.handle(IPC.openExternal, async (_e, url: unknown) => {
    if (typeof url === 'string' && isAllowedExternalUrl(url)) await shell.openExternal(url)
  })
  ipcMain.handle(IPC.testNotification, () => testNotification(ctx.showPanel))
  ipcMain.handle(IPC.openNotificationSettings, () => {
    if (process.platform === 'darwin') {
      return shell.openExternal('x-apple.systempreferences:com.apple.Notifications-Settings.extension')
    }
    if (process.platform === 'win32') return shell.openExternal('ms-settings:notifications')
  })
  ipcMain.handle(IPC.quit, () => app.quit())
  ipcMain.handle(IPC.appInfo, () => ctx.appInfo())
  ipcMain.handle(IPC.copyDiagnostics, () => ctx.copyDiagnostics())
  ipcMain.handle(IPC.openLogs, () => ctx.openLogs())
  ipcMain.handle(IPC.updateCheck, () => ctx.checkUpdates())
  ipcMain.handle(IPC.updateDownload, () => ctx.downloadUpdate())
  ipcMain.handle(IPC.updateNotes, () => ctx.openUpdateNotes())
  ipcMain.handle(IPC.updateSkip, () => ctx.skipUpdate())
  ipcMain.on(IPC.rendererError, (_e, message: unknown) => {
    logger.error('panel error', typeof message === 'string' ? message.slice(0, 4000) : 'unknown')
  })
}

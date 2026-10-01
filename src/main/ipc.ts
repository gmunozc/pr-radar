import { app, ipcMain, shell } from 'electron'
import { IPC, MIN_POLL_INTERVAL_SEC, type AppState, type Settings } from '../shared/types'
import { testNotification } from './notifier'

type SettingsView = Settings & { openAtLogin: boolean }
type SettingsPatch = Partial<Settings> & { openAtLogin?: boolean }

export interface IpcContext {
  getState(): AppState
  refresh(): Promise<void>
  hasClientId(): boolean
  accessUrl(): string
  startLogin(): Promise<void>
  cancelLogin(): void
  logout(): void
  getSettings(): SettingsView
  setSettings(patch: SettingsPatch): SettingsView
  showPanel(): void
}

export function isAllowedExternalUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && (u.hostname === 'github.com' || u.hostname.endsWith('.github.com'))
  } catch {
    return false
  }
}

export function sanitizeSettingsPatch(patch: unknown): SettingsPatch {
  if (!patch || typeof patch !== 'object') return {}
  const p = patch as Record<string, unknown>
  const out: SettingsPatch = {}
  for (const key of ['includeTeams', 'notifications', 'showDrafts', 'openAtLogin'] as const) {
    if (typeof p[key] === 'boolean') out[key] = p[key]
  }
  if (typeof p.pollIntervalSec === 'number' && Number.isFinite(p.pollIntervalSec)) {
    out.pollIntervalSec = Math.min(3600, Math.max(MIN_POLL_INTERVAL_SEC, Math.round(p.pollIntervalSec)))
  }
  if (typeof p.clientId === 'string') out.clientId = p.clientId.trim()
  return out
}

export function registerIpc(ctx: IpcContext): void {
  ipcMain.handle(IPC.getState, () => ctx.getState())
  ipcMain.handle(IPC.refresh, () => ctx.refresh())
  ipcMain.handle(IPC.authHasClientId, () => ctx.hasClientId())
  ipcMain.handle(IPC.authAccessUrl, () => ctx.accessUrl())
  // Login runs in the background; progress is pushed through IPC.authStatus.
  ipcMain.handle(IPC.authStart, () => {
    void ctx.startLogin()
  })
  ipcMain.handle(IPC.authCancel, () => ctx.cancelLogin())
  ipcMain.handle(IPC.authLogout, () => ctx.logout())
  ipcMain.handle(IPC.settingsGet, () => ctx.getSettings())
  ipcMain.handle(IPC.settingsSet, (_e, patch: unknown) => ctx.setSettings(sanitizeSettingsPatch(patch)))
  ipcMain.handle(IPC.openExternal, async (_e, url: unknown) => {
    if (typeof url === 'string' && isAllowedExternalUrl(url)) await shell.openExternal(url)
  })
  ipcMain.handle(IPC.testNotification, () => testNotification(ctx.showPanel))
  ipcMain.handle(IPC.quit, () => app.quit())
}

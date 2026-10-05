import { app, ipcMain, shell } from 'electron'
import {
  IPC,
  type ActionResult,
  type AppState,
  type AuthMethod,
  type InstallState,
  type MergeMethod,
  type PrAction,
  type PrDetail,
  type Settings,
  type SnoozeOption
} from '../shared/types'
import { logger } from './log'
import { testNotification } from './notifier'
import { sanitizeSettingsPatch, type SettingsPatch } from './settings'

type SettingsView = Settings & { openAtLogin: boolean }

/** Longest text the panel may put on the clipboard (branch names, links). */
export const MAX_COPY_LENGTH = 500
const MAX_REVIEW_BODY = 2000
const MERGE_METHODS: readonly string[] = ['MERGE', 'SQUASH', 'REBASE']
const SNOOZE_OPTIONS: readonly string[] = ['hour', 'tomorrow', 'push']

export interface IpcContext {
  getState(): AppState
  refresh(): Promise<void>
  dismiss(prId: string): void
  snooze(prId: string, option: SnoozeOption): void
  restoreDismissed(): void
  hidePanel(): void
  prAction(prId: string, action: PrAction): Promise<ActionResult>
  prDetail(prId: string): Promise<PrDetail | null>
  copyText(text: string): Promise<{ ok: boolean }>
  openCheck(url: string): Promise<void>
  relaunch(): void
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
  installUpdate(): Promise<void>
  cancelInstall(): void
  openInstaller(): Promise<void>
  installState(): InstallState
}

export function isAllowedExternalUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && (u.hostname === 'github.com' || u.hostname.endsWith('.github.com'))
  } catch {
    return false
  }
}

/**
 * Check details may live outside github.com (CircleCI, Vercel…); only URLs GitHub itself gave
 * us in the current state may be opened, never arbitrary ones from the renderer.
 */
export function isKnownCheckUrl(state: Pick<AppState, 'prs' | 'myPrs' | 'involved'>, url: string): boolean {
  if (!url.startsWith('https://')) return false
  const all = [...state.prs, ...state.myPrs, ...state.involved]
  return all.some((pr) => pr.checks.some((check) => check.url === url))
}

/** Validates an action sent by the panel; anything unexpected is dropped rather than guessed. */
export function parsePrAction(value: unknown): PrAction | null {
  if (!value || typeof value !== 'object') return null
  const a = value as Record<string, unknown>
  switch (a.kind) {
    case 'update_branch':
    case 'disable_auto_merge':
    case 'rerequest_review':
    case 'disarm_merge':
      return { kind: a.kind }
    case 'enable_auto_merge':
    case 'merge':
    case 'arm_merge':
      return typeof a.method === 'string' && MERGE_METHODS.includes(a.method)
        ? { kind: a.kind, method: a.method as MergeMethod }
        : null
    case 'approve':
      if (a.body === undefined) return { kind: 'approve' }
      return typeof a.body === 'string' && a.body.length <= MAX_REVIEW_BODY ? { kind: 'approve', body: a.body } : null
    default:
      return null
  }
}

export function registerIpc(ctx: IpcContext): void {
  ipcMain.handle(IPC.getState, () => ctx.getState())
  ipcMain.handle(IPC.refresh, () => ctx.refresh())
  ipcMain.handle(IPC.dismiss, (_e, prId: unknown) => {
    if (typeof prId === 'string') ctx.dismiss(prId)
  })
  ipcMain.handle(IPC.prAction, (_e, prId: unknown, action: unknown): Promise<ActionResult> | ActionResult => {
    const parsed = parsePrAction(action)
    if (typeof prId !== 'string' || !parsed) return { ok: false, code: 'unknown', detail: 'Invalid request' }
    return ctx.prAction(prId, parsed)
  })
  ipcMain.handle(IPC.prDetail, (_e, prId: unknown) => (typeof prId === 'string' ? ctx.prDetail(prId) : null))
  ipcMain.handle(IPC.copyText, (_e, text: unknown) =>
    typeof text === 'string' && text.length <= MAX_COPY_LENGTH ? ctx.copyText(text) : { ok: false }
  )
  ipcMain.handle(IPC.relaunch, () => ctx.relaunch())
  ipcMain.handle(IPC.openCheck, async (_e, url: unknown) => {
    if (typeof url === 'string') await ctx.openCheck(url)
  })
  ipcMain.handle(IPC.snooze, (_e, prId: unknown, option: unknown) => {
    if (typeof prId === 'string' && typeof option === 'string' && SNOOZE_OPTIONS.includes(option)) {
      ctx.snooze(prId, option as SnoozeOption)
    }
  })
  ipcMain.handle(IPC.panelHide, () => ctx.hidePanel())
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
  ipcMain.handle(IPC.updateInstall, () => ctx.installUpdate())
  ipcMain.handle(IPC.updateInstallCancel, () => ctx.cancelInstall())
  ipcMain.handle(IPC.updateOpenInstaller, () => ctx.openInstaller())
  ipcMain.handle(IPC.updateInstallStateGet, () => ctx.installState())
  ipcMain.on(IPC.rendererError, (_e, message: unknown) => {
    logger.error('panel error', typeof message === 'string' ? message.slice(0, 4000) : 'unknown')
  })
}

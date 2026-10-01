import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC, type AppState, type AuthStatus, type PrRadarApi } from '../shared/types'

function subscribe<T>(channel: string, cb: (value: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, value: T) => cb(value)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: PrRadarApi = {
  platform: process.platform,
  getState: () => ipcRenderer.invoke(IPC.getState),
  onState: (cb) => subscribe<AppState>(IPC.state, cb),
  refresh: () => ipcRenderer.invoke(IPC.refresh),
  dismiss: (prId) => ipcRenderer.invoke(IPC.dismiss, prId),
  restoreDismissed: () => ipcRenderer.invoke(IPC.restoreDismissed),
  auth: {
    start: () => ipcRenderer.invoke(IPC.authStart),
    cancel: () => ipcRenderer.invoke(IPC.authCancel),
    logout: () => ipcRenderer.invoke(IPC.authLogout),
    hasClientId: () => ipcRenderer.invoke(IPC.authHasClientId),
    accessUrl: () => ipcRenderer.invoke(IPC.authAccessUrl)
  },
  onAuthStatus: (cb) => subscribe<AuthStatus>(IPC.authStatus, cb),
  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet),
    set: (patch) => ipcRenderer.invoke(IPC.settingsSet, patch)
  },
  openExternal: (url) => ipcRenderer.invoke(IPC.openExternal, url),
  testNotification: () => ipcRenderer.invoke(IPC.testNotification),
  openNotificationSettings: () => ipcRenderer.invoke(IPC.openNotificationSettings),
  appInfo: () => ipcRenderer.invoke(IPC.appInfo),
  copyDiagnostics: () => ipcRenderer.invoke(IPC.copyDiagnostics),
  openLogs: () => ipcRenderer.invoke(IPC.openLogs),
  reportError: (message) => ipcRenderer.send(IPC.rendererError, String(message).slice(0, 4000)),
  quit: () => ipcRenderer.invoke(IPC.quit)
}

contextBridge.exposeInMainWorld('prRadar', api)

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC, type AppState, type AuthStatus, type PrRadarApi, type Settings } from '../shared/types'

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
  snooze: (prId, option) => ipcRenderer.invoke(IPC.snooze, prId, option),
  restoreDismissed: () => ipcRenderer.invoke(IPC.restoreDismissed),
  hidePanel: () => ipcRenderer.invoke(IPC.panelHide),
  prs: {
    action: (prId, action) => ipcRenderer.invoke(IPC.prAction, prId, action)
  },
  copyText: (text) => ipcRenderer.invoke(IPC.copyText, text),
  relaunch: () => ipcRenderer.invoke(IPC.relaunch),
  auth: {
    start: (method) => ipcRenderer.invoke(IPC.authStart, method),
    cancel: () => ipcRenderer.invoke(IPC.authCancel),
    logout: () => ipcRenderer.invoke(IPC.authLogout),
    hasClientId: () => ipcRenderer.invoke(IPC.authHasClientId),
    methods: () => ipcRenderer.invoke(IPC.authMethods),
    switchMethod: () => ipcRenderer.invoke(IPC.authSwitch),
    accessUrl: () => ipcRenderer.invoke(IPC.authAccessUrl)
  },
  onAuthStatus: (cb) => subscribe<AuthStatus>(IPC.authStatus, cb),
  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet),
    set: (patch) => ipcRenderer.invoke(IPC.settingsSet, patch)
  },
  onSettings: (cb) => subscribe<Settings & { openAtLogin: boolean }>(IPC.settingsChanged, cb),
  openExternal: (url) => ipcRenderer.invoke(IPC.openExternal, url),
  openCheck: (url) => ipcRenderer.invoke(IPC.openCheck, url),
  testNotification: () => ipcRenderer.invoke(IPC.testNotification),
  openNotificationSettings: () => ipcRenderer.invoke(IPC.openNotificationSettings),
  appInfo: () => ipcRenderer.invoke(IPC.appInfo),
  copyDiagnostics: () => ipcRenderer.invoke(IPC.copyDiagnostics),
  openLogs: () => ipcRenderer.invoke(IPC.openLogs),
  reportError: (message) => ipcRenderer.send(IPC.rendererError, String(message).slice(0, 4000)),
  updates: {
    check: () => ipcRenderer.invoke(IPC.updateCheck),
    download: () => ipcRenderer.invoke(IPC.updateDownload),
    openNotes: () => ipcRenderer.invoke(IPC.updateNotes),
    skip: () => ipcRenderer.invoke(IPC.updateSkip)
  },
  quit: () => ipcRenderer.invoke(IPC.quit)
}

contextBridge.exposeInMainWorld('prRadar', api)

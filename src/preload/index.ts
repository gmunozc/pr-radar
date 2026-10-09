import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { LaunchersView } from '../shared/launchers'
import { IPC, type AppState, type AuthStatus, type InstallState, type PrRadarApi, type Settings } from '../shared/types'

function subscribe<T>(channel: string, cb: (value: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, value: T) => cb(value)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: PrRadarApi = {
  platform: process.platform,
  getState: () => ipcRenderer.invoke(IPC.getState),
  onState: (cb) => subscribe<AppState>(IPC.state, cb),
  onChecked: (cb) => subscribe<number>(IPC.checked, cb),
  onFocusPr: (cb) => subscribe<string>(IPC.focusPr, cb),
  refresh: () => ipcRenderer.invoke(IPC.refresh),
  dismiss: (prId) => ipcRenderer.invoke(IPC.dismiss, prId),
  snooze: (prId, option) => ipcRenderer.invoke(IPC.snooze, prId, option),
  restoreDismissed: () => ipcRenderer.invoke(IPC.restoreDismissed),
  hidePanel: () => ipcRenderer.invoke(IPC.panelHide),
  prs: {
    action: (prId, action) => ipcRenderer.invoke(IPC.prAction, prId, action),
    detail: (prId) => ipcRenderer.invoke(IPC.prDetail, prId),
    thread: (prId) => ipcRenderer.invoke(IPC.prThread, prId)
  },
  copyText: (text) => ipcRenderer.invoke(IPC.copyText, text),
  copyLink: (link) => ipcRenderer.invoke(IPC.copyLink, link),
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
  openLink: (url) => ipcRenderer.invoke(IPC.openLink, url),
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
    skip: () => ipcRenderer.invoke(IPC.updateSkip),
    install: () => ipcRenderer.invoke(IPC.updateInstall),
    cancelInstall: () => ipcRenderer.invoke(IPC.updateInstallCancel),
    openInstaller: () => ipcRenderer.invoke(IPC.updateOpenInstaller),
    installState: () => ipcRenderer.invoke(IPC.updateInstallStateGet),
    onInstallState: (cb) => subscribe<InstallState>(IPC.updateInstallState, cb)
  },
  launchers: {
    get: () => ipcRenderer.invoke(IPC.launchersGet),
    save: (config) => ipcRenderer.invoke(IPC.launchersSave, config),
    addProject: () => ipcRenderer.invoke(IPC.launchersAddProject),
    redetect: (projectId) => ipcRenderer.invoke(IPC.launchersRedetect, projectId),
    skills: (projectId) => ipcRenderer.invoke(IPC.launchersSkills, projectId),
    launch: (prId, actionId) => ipcRenderer.invoke(IPC.launch, prId, actionId),
    openFile: () => ipcRenderer.invoke(IPC.launchersOpenFile),
    openWorktrees: () => ipcRenderer.invoke(IPC.launchersOpenWorktrees),
    onChange: (cb) => subscribe<LaunchersView>(IPC.launchersChanged, cb)
  },
  quit: () => ipcRenderer.invoke(IPC.quit)
}

contextBridge.exposeInMainWorld('prRadar', api)

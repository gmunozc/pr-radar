/** Builds the "Copy diagnostics" report. Pure; index.ts collects the inputs from Electron. */
import type { AppState, Settings } from '../shared/types'
import { redact, type LogEntry } from './log'
import type { StoredAuth } from './session'

export interface DiagnosticsInput {
  app: { version: string; packaged: boolean }
  versions: { electron: string; chrome: string; node: string }
  os: { platform: string; arch: string; release: string }
  locales: readonly string[]
  displays: Array<{ id: number; bounds: { x: number; y: number; width: number; height: number }; scaleFactor: number; primary: boolean }>
  panelDisplayId: number | null
  settings: Settings
  clientIdConfigured: boolean
  auth: StoredAuth | null
  state: AppState
  consecutiveFailures: number
  notificationsSupported: boolean
  logs: LogEntry[]
  now: number
}

const iso = (ms: number | null) => (ms === null ? 'never' : new Date(ms).toISOString())

export function buildDiagnostics(d: DiagnosticsInput): string {
  const { settings, auth, state } = d
  const lines = [
    `PR Radar ${d.app.version} (${d.app.packaged ? 'packaged' : 'development'})`,
    `Electron ${d.versions.electron} · Chrome ${d.versions.chrome} · Node ${d.versions.node}`,
    `OS ${d.os.platform} ${d.os.release} (${d.os.arch})`,
    `Locales ${d.locales.join(', ') || 'unknown'}`,
    `Displays ${d.displays.length}: ${d.displays
      .map((s) => `#${s.id}${s.primary ? '*' : ''} ${s.bounds.width}x${s.bounds.height}@${s.scaleFactor}x at (${s.bounds.x},${s.bounds.y})`)
      .join(' · ')}`,
    `Panel last shown on display ${d.panelDisplayId ?? 'none'}`,
    `Settings includeTeams=${settings.includeTeams} showDrafts=${settings.showDrafts} notifications=${settings.notifications} ` +
      `pollIntervalSec=${settings.pollIntervalSec} clientId=${d.clientIdConfigured ? 'configured' : 'missing'}`,
    // Only counts: the bug template asks users not to share private repository names.
    `Filters hideBots=${settings.hideBots} excludeRepos=${settings.excludeRepos.length} excludeAuthors=${settings.excludeAuthors.length} ` +
      `staleAfterDays=${settings.staleAfterDays} reviewFilter=${settings.reviewFilter} reviewSort=${settings.reviewSort} ` +
      `showInvolved=${settings.showInvolved} shortcut=${settings.shortcut || 'none'}`,
    auth
      ? `Session ${auth.method} login=${auth.login ?? '?'} token=${auth.accessToken.slice(0, 4)}… expires=${iso(auth.expiresAt)} ` +
        `refresh=${auth.refreshToken ? `yes (until ${iso(auth.refreshTokenExpiresAt)})` : 'no'} updated=${iso(auth.updatedAt || null)}`
      : 'Session none',
    `State ${state.status} reviews=${state.prs.length} mine=${state.myPrs.length} dismissed=${state.dismissedCount} ` +
      `lastUpdated=${state.lastUpdated ?? 'never'} failures=${d.consecutiveFailures} notice=${state.authNotice ?? 'none'}`,
    `Error ${state.error ? `${state.error.code}: ${state.error.detail ?? ''}` : 'none'} connection=${state.connection} locale=${state.locale}`,
    `Warnings ${state.warnings.length ? state.warnings.map((w) => w.code).join(', ') : 'none'}`,
    `Notifications supported=${d.notificationsSupported}`,
    `Generated ${iso(d.now)}`,
    '',
    `Recent warnings and errors (${d.logs.length}):`,
    ...d.logs.map((e) => `  ${e.time} ${e.level.toUpperCase()} ${e.message}`)
  ]
  return redact(lines.join('\n'))
}

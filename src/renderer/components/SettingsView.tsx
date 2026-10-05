import { useEffect, useState } from 'react'
import type { LanguagePref } from '../../shared/i18n'
import {
  MIN_POLL_INTERVAL_SEC,
  SHORTCUT_OPTIONS,
  type AppState,
  type NotifyResult,
  type PanelSize,
  type Settings
} from '../../shared/types'

const PANEL_SIZES: PanelSize[] = ['compact', 'default', 'large']
const MAC_KEYS: Record<string, string> = { CommandOrControl: '⌘', Control: '⌃', Alt: '⌥', Shift: '⇧' }
const PC_KEYS: Record<string, string> = { CommandOrControl: 'Ctrl', Control: 'Ctrl', Alt: 'Alt', Shift: 'Shift' }

/** An Electron accelerator as the user's keyboard shows it: ⌥⇧P on a Mac, Alt+Shift+P elsewhere. */
export function shortcutLabel(accelerator: string, platform: string): string {
  const mac = platform === 'darwin'
  const keys = accelerator.split('+').map((k) => (mac ? MAC_KEYS : PC_KEYS)[k] ?? k)
  return keys.join(mac ? '' : '+')
}
import { useLocale, useT } from '../i18n'
import { openOrgAccess } from './PrList'

const api = window.prRadar

type SettingsState = Settings & { openAtLogin: boolean }

function Toggle({
  label,
  hint,
  checked,
  onChange
}: {
  label: string
  hint?: string
  checked: boolean
  onChange(value: boolean): void
}) {
  return (
    <label className="setting">
      <div className="setting-text">
        <div className="setting-label">{label}</div>
        {hint && <div className="setting-hint">{hint}</div>}
      </div>
      <input type="checkbox" className="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  )
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

/** A time field that saves on blur/Enter and reverts invalid input. */
function TimeInput({ value, onCommit }: { value: string; onCommit(v: string): void }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  const commit = () => (TIME.test(draft) && draft !== value ? onCommit(draft) : setDraft(value))
  return (
    <input
      className="input input-time"
      type="time"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && commit()}
    />
  )
}

/** A comma-separated list that saves on blur/Enter; the main process drops invalid entries. */
function ListInput({ label, hint, value, onCommit }: { label: string; hint: string; value: string[]; onCommit(v: string[]): void }) {
  const joined = value.join(', ')
  const [draft, setDraft] = useState(joined)
  useEffect(() => setDraft(joined), [joined])
  const commit = () => {
    const list = draft
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    if (list.join(',') !== value.join(',')) onCommit(list)
    else setDraft(joined)
  }
  return (
    <label className="setting setting-column">
      <div className="setting-text">
        <div className="setting-label">{label}</div>
        <div className="setting-hint">{hint}</div>
      </div>
      <input
        className="input"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
        spellCheck={false}
      />
    </label>
  )
}

// Monday first; 0 = Sunday. 2026-01-04 was a Sunday, so 4 + d is weekday d.
const WEEK = [1, 2, 3, 4, 5, 6, 0]

export function SettingsView({ state }: { state: AppState }) {
  const t = useT()
  const locale = useLocale()
  const [bothMethods, setBothMethods] = useState(false)
  useEffect(() => {
    void api.auth.methods().then((m) => setBothMethods(m.available.github_app && m.available.oauth_app))
  }, [])
  const [settings, setSettings] = useState<SettingsState | null>(null)
  const [interval, setIntervalValue] = useState('')
  const [stale, setStale] = useState('')
  const [shortcutTaken, setShortcutTaken] = useState(false)
  const [testResult, setTestResult] = useState<NotifyResult | 'sending' | null>(null)
  const [version, setVersion] = useState('')
  const [copied, setCopied] = useState(false)
  const [updateCheck, setUpdateCheck] = useState<'idle' | 'checking' | 'up_to_date' | 'available'>('idle')
  // Chromium's own UI (time fields, menus) only picks up a new language after a restart.
  const [languageChanged, setLanguageChanged] = useState(false)

  const checkNow = async () => {
    setUpdateCheck('checking')
    await api.updates.check()
    setUpdateCheck((await api.getState()).update ? 'available' : 'up_to_date')
  }

  useEffect(() => {
    void api.appInfo().then((info) => setVersion(info.version))
    void api.settings.get().then((s) => {
      setSettings(s)
      setIntervalValue(String(s.pollIntervalSec))
      setStale(String(s.staleAfterDays))
    })
  }, [])

  if (!settings) return <main className="settings" />

  const update = async (patch: Partial<SettingsState>) => {
    const next = await api.settings.set(patch)
    setSettings(next)
    setIntervalValue(String(next.pollIntervalSec))
    setStale(String(next.staleAfterDays))
    return next
  }

  const chooseShortcut = async (shortcut: string) => {
    const next = await update({ shortcut })
    // The main process falls back to none when another app owns the shortcut.
    setShortcutTaken(shortcut !== '' && next.shortcut === '')
  }

  const commitInterval = () => {
    const n = Number(interval)
    if (Number.isFinite(n) && n !== settings.pollIntervalSec) void update({ pollIntervalSec: n })
    else setIntervalValue(String(settings.pollIntervalSec))
  }

  const commitStale = () => {
    const n = Number(stale)
    if (Number.isFinite(n) && n !== settings.staleAfterDays) void update({ staleAfterDays: n })
    else setStale(String(settings.staleAfterDays))
  }

  const runTest = async () => {
    setTestResult('sending')
    setTestResult(await api.testNotification())
  }

  const copyDiagnostics = async () => {
    const { ok } = await api.copyDiagnostics()
    setCopied(ok)
    if (ok) setTimeout(() => setCopied(false), 2000)
  }

  const isLinux = api.platform === 'linux'
  const isApp = state.authMethod === 'github_app'

  return (
    <main className="settings">
      <section className="group">
        <div className="group-title">{t('settings.whatToReview')}</div>
        <Toggle
          label={t('settings.includeTeams')}
          hint={t('settings.includeTeamsHint')}
          checked={settings.includeTeams}
          onChange={(v) => void update({ includeTeams: v })}
        />
        <Toggle
          label={t('settings.showDrafts')}
          checked={settings.showDrafts}
          onChange={(v) => void update({ showDrafts: v })}
        />
        <Toggle
          label={t('settings.hideBots')}
          hint={t('settings.hideBotsHint')}
          checked={settings.hideBots}
          onChange={(v) => void update({ hideBots: v })}
        />
        <Toggle
          label={t('settings.showInvolved')}
          hint={t('settings.showInvolvedHint')}
          checked={settings.showInvolved}
          onChange={(v) => void update({ showInvolved: v })}
        />
        <ListInput
          label={t('settings.excludeRepos')}
          hint={t('settings.excludeReposHint')}
          value={settings.excludeRepos}
          onCommit={(excludeRepos) => void update({ excludeRepos })}
        />
        <ListInput
          label={t('settings.excludeAuthors')}
          hint={t('settings.excludeAuthorsHint')}
          value={settings.excludeAuthors}
          onCommit={(excludeAuthors) => void update({ excludeAuthors })}
        />
        <label className="setting">
          <div className="setting-text">
            <div className="setting-label">{t('settings.staleDays')}</div>
            <div className="setting-hint">{t('settings.staleDaysHint')}</div>
          </div>
          <div className="row">
            <input
              className="input input-num"
              type="number"
              min={0}
              max={30}
              value={stale}
              onChange={(e) => setStale(e.target.value)}
              onBlur={commitStale}
              onKeyDown={(e) => e.key === 'Enter' && commitStale()}
            />
            <span className="unit">{t('settings.days')}</span>
          </div>
        </label>
      </section>

      <section className="group">
        <div className="group-title">{t('settings.alerts')}</div>
        <Toggle
          label={t('settings.notifications')}
          hint={t('settings.notificationsHint')}
          checked={settings.notifications}
          onChange={(v) => void update({ notifications: v })}
        />
        <Toggle
          label={t('settings.notifyMyPrs')}
          hint={t('settings.notifyMyPrsHint')}
          checked={settings.notifyMyPrs}
          onChange={(v) => void update({ notifyMyPrs: v })}
        />
        <label className="setting">
          <div className="setting-text">
            <div className="setting-label">{t('settings.digest')}</div>
            <div className="setting-hint">{t('settings.digestHint')}</div>
          </div>
          {settings.digest && <TimeInput value={settings.digestTime} onCommit={(v) => void update({ digestTime: v })} />}
          <input
            type="checkbox"
            className="switch"
            checked={settings.digest}
            onChange={(e) => void update({ digest: e.target.checked })}
          />
        </label>
        <Toggle
          label={t('settings.quietHours')}
          hint={t('settings.quietHoursHint')}
          checked={settings.quietHours}
          onChange={(v) => void update({ quietHours: v })}
        />
        {settings.quietHours && (
          <div className="setting setting-column">
            <div className="row">
              <span className="setting-label">{t('settings.workHours')}</span>
              <span className="spacer" />
              <TimeInput value={settings.workStart} onCommit={(v) => void update({ workStart: v })} />
              <span className="unit">{t('settings.to')}</span>
              <TimeInput value={settings.workEnd} onCommit={(v) => void update({ workEnd: v })} />
            </div>
            <div className="days">
              {WEEK.map((day) => {
                const on = settings.workDays.includes(day)
                const label = new Intl.DateTimeFormat(locale, { weekday: 'narrow' }).format(new Date(2026, 0, 4 + day))
                const name = new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(new Date(2026, 0, 4 + day))
                return (
                  <button
                    key={day}
                    className={`day ${on ? 'day-on' : ''}`}
                    title={name}
                    aria-pressed={on}
                    // Keep at least one working day.
                    disabled={on && settings.workDays.length === 1}
                    onClick={() =>
                      void update({ workDays: on ? settings.workDays.filter((d) => d !== day) : [...settings.workDays, day] })
                    }
                  >
                    {label}
                  </button>
                )
              })}
            </div>
          </div>
        )}
        <label className="setting">
          <div className="setting-text">
            <div className="setting-label">{t('settings.interval')}</div>
            <div className="setting-hint">{t('settings.intervalHint', { min: MIN_POLL_INTERVAL_SEC })}</div>
          </div>
          <div className="row">
            <input
              className="input input-num"
              type="number"
              min={MIN_POLL_INTERVAL_SEC}
              step={5}
              value={interval}
              onChange={(e) => setIntervalValue(e.target.value)}
              onBlur={commitInterval}
              onKeyDown={(e) => e.key === 'Enter' && commitInterval()}
            />
            <span className="unit">s</span>
          </div>
        </label>
        <div className="setting">
          <div className="setting-text">
            <div className="setting-label">{t('settings.test')}</div>
            {testResult === null || testResult === 'sending' ? (
              <div className="setting-hint">{t('settings.testHint')}</div>
            ) : testResult.ok ? (
              <div className="setting-hint">
                {t('settings.testSent')}{' '}
                <button className="link small" onClick={() => void api.openNotificationSettings()}>
                  {t('settings.notificationSettings')}
                </button>
                .
              </div>
            ) : (
              <div className="setting-hint setting-error">
                {t('settings.testFailed', {
                  error: testResult.error === 'unsupported' ? t('notify.unsupported') : testResult.error
                })}{' '}
                <button className="link small" onClick={() => void api.openNotificationSettings()}>
                  {t('settings.openNotificationSettings')}
                </button>
              </div>
            )}
          </div>
          <button className="btn" onClick={() => void runTest()} disabled={testResult === 'sending'}>
            {testResult === 'sending' ? t('settings.sending') : t('settings.testButton')}
          </button>
        </div>
      </section>

      <section className="group">
        <div className="group-title">{t('settings.general')}</div>
        <label className="setting">
          <div className="setting-text">
            <div className="setting-label">{t('settings.language')}</div>
          </div>
          <select
            className="input select"
            value={settings.language}
            onChange={(e) => {
              setLanguageChanged(true)
              void update({ language: e.target.value as LanguagePref })
            }}
          >
            <option value="system">{t('settings.languageSystem')}</option>
            <option value="en">English</option>
            <option value="es">Español</option>
          </select>
        </label>
        {languageChanged && (
          <div className="setting">
            <div className="setting-text">
              <div className="setting-hint">{t('settings.languageRestartHint')}</div>
            </div>
            <button className="btn" onClick={() => void api.relaunch()}>
              {t('settings.restart')}
            </button>
          </div>
        )}
        <label className="setting">
          <div className="setting-text">
            <div className="setting-label">{t('settings.shortcut')}</div>
            <div className={`setting-hint ${shortcutTaken ? 'setting-error' : ''}`}>
              {shortcutTaken ? t('settings.shortcutTaken') : t('settings.shortcutHint')}
            </div>
          </div>
          <select className="input select" value={settings.shortcut} onChange={(e) => void chooseShortcut(e.target.value)}>
            {SHORTCUT_OPTIONS.map((accelerator) => (
              <option key={accelerator} value={accelerator}>
                {accelerator ? shortcutLabel(accelerator, api.platform) : t('settings.shortcutNone')}
              </option>
            ))}
          </select>
        </label>
        <label className="setting">
          <div className="setting-text">
            <div className="setting-label">{t('settings.panelSize')}</div>
          </div>
          <select className="input select" value={settings.panelSize} onChange={(e) => void update({ panelSize: e.target.value as PanelSize })}>
            {PANEL_SIZES.map((size) => (
              <option key={size} value={size}>
                {t(`settings.panelSize.${size}`)}
              </option>
            ))}
          </select>
        </label>
        {!isLinux && (
          <Toggle
            label={t('settings.openAtLogin')}
            checked={settings.openAtLogin}
            onChange={(v) => void update({ openAtLogin: v })}
          />
        )}
        <div className="setting">
          <div className="setting-text">
            <div className="setting-label">{t(isApp ? 'settings.installOrg' : 'settings.orgAccess')}</div>
            <div className="setting-hint">
              {isApp && state.installations?.length
                ? t('settings.installedOn', { accounts: state.installations.map((i) => i.login).join(', ') })
                : t('settings.orgAccessHint')}
            </div>
          </div>
          <button className="btn" onClick={() => void openOrgAccess()}>
            {t('settings.open')}
          </button>
        </div>
        <div className="setting">
          <div className="setting-text">
            <div className="setting-label">{t('settings.account')}</div>
            {state.authMethod && (
              <div className="setting-hint">
                {t('settings.method')}: {t(isApp ? 'settings.methodApp' : 'settings.methodOauth')}
              </div>
            )}
          </div>
          {bothMethods && (
            <button className="btn" onClick={() => void api.auth.switchMethod()}>
              {t('settings.switchMethod')}
            </button>
          )}
          <button className="btn btn-danger" onClick={() => void api.auth.logout()}>
            {t('settings.logout')}
          </button>
        </div>
        <div className="setting">
          <div className="setting-text">
            <div className="setting-label">{t('settings.quitApp')}</div>
          </div>
          <button className="btn" onClick={() => void api.quit()}>
            {t('settings.quit')}
          </button>
        </div>
      </section>

      <section className="group">
        <div className="group-title">{t('settings.help')}</div>
        <label className="setting">
          <div className="setting-text">
            <div className="setting-label">{t('settings.checkUpdates')}</div>
            <div className="setting-hint">
              {t('settings.checkUpdatesHint', { version })}
              {updateCheck === 'up_to_date' ? ` · ${t('settings.upToDate')}` : ''}
            </div>
          </div>
          <button className="btn" onClick={() => void checkNow()} disabled={updateCheck === 'checking'}>
            {updateCheck === 'checking' ? '…' : t('settings.checkNow')}
          </button>
          <input
            type="checkbox"
            className="switch"
            checked={settings.checkUpdates}
            onChange={(e) => void update({ checkUpdates: e.target.checked })}
          />
        </label>
        <div className="setting">
          <div className="setting-text">
            <div className="setting-label">{t('settings.diagnostics')}</div>
            <div className="setting-hint">{t('settings.diagnosticsHint', { version })}</div>
          </div>
          <button className="btn" onClick={() => void copyDiagnostics()}>
            {copied ? t('settings.copied') : t('settings.copy')}
          </button>
        </div>
        <div className="setting">
          <div className="setting-text">
            <div className="setting-label">{t('settings.logs')}</div>
          </div>
          <button className="btn" onClick={() => void api.openLogs()}>
            {t('settings.openFolder')}
          </button>
        </div>
      </section>
    </main>
  )
}

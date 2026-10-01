import { useEffect, useState } from 'react'
import type { LanguagePref } from '../../shared/i18n'
import { MIN_POLL_INTERVAL_SEC, type NotifyResult, type Settings } from '../../shared/types'
import { useT } from '../i18n'
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

export function SettingsView() {
  const t = useT()
  const [settings, setSettings] = useState<SettingsState | null>(null)
  const [interval, setIntervalValue] = useState('')
  const [testResult, setTestResult] = useState<NotifyResult | 'sending' | null>(null)
  const [version, setVersion] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    void api.appInfo().then((info) => setVersion(info.version))
    void api.settings.get().then((s) => {
      setSettings(s)
      setIntervalValue(String(s.pollIntervalSec))
    })
  }, [])

  if (!settings) return <main className="settings" />

  const update = async (patch: Partial<SettingsState>) => {
    const next = await api.settings.set(patch)
    setSettings(next)
    setIntervalValue(String(next.pollIntervalSec))
  }

  const commitInterval = () => {
    const n = Number(interval)
    if (Number.isFinite(n) && n !== settings.pollIntervalSec) void update({ pollIntervalSec: n })
    else setIntervalValue(String(settings.pollIntervalSec))
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
            onChange={(e) => void update({ language: e.target.value as LanguagePref })}
          >
            <option value="system">{t('settings.languageSystem')}</option>
            <option value="en">English</option>
            <option value="es">Español</option>
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
            <div className="setting-label">{t('settings.orgAccess')}</div>
            <div className="setting-hint">{t('settings.orgAccessHint')}</div>
          </div>
          <button className="btn" onClick={() => void openOrgAccess()}>
            {t('settings.open')}
          </button>
        </div>
        <div className="setting">
          <div className="setting-text">
            <div className="setting-label">{t('settings.account')}</div>
          </div>
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

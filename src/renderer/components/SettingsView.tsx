import { useEffect, useState } from 'react'
import { MIN_POLL_INTERVAL_SEC, type NotifyResult, type Settings } from '../../shared/types'
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
  const [settings, setSettings] = useState<SettingsState | null>(null)
  const [interval, setIntervalValue] = useState('')
  const [testResult, setTestResult] = useState<NotifyResult | 'sending' | null>(null)

  useEffect(() => {
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

  const isLinux = api.platform === 'linux'

  const runTest = async () => {
    setTestResult('sending')
    setTestResult(await api.testNotification())
  }

  return (
    <main className="settings">
      <section className="group">
        <div className="group-title">Qué revisar</div>
        <Toggle
          label="Incluir solicitudes a mis equipos"
          hint="Si está desactivado, solo las reviews pedidas a ti directamente."
          checked={settings.includeTeams}
          onChange={(v) => void update({ includeTeams: v })}
        />
        <Toggle
          label="Mostrar PRs en draft"
          checked={settings.showDrafts}
          onChange={(v) => void update({ showDrafts: v })}
        />
      </section>

      <section className="group">
        <div className="group-title">Avisos</div>
        <Toggle
          label="Notificaciones"
          hint="Aviso nativo cuando te asignen una review nueva."
          checked={settings.notifications}
          onChange={(v) => void update({ notifications: v })}
        />
        <label className="setting">
          <div className="setting-text">
            <div className="setting-label">Revisar cada</div>
            <div className="setting-hint">Segundos entre consultas (mínimo {MIN_POLL_INTERVAL_SEC}).</div>
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
            <div className="setting-label">Probar notificación</div>
            {testResult === null || testResult === 'sending' ? (
              <div className="setting-hint">En macOS, la primera vez pedirá permiso.</div>
            ) : testResult.ok ? (
              <div className="setting-hint">
                Enviada al Centro de notificaciones. Si no apareció el aviso, desactiva Concentración o activa
                los avisos de PR Radar en{' '}
                <button className="link small" onClick={() => void api.openNotificationSettings()}>
                  Ajustes de notificaciones
                </button>
                .
              </div>
            ) : (
              <div className="setting-hint setting-error">
                No se pudo mostrar: {testResult.error}{' '}
                <button className="link small" onClick={() => void api.openNotificationSettings()}>
                  Abrir ajustes de notificaciones
                </button>
              </div>
            )}
          </div>
          <button className="btn" onClick={() => void runTest()} disabled={testResult === 'sending'}>
            {testResult === 'sending' ? 'Enviando…' : 'Probar'}
          </button>
        </div>
      </section>

      <section className="group">
        <div className="group-title">General</div>
        {!isLinux && (
          <Toggle
            label="Abrir al iniciar sesión"
            checked={settings.openAtLogin}
            onChange={(v) => void update({ openAtLogin: v })}
          />
        )}
        <div className="setting">
          <div className="setting-text">
            <div className="setting-label">Acceso a organizaciones</div>
            <div className="setting-hint">Si faltan PRs de una org, concede o solicita acceso a la app.</div>
          </div>
          <button className="btn" onClick={() => void openOrgAccess()}>
            Abrir
          </button>
        </div>
        <div className="setting">
          <div className="setting-text">
            <div className="setting-label">Cuenta de GitHub</div>
          </div>
          <button className="btn btn-danger" onClick={() => void api.auth.logout()}>
            Cerrar sesión
          </button>
        </div>
        <div className="setting">
          <div className="setting-text">
            <div className="setting-label">Salir de PR Radar</div>
          </div>
          <button className="btn" onClick={() => void api.quit()}>
            Salir
          </button>
        </div>
      </section>
    </main>
  )
}

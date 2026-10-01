import { useEffect, useState } from 'react'
import type { AuthStatus } from '../../shared/types'
import { PullRequestIcon } from '../icons'

const api = window.prRadar
const NEW_OAUTH_APP_URL = 'https://github.com/settings/applications/new'

function Countdown({ expiresAt }: { expiresAt: number }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  const left = Math.max(0, Math.round((expiresAt - now) / 1000))
  const mm = Math.floor(left / 60)
  const ss = String(left % 60).padStart(2, '0')
  return (
    <span>
      El código expira en {mm}:{ss}
    </span>
  )
}

function ClientIdForm({ onSaved }: { onSaved(): void }) {
  const [value, setValue] = useState('')
  const save = async () => {
    if (!value.trim()) return
    await api.settings.set({ clientId: value.trim() })
    onSaved()
  }
  return (
    <div className="setup">
      <p className="login-text">
        Para conectar con GitHub necesitas el <b>Client ID</b> de una OAuth App con <b>Device Flow</b> activado.
      </p>
      <ol className="steps">
        <li>
          <button className="link" onClick={() => void api.openExternal(NEW_OAUTH_APP_URL)}>
            Crea una OAuth App
          </button>{' '}
          (Homepage y Callback: <code>http://localhost</code>).
        </li>
        <li>
          Marca <b>Enable Device Flow</b> y guarda.
        </li>
        <li>Copia el Client ID y pégalo aquí:</li>
      </ol>
      <div className="row">
        <input
          className="input"
          placeholder="Ov23li…"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void save()}
          autoFocus
        />
        <button className="btn btn-primary" onClick={() => void save()} disabled={!value.trim()}>
          Guardar
        </button>
      </div>
    </div>
  )
}

export function LoginView({ auth }: { auth: AuthStatus }) {
  const [hasClientId, setHasClientId] = useState<boolean | null>(null)
  const [starting, setStarting] = useState(false)

  useEffect(() => {
    void api.auth.hasClientId().then(setHasClientId)
  }, [])

  useEffect(() => {
    if (auth.phase !== 'idle') setStarting(false)
  }, [auth])

  const start = () => {
    setStarting(true)
    void api.auth.start()
  }

  return (
    <div className="login">
      <div className="logo">
        <PullRequestIcon size={28} />
      </div>
      <h1 className="login-title">PR Radar</h1>

      {hasClientId === false ? (
        <ClientIdForm onSaved={() => setHasClientId(true)} />
      ) : auth.phase === 'waiting' ? (
        <div className="device">
          <p className="login-text">Introduce este código en GitHub para autorizar la app:</p>
          <div className="code" title="Copiado al portapapeles">
            {auth.userCode}
          </div>
          <div className="hint">Copiado al portapapeles</div>
          <button className="btn btn-primary" onClick={() => void api.openExternal(auth.verificationUri)}>
            Abrir {auth.verificationUri.replace(/^https:\/\//, '')}
          </button>
          <div className="waiting">
            <div className="spinner spinner-sm" />
            <span>Esperando autorización…</span>
          </div>
          <div className="hint">
            <Countdown expiresAt={auth.expiresAt} />
          </div>
          <button className="btn btn-ghost" onClick={() => void api.auth.cancel()}>
            Cancelar
          </button>
        </div>
      ) : (
        <>
          <p className="login-text">
            Conecta tu cuenta de GitHub y te avisaremos cada vez que te pidan revisar un pull request.
          </p>
          {auth.phase === 'error' && <div className="banner banner-error inline">{auth.message}</div>}
          <button className="btn btn-primary btn-lg" onClick={start} disabled={starting || hasClientId === null}>
            {starting ? 'Conectando…' : 'Conectar con GitHub'}
          </button>
          {auth.phase === 'error' && (
            <button className="link small" onClick={() => setHasClientId(false)}>
              Cambiar Client ID
            </button>
          )}
        </>
      )}
      <button className="link small quit" onClick={() => void api.quit()}>
        Salir
      </button>
    </div>
  )
}

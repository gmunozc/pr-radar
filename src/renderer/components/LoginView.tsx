import { useEffect, useState } from 'react'
import type { AuthMethod, AuthNotice, AuthStatus } from '../../shared/types'
import { PullRequestIcon } from '../icons'
import { Rich, useT } from '../i18n'

const api = window.prRadar
const NEW_OAUTH_APP_URL = 'https://github.com/settings/applications/new'

function Countdown({ expiresAt }: { expiresAt: number }) {
  const t = useT()
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  const left = Math.max(0, Math.round((expiresAt - now) / 1000))
  const time = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`
  return <span>{t('login.expiresIn', { time })}</span>
}

function ClientIdForm({ onSaved }: { onSaved(): void }) {
  const t = useT()
  const [value, setValue] = useState('')
  const save = async () => {
    if (!value.trim()) return
    await api.settings.set({ clientId: value.trim() })
    onSaved()
  }
  return (
    <div className="setup">
      <p className="login-text">
        <Rich text={t('setup.intro')} />
      </p>
      <ol className="steps">
        <li>
          <button className="link" onClick={() => void api.openExternal(NEW_OAUTH_APP_URL)}>
            {t('setup.createApp')}
          </button>{' '}
          <Rich text={t('setup.createAppRest')} />
        </li>
        <li>
          <Rich text={t('setup.enableDeviceFlow')} />
        </li>
        <li>{t('setup.paste')}</li>
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
          {t('setup.save')}
        </button>
      </div>
    </div>
  )
}

export function LoginView({ auth, notice }: { auth: AuthStatus; notice: AuthNotice | null }) {
  const t = useT()
  const [hasClientId, setHasClientId] = useState<boolean | null>(null)
  const [methods, setMethods] = useState<{ available: Record<AuthMethod, boolean>; preferred: AuthMethod } | null>(null)
  const [starting, setStarting] = useState(false)

  useEffect(() => {
    void api.auth.hasClientId().then(setHasClientId)
    void api.auth.methods().then(setMethods)
  }, [])

  useEffect(() => {
    if (auth.phase !== 'idle') setStarting(false)
  }, [auth])

  const start = (method?: AuthMethod) => {
    setStarting(true)
    void api.auth.start(method)
  }
  const appAvailable = methods?.available.github_app ?? false

  return (
    <div className="login">
      <div className="logo">
        <PullRequestIcon size={28} />
      </div>
      <h1 className="login-title">PR Radar</h1>

      {hasClientId === false && !appAvailable ? (
        <ClientIdForm onSaved={() => setHasClientId(true)} />
      ) : auth.phase === 'waiting' ? (
        <div className="device">
          <p className="login-text">{t('login.enterCode')}</p>
          <div className="code" title={t('login.copied')}>
            {auth.userCode}
          </div>
          <div className="hint">{t('login.copied')}</div>
          <button className="btn btn-primary" onClick={() => void api.openExternal(auth.verificationUri)}>
            {t('login.open', { host: auth.verificationUri.replace(/^https:\/\//, '') })}
          </button>
          <div className="waiting">
            <div className="spinner spinner-sm" />
            <span>{t('login.waiting')}</span>
          </div>
          <div className="hint">
            <Countdown expiresAt={auth.expiresAt} />
          </div>
          <button className="btn btn-ghost" onClick={() => void api.auth.cancel()}>
            {t('login.cancel')}
          </button>
        </div>
      ) : (
        <>
          <p className="login-text">{t('login.tagline')}</p>
          {notice && auth.phase !== 'error' && <div className="banner banner-warn inline">{t(`notice.${notice}`)}</div>}
          {auth.phase === 'error' && (
            <div className="banner banner-error inline">{t(`authError.${auth.code}`, { detail: auth.detail ?? '' })}</div>
          )}
          <button className="btn btn-primary btn-lg" onClick={() => start()} disabled={starting || methods === null}>
            {starting ? t('login.connecting') : t('login.connect')}
          </button>
          {appAvailable && methods?.available.oauth_app && !starting && (
            <button className="link small use-oauth" title={t('login.useOauthHint')} onClick={() => start('oauth_app')}>
              {t('login.useOauth')}
            </button>
          )}
          {auth.phase === 'error' && (
            <div className="row">
              <button className="link small" onClick={() => setHasClientId(false)}>
                {t('login.changeClientId')}
              </button>
              <span className="hint">·</span>
              <button className="link small" onClick={() => void api.copyDiagnostics()}>
                {t('login.copyDiagnostics')}
              </button>
            </div>
          )}
        </>
      )}
      <button className="link small quit" onClick={() => void api.quit()}>
        {t('login.quit')}
      </button>
    </div>
  )
}

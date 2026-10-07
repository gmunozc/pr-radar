import { useEffect } from 'react'
import { useT } from '../i18n'
import { reloadLaunchers, useLaunchers } from '../useLaunchers'

const api = window.prRadar

/** Settings → "Send to agent": what launchers.json holds, its problems, and where things live. */
export function LaunchersSettings() {
  const t = useT()
  const info = useLaunchers()
  // The file is edited outside the app: read it again whenever Settings opens.
  useEffect(reloadLaunchers, [])
  if (!info) return null

  const status = info.exists ? t('settings.launchersCount', { count: info.actions.length }) : t('settings.launchersNone')

  return (
    <section className="group">
      <div className="group-title">{t('settings.launchers')}</div>
      <div className="setting">
        <div className="setting-text">
          <div className="setting-label">{t('settings.launchersFile')}</div>
          <div className="setting-hint">{t('settings.launchersHint')}</div>
          <div className="setting-hint">
            {status} · <code title={info.path}>launchers.json</code>
          </div>
          {info.errors.map((e, i) => (
            <div key={i} className="confirm-error" role="alert">
              {t(`launchers.error.${e.code}`, { at: e.at, detail: e.detail ?? '' })}
            </div>
          ))}
        </div>
        <button className="btn" onClick={() => void api.launchers.openFile()}>
          {info.exists ? t('settings.open') : t('settings.launchersCreate')}
        </button>
      </div>
      <div className="setting">
        <div className="setting-text">
          <div className="setting-label">{t('settings.launchersWorktrees')}</div>
          <div className="setting-hint">{t('settings.launchersWorktreesHint')}</div>
        </div>
        <button className="btn" onClick={() => void api.launchers.openWorktrees()}>
          {t('settings.openFolder')}
        </button>
      </div>
    </section>
  )
}

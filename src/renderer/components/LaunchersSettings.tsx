import { useEffect } from 'react'
import { useT } from '../i18n'
import { reloadLaunchers, useLaunchers } from '../useLaunchers'

/** Settings → "Send to agent": a summary row that opens its own page. */
export function LaunchersSettings({ onOpen }: { onOpen(): void }) {
  const t = useT()
  const view = useLaunchers()
  // launchers.json can change outside the app: read it again whenever Settings opens.
  useEffect(reloadLaunchers, [])

  const config = view?.config
  const summary =
    config && config.actions.length > 0
      ? `${t('launchers.actionsCount', { count: config.actions.length })} · ${t('launchers.projectsCount', { count: config.projects.length })}`
      : t('settings.launchersNone')

  return (
    <section className="group">
      <div className="group-title">{t('settings.launchers')}</div>
      <div className="setting">
        <div className="setting-text">
          <div className="setting-label">{summary}</div>
          <div className="setting-hint">{t('settings.launchersHint')}</div>
        </div>
        <button className="btn" onClick={onOpen}>
          {t('settings.launchersConfigure')} ›
        </button>
      </div>
    </section>
  )
}

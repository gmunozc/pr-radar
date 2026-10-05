import { useEffect, useState } from 'react'
import type { AppState, InstallState } from '../../shared/types'
import { useT } from '../i18n'

const api = window.prRadar

/**
 * A newer release. On macOS "Install" downloads the dmg, verifies it against the release's
 * checksums and opens it; elsewhere (and as a fallback) "Download" opens the release page.
 */
export function UpdateBanner({ update }: { update: NonNullable<AppState['update']> }) {
  const t = useT()
  const [install, setInstall] = useState<InstallState>({ phase: 'idle' })
  useEffect(() => {
    void api.updates.installState().then(setInstall)
    return api.updates.onInstallState(setInstall)
  }, [])
  const canInstall = api.platform === 'darwin' && update.downloadUrl !== null

  let body
  if (install.phase === 'downloading') {
    const percent = install.percent === null ? null : Math.round(install.percent * 100)
    body = (
      <>
        <div className="progress">
          <div className="progress-bar" style={{ width: `${percent ?? 10}%` }} />
        </div>
        <div className="row update-actions">
          <span className="update-status">
            {percent === null ? t('update.downloadingUnknown') : t('update.downloading', { percent })}
          </span>
          <span className="spacer" />
          <button className="link small" onClick={() => void api.updates.cancelInstall()}>
            {t('update.cancel')}
          </button>
        </div>
      </>
    )
  } else if (install.phase === 'verifying') {
    body = <div className="update-status">{t('update.verifying')}</div>
  } else if (install.phase === 'ready') {
    body = (
      <>
        <div className="update-hint">{t('update.ready')}</div>
        <div className="row update-actions">
          <button className="btn btn-primary btn-small" onClick={() => void api.quit()}>
            {t('update.quitNow')}
          </button>
          <button className="link small" onClick={() => void api.updates.openInstaller()}>
            {t('update.openInstaller')}
          </button>
        </div>
      </>
    )
  } else {
    body = (
      <>
        {install.phase === 'error' && <div className="update-hint update-error">{t(`update.error.${install.code}`)}</div>}
        <div className="update-hint">{t('update.keychainHint')}</div>
        <div className="row update-actions">
          {canInstall ? (
            <button className="btn btn-primary btn-small" onClick={() => void api.updates.install()}>
              {install.phase === 'error' ? t('update.retry') : t('update.install')}
            </button>
          ) : (
            <button className="btn btn-primary btn-small" onClick={() => void api.updates.download()}>
              {t('update.download')}
            </button>
          )}
          <button className="link small" onClick={() => void api.updates.openNotes()}>
            {t('update.notes')}
          </button>
          <span className="spacer" />
          <button className="link small update-skip" onClick={() => void api.updates.skip()}>
            {t('update.skip')}
          </button>
        </div>
      </>
    )
  }

  return (
    <div className="banner banner-update">
      <div className="update-body">
        <div className="update-title">{t('update.available', { version: update.version })}</div>
        {body}
      </div>
    </div>
  )
}

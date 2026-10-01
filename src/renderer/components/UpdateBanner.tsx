import type { AppState } from '../../shared/types'
import { useT } from '../i18n'

const api = window.prRadar

/** A newer release: download it, read the notes or skip this version. */
export function UpdateBanner({ update }: { update: NonNullable<AppState['update']> }) {
  const t = useT()
  return (
    <div className="banner banner-update">
      <div className="update-body">
        <div className="update-title">{t('update.available', { version: update.version })}</div>
        <div className="update-hint">{t('update.keychainHint')}</div>
        <div className="row update-actions">
          <button className="btn btn-primary btn-small" onClick={() => void api.updates.download()}>
            {t('update.download')}
          </button>
          <button className="link small" onClick={() => void api.updates.openNotes()}>
            {t('update.notes')}
          </button>
          <span className="spacer" />
          <button className="link small update-skip" onClick={() => void api.updates.skip()}>
            {t('update.skip')}
          </button>
        </div>
      </div>
    </div>
  )
}

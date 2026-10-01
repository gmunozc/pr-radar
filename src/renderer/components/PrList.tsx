import type { AppState } from '../../shared/types'
import { CheckCircleIcon, PullRequestIcon } from '../icons'
import { useT } from '../i18n'
import { PrItem } from './PrItem'

const REVIEW_REQUESTED_URL = 'https://github.com/pulls/review-requested'

// Organizations that restrict OAuth Apps silently hide their PRs until access is granted.
export const openOrgAccess = async () => window.prRadar.openExternal(await window.prRadar.auth.accessUrl())

function RestoreHidden({ dismissed, snoozed }: { dismissed: number; snoozed: number }) {
  const t = useT()
  const parts = [snoozed ? t('list.snoozed', { count: snoozed }) : '', dismissed ? t('list.dismissed', { count: dismissed }) : '']
  return (
    <span className="dismissed">
      {parts.filter(Boolean).join(' · ')} ·{' '}
      <button className="link" onClick={() => void window.prRadar.restoreDismissed()}>
        {t('list.restore')}
      </button>
    </span>
  )
}

export function PrList({ state }: { state: AppState }) {
  const t = useT()

  if (state.status === 'loading' && state.prs.length === 0) {
    return (
      <main className="list list-empty">
        <div className="spinner" />
      </main>
    )
  }

  if (state.prs.length === 0 && state.warnings.some((w) => w.code === 'app_not_installed')) {
    return (
      <main className="list list-empty">
        <PullRequestIcon size={32} className="empty-icon-muted" />
        <div className="empty-title">{t('install.title')}</div>
        <div className="empty-sub">{t('install.sub')}</div>
        <div className="row install-actions">
          <button className="btn btn-primary" onClick={() => void openOrgAccess()}>
            {t('install.button')}
          </button>
          <button className="btn" onClick={() => void window.prRadar.refresh()}>
            {t('install.refresh')}
          </button>
        </div>
      </main>
    )
  }

  if (state.prs.length === 0) {
    return (
      <main className="list list-empty">
        <CheckCircleIcon size={36} className="empty-icon" />
        <div className="empty-title">{t('list.emptyTitle')}</div>
        <div className="empty-sub">{t('list.emptySub')}</div>
        {state.dismissedCount + state.snoozedCount > 0 ? (
          <div className="empty-hint">
            <RestoreHidden dismissed={state.dismissedCount} snoozed={state.snoozedCount} />
          </div>
        ) : (
          <div className="empty-hint">
            <div>{t('list.orgHintTitle')}</div>
            <div>
              {t(state.authMethod === 'github_app' ? 'list.orgHintApp' : 'list.orgHint')}{' '}
              <button className="link small" onClick={() => void openOrgAccess()}>
                {t(state.authMethod === 'github_app' ? 'list.installOrg' : 'list.orgAccess')}
              </button>
            </div>
          </div>
        )}
      </main>
    )
  }

  return (
    <>
      <main className="list">
        {state.prs.map((pr) => (
          <PrItem key={pr.id} pr={pr} snoozeTomorrowAt={state.snoozeTomorrowAt} />
        ))}
      </main>
      <footer className="footer">
        <button className="link" onClick={() => void window.prRadar.openExternal(REVIEW_REQUESTED_URL)}>
          {t('list.viewAll')}
        </button>
        {state.dismissedCount + state.snoozedCount > 0 && (
          <RestoreHidden dismissed={state.dismissedCount} snoozed={state.snoozedCount} />
        )}
      </footer>
    </>
  )
}

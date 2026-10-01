import type { AppState } from '../../shared/types'
import { CheckCircleIcon } from '../icons'
import { useT } from '../i18n'
import { PrItem } from './PrItem'

const REVIEW_REQUESTED_URL = 'https://github.com/pulls/review-requested'

// Organizations that restrict OAuth Apps silently hide their PRs until access is granted.
export const openOrgAccess = async () => window.prRadar.openExternal(await window.prRadar.auth.accessUrl())

function RestoreDismissed({ count }: { count: number }) {
  const t = useT()
  return (
    <span className="dismissed">
      {t('list.dismissed', { count })} ·{' '}
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

  if (state.prs.length === 0) {
    return (
      <main className="list list-empty">
        <CheckCircleIcon size={36} className="empty-icon" />
        <div className="empty-title">{t('list.emptyTitle')}</div>
        <div className="empty-sub">{t('list.emptySub')}</div>
        {state.dismissedCount > 0 ? (
          <div className="empty-hint">
            <RestoreDismissed count={state.dismissedCount} />
          </div>
        ) : (
          <div className="empty-hint">
            <div>{t('list.orgHintTitle')}</div>
            <div>
              {t('list.orgHint')}{' '}
              <button className="link small" onClick={() => void openOrgAccess()}>
                {t('list.orgAccess')}
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
          <PrItem key={pr.id} pr={pr} />
        ))}
      </main>
      <footer className="footer">
        <button className="link" onClick={() => void window.prRadar.openExternal(REVIEW_REQUESTED_URL)}>
          {t('list.viewAll')}
        </button>
        {state.dismissedCount > 0 && <RestoreDismissed count={state.dismissedCount} />}
      </footer>
    </>
  )
}

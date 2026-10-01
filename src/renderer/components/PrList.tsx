import type { AppState } from '../../shared/types'
import { CheckCircleIcon } from '../icons'
import { PrItem } from './PrItem'

const REVIEW_REQUESTED_URL = 'https://github.com/pulls/review-requested'

// Organizations that restrict OAuth Apps silently hide their PRs until access is granted.
export const openOrgAccess = async () => window.prRadar.openExternal(await window.prRadar.auth.accessUrl())

function RestoreDismissed({ count }: { count: number }) {
  return (
    <span className="dismissed">
      {count === 1 ? '1 descartado' : `${count} descartados`} ·{' '}
      <button className="link" onClick={() => void window.prRadar.restoreDismissed()}>
        Restaurar
      </button>
    </span>
  )
}

export function PrList({ state }: { state: AppState }) {
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
        <div className="empty-title">Nada pendiente de revisar</div>
        <div className="empty-sub">Te avisaremos cuando alguien te pida una review.</div>
        {state.dismissedCount > 0 ? (
          <div className="empty-hint">
            <RestoreDismissed count={state.dismissedCount} />
          </div>
        ) : (
          <div className="empty-hint">
            <div>¿Esperabas ver PRs de tu organización?</div>
            <div>
              Puede que la org restrinja las OAuth Apps.{' '}
              <button className="link small" onClick={() => void openOrgAccess()}>
                Dar acceso a la org
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
          Ver todo en GitHub
        </button>
        {state.dismissedCount > 0 && <RestoreDismissed count={state.dismissedCount} />}
      </footer>
    </>
  )
}

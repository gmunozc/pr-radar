import type { AppState } from '../../shared/types'
import { PullRequestIcon } from '../icons'
import { useT } from '../i18n'
import { onListKeyDown } from '../keyboard'
import { useSettings } from '../useSettings'
import { PrItem } from './PrItem'

const MENTIONED_URL = 'https://github.com/pulls/mentioned'

/** Open PRs you take part in (mentioned, assigned, commented) without a review request. */
export function InvolvedList({ state }: { state: AppState }) {
  const t = useT()
  const settings = useSettings()

  if (state.status === 'loading' && state.involved.length === 0) {
    return (
      <main className="list list-empty">
        <div className="spinner" />
      </main>
    )
  }

  if (state.involved.length === 0) {
    return (
      <main className="list list-empty">
        <PullRequestIcon size={32} className="empty-icon-muted" />
        <div className="empty-title">{t('involved.emptyTitle')}</div>
        <div className="empty-sub">{t('involved.emptySub')}</div>
      </main>
    )
  }

  return (
    <>
      <main className="list" onKeyDown={onListKeyDown}>
        {state.involved.map((pr) => (
          <PrItem
            key={pr.id}
            pr={pr}
            snoozeTomorrowAt={state.snoozeTomorrowAt}
            canWrite={state.canWrite}
            pending={state.pendingActions[pr.id]}
            staleDays={settings?.staleAfterDays ?? 0}
          />
        ))}
      </main>
      <footer className="footer">
        <button className="link" onClick={() => void window.prRadar.openExternal(MENTIONED_URL)}>
          {t('involved.viewAll')}
        </button>
      </footer>
    </>
  )
}

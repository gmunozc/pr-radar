import { useRef } from 'react'
import type { AppState } from '../../shared/types'
import { PullRequestIcon } from '../icons'
import { useT } from '../i18n'
import { onListKeyDown } from '../keyboard'
import { useSettings } from '../useSettings'
import { useFocusRow } from '../focusRow'
import { muteProps } from '../muteRepos'
import { PrItem } from './PrItem'
import { RestoreHidden } from './PrList'

const MENTIONED_URL = 'https://github.com/pulls/mentioned'

/** Open PRs you take part in (mentioned, assigned, commented) without a review request. */
interface ListProps {
  state: AppState
  onDetail(prId: string): void
  /** A row to scroll to and focus (a notification click); cleared through `onFocused`. */
  focusPrId?: string | null
  onFocused?(): void
}

export function InvolvedList({ state, onDetail, focusPrId, onFocused }: ListProps) {
  const listRef = useRef<HTMLElement>(null)
  useFocusRow(listRef, focusPrId, onFocused)
  const t = useT()
  const settings = useSettings()
  const saveMuted = (muteRepos: string[]) => void window.prRadar.settings.set({ muteRepos })

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
        {state.dismissedCount + state.snoozedCount > 0 && (
          <div className="empty-hint">
            <RestoreHidden dismissed={state.dismissedCount} snoozed={state.snoozedCount} />
          </div>
        )}
      </main>
    )
  }

  return (
    <>
      <main className="list" ref={listRef} onKeyDown={onListKeyDown}>
        {state.involved.map((pr) => (
          <PrItem
            key={pr.id}
            pr={pr}
            snoozeTomorrowAt={state.snoozeTomorrowAt}
            canWrite={state.canWrite}
            pending={state.pendingActions[pr.id]}
            staleDays={settings?.staleAfterDays ?? 0}
            onDetail={onDetail}
            {...muteProps(settings, pr.repo, saveMuted)}
          />
        ))}
      </main>
      <footer className="footer">
        <button className="link" onClick={() => void window.prRadar.openExternal(MENTIONED_URL)}>
          {t('involved.viewAll')}
        </button>
        {state.dismissedCount + state.snoozedCount > 0 && (
          <RestoreHidden dismissed={state.dismissedCount} snoozed={state.snoozedCount} />
        )}
      </footer>
    </>
  )
}

import { useRef } from 'react'
import type { AppState } from '../../shared/types'
import { PullRequestIcon } from '../icons'
import { useT } from '../i18n'
import { onListKeyDown } from '../keyboard'
import { filterByQuery } from '../arrange'
import { useSettings } from '../useSettings'
import { useFocusRow } from '../focusRow'
import { muteProps } from '../muteRepos'
import { MyPrItem } from './MyPrItem'

const MY_PULLS_URL = 'https://github.com/pulls'

interface ListProps {
  state: AppState
  onDetail(prId: string): void
  /** A row to scroll to and focus (a notification click); cleared through `onFocused`. */
  focusPrId?: string | null
  onFocused?(): void
  /** The ⌘F text filter. */
  query?: string
}

export function MyPrList({ state, onDetail, focusPrId, onFocused, query = '' }: ListProps) {
  const listRef = useRef<HTMLElement>(null)
  useFocusRow(listRef, focusPrId, onFocused)
  const t = useT()
  const settings = useSettings()
  const saveMuted = (muteRepos: string[]) => void window.prRadar.settings.set({ muteRepos })
  const shown = filterByQuery(state.myPrs, query)

  if (state.status === 'loading' && state.myPrs.length === 0) {
    return (
      <main className="list list-empty">
        <div className="spinner" />
      </main>
    )
  }

  if (state.myPrs.length === 0) {
    return (
      <main className="list list-empty">
        <PullRequestIcon size={32} className="empty-icon-muted" />
        <div className="empty-title">{t('mine.emptyTitle')}</div>
        <div className="empty-sub">{t('mine.emptySub')}</div>
      </main>
    )
  }

  return (
    <>
      <main className="list" ref={listRef} onKeyDown={onListKeyDown}>
        {shown.length === 0 && <div className="list-note">{t('search.empty', { query })}</div>}
        {shown.map((pr) => (
          <MyPrItem
            key={pr.id}
            pr={pr}
            canWrite={state.canWrite}
            pending={state.pendingActions[pr.id]}
            armed={state.armedMerges[pr.id]}
            staleDays={settings?.staleAfterDays ?? 0}
            onDetail={onDetail}
            {...muteProps(settings, pr.repo, saveMuted)}
          />
        ))}
      </main>
      <footer className="footer">
        <button className="link" onClick={() => void window.prRadar.openExternal(MY_PULLS_URL)}>
          {t('mine.viewAll')}
        </button>
      </footer>
    </>
  )
}

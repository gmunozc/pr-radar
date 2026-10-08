import { useMemo, useRef } from 'react'
import { MINE_FILTERS, type AppState, type ReviewSort } from '../../shared/types'
import { PullRequestIcon } from '../icons'
import { useT } from '../i18n'
import { onListKeyDown } from '../keyboard'
import { arrangeMyPrs, filterByQuery } from '../arrange'
import { useSettings } from '../useSettings'
import { useFocusRow } from '../focusRow'
import { muteProps } from '../muteRepos'
import { CopyListButton } from './CopyListButton'
import { MyPrItem } from './MyPrItem'
import { Segmented } from './Segmented'

const MY_PULLS_URL = 'https://github.com/pulls'
const SORTS: ReviewSort[] = ['newest', 'oldest', 'updated']

interface ListProps {
  state: AppState
  onDetail(prId: string): void
  /** A row to scroll to and focus (a notification click); cleared through `onFocused`. */
  focusPrId?: string | null
  onFocused?(): void
  /** The ⌘F text filter. */
  query?: string
  /** The organization filter, kept by App so it survives tab switches. */
  org?: string | null
  onOrg?(org: string | null): void
}

export function MyPrList({ state, onDetail, focusPrId, onFocused, query = '', org = null, onOrg }: ListProps) {
  const listRef = useRef<HTMLElement>(null)
  useFocusRow(listRef, focusPrId, onFocused)
  const t = useT()
  const settings = useSettings()
  const saveMuted = (muteRepos: string[]) => void window.prRadar.settings.set({ muteRepos })
  const filter = settings?.mineFilter ?? 'all'
  const sort = settings?.mineSort ?? 'newest'
  const orgs = useMemo(() => [...new Set(state.myPrs.map((pr) => pr.repo.split('/')[0]))].sort(), [state.myPrs])
  const activeOrg = org && orgs.includes(org) ? org : null
  const shown = useMemo(
    () => filterByQuery(arrangeMyPrs(state.myPrs, filter, activeOrg, sort), query),
    [state.myPrs, filter, activeOrg, sort, query]
  )

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
      {state.myPrs.length > 1 && (
        <div className="filters">
          <Segmented
            options={MINE_FILTERS.map((value) => ({ value, label: t(`mineFilter.${value}`) }))}
            value={filter}
            onChange={(mineFilter) => void window.prRadar.settings.set({ mineFilter })}
            label={t('filter.label')}
          />
          {orgs.length > 1 && (
            <select
              className="input select filter-select"
              value={activeOrg ?? ''}
              onChange={(e) => onOrg?.(e.target.value || null)}
              aria-label={t('filter.label')}
            >
              <option value="">{t('filter.allOrgs')}</option>
              {orgs.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          )}
          <select
            className="input select filter-select"
            value={sort}
            onChange={(e) => void window.prRadar.settings.set({ mineSort: e.target.value as ReviewSort })}
            aria-label={t('sort.label')}
          >
            {SORTS.map((value) => (
              <option key={value} value={value}>
                {t(`sort.${value}`)}
              </option>
            ))}
          </select>
        </div>
      )}
      <main className="list" ref={listRef} onKeyDown={onListKeyDown}>
        {shown.length === 0 && <div className="list-note">{query ? t('search.empty', { query }) : t('filter.empty')}</div>}
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
        <CopyListButton prs={shown} />
      </footer>
    </>
  )
}

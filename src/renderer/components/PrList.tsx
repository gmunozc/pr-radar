import { useMemo, useRef } from 'react'
import type { AppState, ReviewFilter, ReviewSort } from '../../shared/types'
import { arrangePrs, filterByQuery } from '../arrange'
import { CheckCircleIcon, PullRequestIcon } from '../icons'
import { useT } from '../i18n'
import { onListKeyDown } from '../keyboard'
import { useSettings } from '../useSettings'
import { useFocusRow } from '../focusRow'
import { muteProps } from '../muteRepos'
import { PrItem } from './PrItem'
import { Segmented } from './Segmented'

const REVIEW_REQUESTED_URL = 'https://github.com/pulls/review-requested'
const FILTERS: ReviewFilter[] = ['all', 'direct', 'team']
const SORTS: ReviewSort[] = ['newest', 'oldest', 'updated']

// Organizations that restrict OAuth Apps silently hide their PRs until access is granted.
export const openOrgAccess = async () => window.prRadar.openExternal(await window.prRadar.auth.accessUrl())

export function RestoreHidden({ dismissed, snoozed }: { dismissed: number; snoozed: number }) {
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

export function PrList({ state, onDetail, focusPrId, onFocused, query = '', org = null, onOrg }: ListProps) {
  const listRef = useRef<HTMLElement>(null)
  useFocusRow(listRef, focusPrId, onFocused)
  const t = useT()
  const settings = useSettings()
  const saveMuted = (muteRepos: string[]) => void window.prRadar.settings.set({ muteRepos })
  const filter = settings?.reviewFilter ?? 'all'
  const sort = settings?.reviewSort ?? 'newest'
  const staleDays = settings?.staleAfterDays ?? 0
  const orgs = useMemo(() => [...new Set(state.prs.map((pr) => pr.repo.split('/')[0]))].sort(), [state.prs])
  // An organization chosen on another tab may not exist here: then it filters nothing.
  const activeOrg = org && orgs.includes(org) ? org : null
  const shown = useMemo(
    () => filterByQuery(arrangePrs(state.prs, filter, activeOrg, sort), query),
    [state.prs, filter, activeOrg, sort, query]
  )

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

  const hasTeams = state.prs.some((pr) => pr.source.kind === 'team')
  const showFilters = state.prs.length > 1 && (hasTeams || orgs.length > 1)

  return (
    <>
      {showFilters && (
        <div className="filters">
          {hasTeams && (
            <Segmented
              options={FILTERS.map((value) => ({ value, label: t(`filter.${value}`) }))}
              value={filter}
              onChange={(reviewFilter) => void window.prRadar.settings.set({ reviewFilter })}
              label={t('filter.label')}
            />
          )}
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
            onChange={(e) => void window.prRadar.settings.set({ reviewSort: e.target.value as ReviewSort })}
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
          <PrItem
            key={pr.id}
            pr={pr}
            snoozeTomorrowAt={state.snoozeTomorrowAt}
            canWrite={state.canWrite}
            pending={state.pendingActions[pr.id]}
            staleDays={staleDays}
            onDetail={onDetail}
            {...muteProps(settings, pr.repo, saveMuted)}
          />
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

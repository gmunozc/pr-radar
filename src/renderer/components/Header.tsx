import { useEffect, useState, type MouseEvent } from 'react'
import { formatClock, formatDateTime, formatDayTime, timeAgo } from '../../shared/format'
import type { Translate } from '../../shared/i18n'
import type { AppState } from '../../shared/types'
import { AlertIcon, ArrowLeftIcon, GearIcon, SyncIcon } from '../icons'
import { useLocale, useT } from '../i18n'
import type { Tab } from './Tabs'

/** `launchers` is a page of Settings ("Send to agent"). */
export type View = 'list' | 'settings' | 'detail' | 'launchers'

interface Props {
  state: AppState
  tab: Tab
  view: View
  /** Last confirmation that the data is current (a probe or a poll), epoch ms. */
  checkedAt: number | null
  /** Title while a PR's detail is open, e.g. "acme/app #12". */
  detailTitle?: string
  refreshing: boolean
  onRefresh(): void
  onBack(): void
  onSettings(): void
}

const keepFocus = (e: MouseEvent) => e.preventDefault()

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

function listTitle(state: AppState, tab: Tab, t: Translate): string {
  if (state.status === 'loading' && !state.lastUpdated) return t('header.searching')
  if (tab === 'review') {
    return state.prs.length === 0 ? t('header.nothingPending') : t('header.pending', { count: state.prs.length })
  }
  if (tab === 'involved') {
    return state.involved.length === 0 ? t('header.noInvolved') : t('header.involved', { count: state.involved.length })
  }
  const ready = state.myPrs.filter((pr) => pr.readyToMerge).length
  if (ready > 0) return t('header.readyToMerge', { count: ready })
  const waiting = state.myPrs.filter((pr) => pr.status === 'waiting').length
  if (waiting > 0) return t('header.waiting', { count: waiting })
  return state.myPrs.length === 0 ? t('header.noOpenPrs') : t('header.openPrs', { count: state.myPrs.length })
}

function errorText(error: NonNullable<AppState['error']>, t: Translate, locale: ReturnType<typeof useLocale>): string {
  switch (error.code) {
    case 'network':
      return t('error.network')
    case 'rate_limited':
      return error.retryAt
        ? t('error.rate_limited', { time: formatClock(error.retryAt, locale) })
        : t('error.rate_limited_soon')
    case 'unauthorized':
      return t('error.unauthorized')
    default:
      return t('error.unknown', { detail: error.detail ?? '' })
  }
}

export function Header({ state, checkedAt, tab, view, detailTitle, refreshing, onRefresh, onBack, onSettings }: Props) {
  const t = useT()
  const locale = useLocale()
  const now = useNow(5_000)

  // Fast mode confirms the data every few seconds without a full poll: show the latest confirmation.
  const freshest = state.lastUpdated ? Math.max(Date.parse(state.lastUpdated), checkedAt ?? 0) : null
  const subtitle =
    freshest !== null ? t('header.updated', { time: timeAgo(new Date(freshest).toISOString(), now, locale) }) : t('header.loading')
  const title =
    view === 'settings'
      ? t('header.settings')
      : view === 'launchers'
        ? t('launchers.title')
        : view === 'detail'
          ? (detailTitle ?? '')
          : listTitle(state, tab, t)

  return (
    <>
      <header className="header">
        {view !== 'list' ? (
          <button className="icon-btn" onMouseDown={keepFocus} onClick={onBack} title={t('header.back')}>
            <ArrowLeftIcon />
          </button>
        ) : state.viewer ? (
          <img className="avatar avatar-lg" src={state.viewer.avatarUrl} alt="" />
        ) : (
          <div className="avatar avatar-lg avatar-placeholder" />
        )}
        <div className="header-text">
          <div className="header-title">{title}</div>
          <div className="header-sub" title={state.lastUpdated ? formatDateTime(state.lastUpdated, locale) : undefined}>
            {state.viewer ? `@${state.viewer.login} · ` : ''}
            {state.quietUntil ? t('header.quietUntil', { when: formatDayTime(state.quietUntil, now, locale) }) : subtitle}
          </div>
        </div>
        {view !== 'settings' && view !== 'launchers' && (
          <button
            className={`icon-btn ${refreshing ? 'spinning' : ''}`}
            onMouseDown={keepFocus}
            onClick={onRefresh}
            title={t('header.refresh')}
            disabled={refreshing}
          >
            <SyncIcon />
          </button>
        )}
        {view === 'list' && (
          <button className="icon-btn" onMouseDown={keepFocus} onClick={onSettings} title={t('header.settings')}>
            <GearIcon />
          </button>
        )}
      </header>
      {state.error && (
        <div className="banner banner-error">
          <AlertIcon size={14} />
          <span>{errorText(state.error, t, locale)}</span>
        </div>
      )}
      {!state.error &&
        state.warnings.map((w) => (
          <div className="banner banner-warn" key={`${w.code}-${w.params?.field ?? ''}`}>
            <AlertIcon size={14} />
            <span>
              {w.code === 'missing_permission'
                ? t('warning.missing_permission', { field: t(w.params?.field === 'merge' ? 'permission.merge' : 'permission.checks') })
                : t(`warning.${w.code}`, w.params)}
            </span>
          </div>
        ))}
    </>
  )
}

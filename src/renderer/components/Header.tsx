import { useEffect, useState, type MouseEvent } from 'react'
import { formatClock, timeAgo } from '../../shared/format'
import type { Translate } from '../../shared/i18n'
import type { AppState } from '../../shared/types'
import { AlertIcon, ArrowLeftIcon, GearIcon, SyncIcon } from '../icons'
import { useLocale, useT } from '../i18n'
import type { Tab } from './Tabs'

interface Props {
  state: AppState
  tab: Tab
  refreshing: boolean
  inSettings: boolean
  onRefresh(): void
  onToggleSettings(): void
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

export function Header({ state, tab, refreshing, inSettings, onRefresh, onToggleSettings }: Props) {
  const t = useT()
  const locale = useLocale()
  const now = useNow(5_000)

  const subtitle = state.lastUpdated
    ? t('header.updated', { time: timeAgo(state.lastUpdated, now, locale) })
    : t('header.loading')

  return (
    <>
      <header className="header">
        {inSettings ? (
          <button className="icon-btn" onMouseDown={keepFocus} onClick={onToggleSettings} title={t('header.back')}>
            <ArrowLeftIcon />
          </button>
        ) : state.viewer ? (
          <img className="avatar avatar-lg" src={state.viewer.avatarUrl} alt="" />
        ) : (
          <div className="avatar avatar-lg avatar-placeholder" />
        )}
        <div className="header-text">
          <div className="header-title">{inSettings ? t('header.settings') : listTitle(state, tab, t)}</div>
          <div className="header-sub">
            {state.viewer ? `@${state.viewer.login} · ` : ''}
            {subtitle}
          </div>
        </div>
        {!inSettings && (
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
        {!inSettings && (
          <button className="icon-btn" onMouseDown={keepFocus} onClick={onToggleSettings} title={t('header.settings')}>
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
          <div className="banner banner-warn" key={w.code}>
            <AlertIcon size={14} />
            <span>{t(`warning.${w.code}`, w.params)}</span>
          </div>
        ))}
    </>
  )
}

import { useEffect, useState, type MouseEvent } from 'react'
import type { AppState } from '../../shared/types'
import type { Tab } from './Tabs'
import { AlertIcon, ArrowLeftIcon, GearIcon, SyncIcon } from '../icons'
import { timeAgo } from '../time'

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

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

function listTitle(state: AppState, tab: Tab): string {
  if (state.status === 'loading' && !state.lastUpdated) return 'Buscando PRs…'
  if (tab === 'review') {
    return state.prs.length === 0 ? 'Nada pendiente' : plural(state.prs.length, 'review pendiente', 'reviews pendientes')
  }
  const waiting = state.myPrs.filter((pr) => pr.status === 'waiting').length
  if (waiting > 0) return `${waiting} esperando review`
  return state.myPrs.length === 0 ? 'Sin PRs abiertos' : plural(state.myPrs.length, 'PR abierto', 'PRs abiertos')
}

export function Header({ state, tab, refreshing, inSettings, onRefresh, onToggleSettings }: Props) {
  const now = useNow(5_000)

  let subtitle = 'Cargando…'
  if (state.lastUpdated) subtitle = `Actualizado ${timeAgo(state.lastUpdated, now)}`

  return (
    <>
      <header className="header">
        {inSettings ? (
          <button className="icon-btn" onMouseDown={keepFocus} onClick={onToggleSettings} title="Volver">
            <ArrowLeftIcon />
          </button>
        ) : state.viewer ? (
          <img className="avatar avatar-lg" src={state.viewer.avatarUrl} alt="" />
        ) : (
          <div className="avatar avatar-lg avatar-placeholder" />
        )}
        <div className="header-text">
          <div className="header-title">
            {inSettings ? 'Ajustes' : listTitle(state, tab)}
          </div>
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
            title="Actualizar ahora"
            disabled={refreshing}
          >
            <SyncIcon />
          </button>
        )}
        {!inSettings && (
          <button className="icon-btn" onMouseDown={keepFocus} onClick={onToggleSettings} title="Ajustes">
            <GearIcon />
          </button>
        )}
      </header>
      {state.error && (
        <div className="banner banner-error">
          <AlertIcon size={14} />
          <span>{state.error.message}</span>
        </div>
      )}
      {!state.error &&
        state.warnings.map((w) => (
          <div className="banner banner-warn" key={w}>
            <AlertIcon size={14} />
            <span>{w}</span>
          </div>
        ))}
    </>
  )
}

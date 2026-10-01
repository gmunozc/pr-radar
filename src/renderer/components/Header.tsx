import { useEffect, useState, type MouseEvent } from 'react'
import type { AppState } from '../../shared/types'
import { AlertIcon, ArrowLeftIcon, GearIcon, SyncIcon } from '../icons'
import { timeAgo } from '../time'

interface Props {
  state: AppState
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

export function Header({ state, refreshing, inSettings, onRefresh, onToggleSettings }: Props) {
  const now = useNow(5_000)
  const count = state.prs.length

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
            {inSettings
              ? 'Ajustes'
              : state.status === 'loading' && !state.lastUpdated
                ? 'Buscando reviews…'
                : count === 0
                  ? 'Nada pendiente'
                  : `${count} ${count === 1 ? 'review pendiente' : 'reviews pendientes'}`}
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

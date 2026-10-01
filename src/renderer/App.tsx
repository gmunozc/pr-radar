import { useEffect, useState } from 'react'
import type { AppState, AuthStatus } from '../shared/types'
import { Header } from './components/Header'
import { LoginView } from './components/LoginView'
import { PrList } from './components/PrList'
import { SettingsView } from './components/SettingsView'

const api = window.prRadar

export function App() {
  const [state, setState] = useState<AppState | null>(null)
  const [auth, setAuth] = useState<AuthStatus>({ phase: 'idle' })
  const [view, setView] = useState<'list' | 'settings'>('list')
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    void api.getState().then(setState)
    const offState = api.onState((s) => {
      setState(s)
      setRefreshing(false)
    })
    const offAuth = api.onAuthStatus(setAuth)
    return () => {
      offState()
      offAuth()
    }
  }, [])

  useEffect(() => {
    if (state?.status === 'logged_out') setView('list')
  }, [state?.status])

  if (!state) return <div className="app" />

  if (state.status === 'logged_out') {
    return (
      <div className="app">
        <LoginView auth={auth} />
      </div>
    )
  }

  const refresh = () => {
    setRefreshing(true)
    void api.refresh()
  }

  return (
    <div className="app">
      <Header
        state={state}
        refreshing={refreshing || state.status === 'loading'}
        inSettings={view === 'settings'}
        onRefresh={refresh}
        onToggleSettings={() => setView(view === 'settings' ? 'list' : 'settings')}
      />
      {view === 'settings' ? <SettingsView /> : <PrList state={state} />}
    </div>
  )
}

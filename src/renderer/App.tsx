import { useEffect, useState } from 'react'
import type { AppState, AuthStatus } from '../shared/types'
import { Header } from './components/Header'
import { InvolvedList } from './components/InvolvedList'
import { LoginView } from './components/LoginView'
import { MyPrList } from './components/MyPrList'
import { PrList } from './components/PrList'
import { SettingsView } from './components/SettingsView'
import { Tabs, type Tab } from './components/Tabs'
import { UpdateBanner } from './components/UpdateBanner'
import { I18nProvider } from './i18n'
import { useSettings } from './useSettings'

const api = window.prRadar

function Panel() {
  const [state, setState] = useState<AppState | null>(null)
  const [auth, setAuth] = useState<AuthStatus>({ phase: 'idle' })
  const [view, setView] = useState<'list' | 'settings'>('list')
  const [tab, setTab] = useState<Tab>('review')
  const [refreshing, setRefreshing] = useState(false)
  const settings = useSettings()
  const showInvolved = settings?.showInvolved ?? true
  const tabs: Tab[] = showInvolved ? ['review', 'mine', 'involved'] : ['review', 'mine']

  // The involved tab can be turned off while it is selected.
  useEffect(() => {
    if (!showInvolved && tab === 'involved') setTab('review')
  }, [showInvolved, tab])

  // Settings → Panel size: "compact" tightens the rows (the window itself is resized by main).
  useEffect(() => {
    document.documentElement.dataset.density = settings?.panelSize === 'compact' ? 'compact' : 'default'
  }, [settings?.panelSize])

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
    if (state?.status === 'logged_out') {
      setView('list')
      setTab('review')
    }
  }, [state?.status])

  const refresh = () => {
    setRefreshing(true)
    void api.refresh()
  }

  // Keyboard: Escape closes (menus and confirmations stop it first), ⌘/Ctrl+R refreshes,
  // ⌘/Ctrl+1/2 switch tabs, ⌘/Ctrl+, opens Settings, arrows enter the list.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const typing = !!target?.closest('input, select, textarea')
      if (e.key === 'Escape') {
        if (typing) return
        if (view === 'settings') setView('list')
        else void api.hidePanel()
        return
      }
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && document.activeElement === document.body) {
        e.preventDefault()
        document.querySelector<HTMLElement>('.pr')?.focus()
        return
      }
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return
      const tabIndex = ['1', '2', '3'].indexOf(e.key)
      if (e.key === 'r') refresh()
      else if (tabIndex !== -1 && tabs[tabIndex]) {
        setView('list')
        setTab(tabs[tabIndex])
      } else if (e.key === ',') setView((v) => (v === 'settings' ? 'list' : 'settings'))
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [view, showInvolved])

  if (!state) return <div className="app" />

  if (state.status === 'logged_out') {
    return (
      <div className="app">
        <LoginView auth={auth} notice={state.authNotice} />
      </div>
    )
  }

  return (
    <div className="app">
      <Header
        state={state}
        tab={tab}
        refreshing={refreshing || state.status === 'loading'}
        inSettings={view === 'settings'}
        onRefresh={refresh}
        onToggleSettings={() => setView(view === 'settings' ? 'list' : 'settings')}
      />
      {view === 'settings' ? (
        <SettingsView state={state} />
      ) : (
        <>
          {state.update && <UpdateBanner update={state.update} />}
          <Tabs
            tab={tab}
            onChange={setTab}
            tabs={tabs}
            counts={{ review: state.prs.length, mine: state.myPrs.length, involved: state.involved.length }}
          />
          {tab === 'review' ? <PrList state={state} /> : tab === 'mine' ? <MyPrList state={state} /> : <InvolvedList state={state} />}
        </>
      )}
    </div>
  )
}

export function App() {
  const [locale, setLocale] = useState<AppState['locale'] | undefined>(undefined)
  useEffect(() => {
    void api.getState().then((s) => setLocale(s.locale))
    return api.onState((s) => setLocale(s.locale))
  }, [])
  return (
    <I18nProvider locale={locale}>
      <Panel />
    </I18nProvider>
  )
}

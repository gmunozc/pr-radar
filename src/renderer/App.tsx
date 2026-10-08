import { tabFor } from './arrange'
import { useCallback, useEffect, useState } from 'react'
import type { AppState, AuthStatus } from '../shared/types'
import { Header, type View } from './components/Header'
import { InvolvedList } from './components/InvolvedList'
import { LoginView } from './components/LoginView'
import { MyPrList } from './components/MyPrList'
import { PrDetail } from './components/PrDetail'
import { PrList } from './components/PrList'
import { SearchRow } from './components/SearchRow'
import { SettingsView } from './components/SettingsView'
import { Tabs, type Tab } from './components/Tabs'
import { UpdateBanner } from './components/UpdateBanner'
import { I18nProvider } from './i18n'
import { useSettings } from './useSettings'

const api = window.prRadar

function Panel() {
  const [state, setState] = useState<AppState | null>(null)
  const [auth, setAuth] = useState<AuthStatus>({ phase: 'idle' })
  const [view, setView] = useState<View>('list')
  const [detailId, setDetailId] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('review')
  const openDetail = useCallback((prId: string) => {
    setDetailId(prId)
    setView('detail')
  }, [])
  const closeDetail = useCallback(() => {
    setView('list')
    setDetailId(null)
  }, [])
  const [refreshing, setRefreshing] = useState(false)
  /** Last time a poll or a probe confirmed the data is current (fast mode). */
  const [checkedAt, setCheckedAt] = useState<number | null>(null)
  /** A notification asked to show a PR: first find its tab, then let the list focus the row. */
  const [pendingFocus, setPendingFocus] = useState<string | null>(null)
  const [focusPrId, setFocusPrId] = useState<string | null>(null)
  const focused = useCallback(() => setFocusPrId(null), [])
  /** The ⌘F text filter, shared by the three tabs. */
  const [query, setQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchFocus, setSearchFocus] = useState(0)
  const closeSearch = useCallback(() => {
    setQuery('')
    setSearchOpen(false)
  }, [])
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
    const offChecked = api.onChecked(setCheckedAt)
    const offFocus = api.onFocusPr(setPendingFocus)
    return () => {
      offState()
      offAuth()
      offChecked()
      offFocus()
    }
  }, [])

  useEffect(() => {
    if (!pendingFocus || !state) return
    const target = tabFor(state, pendingFocus)
    if (target) {
      setView('list')
      setTab(target)
      setFocusPrId(pendingFocus)
    }
    setPendingFocus(null)
  }, [pendingFocus, state])

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
        else if (view === 'detail') closeDetail()
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
      else if (e.key === 'f' && view === 'list') {
        setSearchOpen(true)
        setSearchFocus((n) => n + 1)
      } else if (tabIndex !== -1 && tabs[tabIndex]) {
        setView('list')
        setTab(tabs[tabIndex])
      } else if (e.key === ',') setView((v) => (v === 'settings' ? 'list' : 'settings'))
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [view, showInvolved, closeDetail])

  if (!state) return <div className="app" />

  if (state.status === 'logged_out') {
    return (
      <div className="app">
        <LoginView auth={auth} notice={state.authNotice} />
      </div>
    )
  }

  const detailPr = detailId ? [...state.prs, ...state.myPrs, ...state.involved].find((p) => p.id === detailId) : undefined

  return (
    <div className="app">
      <Header
        state={state}
        checkedAt={checkedAt}
        tab={tab}
        view={view}
        detailTitle={detailPr ? `${detailPr.repo} #${detailPr.number}` : undefined}
        refreshing={refreshing || state.status === 'loading'}
        onRefresh={refresh}
        onBack={view === 'detail' ? closeDetail : () => setView('list')}
        onSettings={() => setView('settings')}
      />
      {view === 'settings' ? (
        <SettingsView state={state} />
      ) : view === 'detail' && detailId ? (
        <PrDetail state={state} prId={detailId} onGone={closeDetail} />
      ) : (
        <>
          {state.update && <UpdateBanner update={state.update} />}
          <Tabs
            tab={tab}
            onChange={setTab}
            tabs={tabs}
            counts={{ review: state.prs.length, mine: state.myPrs.length, involved: state.involved.length }}
          />
          {(searchOpen || query) && <SearchRow value={query} onChange={setQuery} onClose={closeSearch} focusToken={searchFocus} />}
          {tab === 'review' ? (
            <PrList state={state} onDetail={openDetail} focusPrId={focusPrId} onFocused={focused} query={query} />
          ) : tab === 'mine' ? (
            <MyPrList state={state} onDetail={openDetail} focusPrId={focusPrId} onFocused={focused} query={query} />
          ) : (
            <InvolvedList state={state} onDetail={openDetail} focusPrId={focusPrId} onFocused={focused} query={query} />
          )}
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

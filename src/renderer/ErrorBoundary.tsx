import { Component, type ErrorInfo, type ReactNode } from 'react'
import { resolveLocale, translator } from '../shared/i18n'

interface State {
  failed: boolean
}

/** Shows a way out instead of a blank panel if rendering throws, and logs the error. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    window.prRadar.reportError(`${error.stack ?? error.message}\n${info.componentStack ?? ''}`)
  }

  render() {
    if (!this.state.failed) return this.props.children
    // No i18n context here (it may be what failed): reuse the language the panel last used.
    const lang = document.documentElement.lang
    const t = translator(lang === 'en' || lang === 'es' ? lang : resolveLocale('system', navigator.languages))
    return (
      <div className="app">
        <main className="list list-empty">
          <div className="empty-title">{t('crash.title')}</div>
          <button className="btn btn-primary" onClick={() => window.location.reload()}>
            {t('crash.reload')}
          </button>
        </main>
      </div>
    )
  }
}

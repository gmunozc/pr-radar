import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { ErrorBoundary } from './ErrorBoundary'
import './styles.css'

document.documentElement.dataset.platform = window.prRadar.platform

// The panel hides on blur; drop focus so no focus ring is left behind when it reopens.
window.addEventListener('blur', () => (document.activeElement as HTMLElement | null)?.blur())

window.addEventListener('error', (e) => window.prRadar.reportError(`${e.message} @ ${e.filename}:${e.lineno}`))
window.addEventListener('unhandledrejection', (e) => window.prRadar.reportError(`Unhandled rejection: ${String(e.reason)}`))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
)

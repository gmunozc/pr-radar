import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles.css'

document.documentElement.dataset.platform = window.prRadar.platform

// The panel hides on blur; drop focus so no focus ring is left behind when it reopens.
window.addEventListener('blur', () => (document.activeElement as HTMLElement | null)?.blur())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)

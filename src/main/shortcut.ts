/** The global keyboard shortcut that opens the panel from any app. */
import { globalShortcut } from 'electron'
import { logger } from './log'

/** Registers `accelerator` (or none when empty); false when another app owns it or it is invalid. */
export function applyShortcut(accelerator: string, toggle: () => void): boolean {
  globalShortcut.unregisterAll()
  if (!accelerator) return true
  try {
    const ok = globalShortcut.register(accelerator, toggle)
    if (!ok) logger.warn('shortcut not available', { accelerator })
    return ok
  } catch (err) {
    logger.warn('shortcut rejected', { accelerator, error: String(err) })
    return false
  }
}

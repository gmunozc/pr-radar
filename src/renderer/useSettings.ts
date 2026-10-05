import { useEffect, useState } from 'react'
import type { Settings } from '../shared/types'

export type SettingsView = Settings & { openAtLogin: boolean }

/** The current settings, kept in sync with changes made anywhere in the app. */
export function useSettings(): SettingsView | null {
  const [settings, setSettings] = useState<SettingsView | null>(null)
  useEffect(() => {
    void window.prRadar.settings.get().then(setSettings)
    return window.prRadar.onSettings(setSettings)
  }, [])
  return settings
}

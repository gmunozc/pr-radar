/** The main process's current UI language (tray menu, notifications). */
import { resolveLocale, translator, type LanguagePref, type Locale, type Translate } from '../shared/i18n'

let locale: Locale = 'en'
let translate: Translate = translator(locale)

/** Re-resolves the language; returns true when it changed. */
export function applyLanguage(pref: LanguagePref, systemLanguages: readonly string[]): boolean {
  const next = resolveLocale(pref, systemLanguages)
  if (next === locale) return false
  locale = next
  translate = translator(next)
  return true
}

export const currentLocale = (): Locale => locale
export const t: Translate = (key, params) => translate(key, params)

import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react'
import { resolveLocale, translator, type Locale, type Translate } from '../shared/i18n'

interface I18n {
  t: Translate
  locale: Locale
}

/** Before the first state arrives from the main process, follow the browser languages. */
const initialLocale = resolveLocale('system', navigator.languages)

const I18nContext = createContext<I18n>({ t: translator(initialLocale), locale: initialLocale })

export function I18nProvider({ locale, children }: { locale: Locale | undefined; children: ReactNode }) {
  const resolved = locale ?? initialLocale
  const value = useMemo(() => ({ t: translator(resolved), locale: resolved }), [resolved])
  useEffect(() => {
    document.documentElement.lang = resolved
  }, [resolved])
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export const useT = (): Translate => useContext(I18nContext).t
export const useLocale = (): Locale => useContext(I18nContext).locale

/** Renders `**bold**` and `` `code` `` inside translated strings. */
export function Rich({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**')) return <b key={i}>{part.slice(2, -2)}</b>
        if (part.startsWith('`') && part.endsWith('`')) return <code key={i}>{part.slice(1, -1)}</code>
        return part
      })}
    </>
  )
}

/** Tiny dependency-free i18n shared by the main process and the panel. */
import { en, type MessageKey } from './en'
import { es } from './es'

export type Locale = 'en' | 'es'
export type LanguagePref = 'system' | Locale
export const LOCALES: readonly Locale[] = ['en', 'es']

type PluralBase<K> = K extends `${infer Base}.other` ? Base : never
/** A message key, or the base of a plural key (`header.pending` for `header.pending.one|other`). */
export type TKey = MessageKey | PluralBase<MessageKey>
export type Params = Record<string, string | number>
export type Translate = (key: TKey, params?: Params) => string

const dictionaries: Record<Locale, Record<MessageKey, string>> = { en, es }

/** Picks the UI language: the explicit preference, else the first supported system language. */
export function resolveLocale(pref: LanguagePref, preferred: readonly string[]): Locale {
  if (pref !== 'system') return pref
  for (const tag of preferred) {
    const lang = tag.toLowerCase().split(/[-_]/)[0]
    if ((LOCALES as readonly string[]).includes(lang)) return lang as Locale
  }
  return 'en'
}

export function translator(locale: Locale): Translate {
  const dict = dictionaries[locale]
  const plural = new Intl.PluralRules(locale)
  return (key, params) => {
    let template: string | undefined = (dict as Record<string, string>)[key]
    if (template === undefined) {
      const count = Number(params?.count ?? 0)
      template =
        (dict as Record<string, string>)[`${key}.${plural.select(count)}`] ?? (dict as Record<string, string>)[`${key}.other`]
    }
    if (template === undefined) return key
    return template.replace(/\{(\w+)\}/g, (match, name: string) =>
      params && params[name] !== undefined ? String(params[name]) : match
    )
  }
}

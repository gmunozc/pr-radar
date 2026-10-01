import type { Locale } from './i18n'

const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
  ['second', 1]
]

const NOW_LABEL: Record<Locale, string> = { en: 'just now', es: 'ahora' }

/** "2 hours ago" / "hace 2 horas". */
export function timeAgo(iso: string, now: number, locale: Locale): string {
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000)
  if (Math.abs(seconds) < 10) return NOW_LABEL[locale]
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'always', style: 'long' })
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size || unit === 'second') return rtf.format(Math.round(seconds / size), unit)
  }
  return ''
}

/** Local wall-clock time, e.g. "18:42" or "6:42 PM". */
export function formatClock(ms: number, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(ms)
}

export function formatDateTime(iso: string, locale: Locale): string {
  return new Date(iso).toLocaleString(locale)
}

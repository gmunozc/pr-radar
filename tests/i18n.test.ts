import { describe, expect, it } from 'vitest'
import { en } from '../src/shared/i18n/en'
import { es } from '../src/shared/i18n/es'
import { resolveLocale, translator } from '../src/shared/i18n'
import { formatClock, timeAgo } from '../src/shared/format'

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()

describe('dictionaries', () => {
  it('have the same keys', () => {
    expect(Object.keys(es).sort()).toEqual(Object.keys(en).sort())
  })

  it('use the same placeholders and markup for every key', () => {
    for (const key of Object.keys(en) as Array<keyof typeof en>) {
      expect(placeholders(es[key]), key).toEqual(placeholders(en[key]))
      expect((es[key].match(/\*\*/g) ?? []).length, key).toBe((en[key].match(/\*\*/g) ?? []).length)
    }
  })

  it('have no empty strings', () => {
    for (const [key, value] of [...Object.entries(en), ...Object.entries(es)]) expect(value.trim(), key).not.toBe('')
  })
})

describe('resolveLocale', () => {
  it('follows the first supported system language', () => {
    expect(resolveLocale('system', ['es-419'])).toBe('es')
    expect(resolveLocale('system', ['en-GB', 'es-CL'])).toBe('en')
    expect(resolveLocale('system', ['fr-FR', 'es-ES'])).toBe('es')
    expect(resolveLocale('system', ['pt_BR'])).toBe('en')
    expect(resolveLocale('system', [])).toBe('en')
  })

  it('honours an explicit choice', () => {
    expect(resolveLocale('es', ['en-US'])).toBe('es')
    expect(resolveLocale('en', ['es-CL'])).toBe('en')
  })
})

describe('translator', () => {
  it('interpolates parameters', () => {
    expect(translator('en')('header.updated', { time: '2 minutes ago' })).toBe('Updated 2 minutes ago')
    expect(translator('es')('pr.teamNamed', { slug: 'core' })).toBe('Equipo · core')
  })

  it('picks plural forms from count', () => {
    const en = translator('en')
    const es = translator('es')
    expect(en('header.pending', { count: 1 })).toBe('1 review pending')
    expect(en('header.pending', { count: 3 })).toBe('3 reviews pending')
    expect(es('header.pending', { count: 1 })).toBe('1 review pendiente')
    expect(es('header.pending', { count: 0 })).toBe('0 reviews pendientes')
    // Spanish ICU data has a "many" category for large round numbers: falls back to .other.
    expect(es('list.dismissed', { count: 1_000_000 })).toBe('1000000 descartados')
  })

  it('leaves unknown parameters visible', () => {
    expect(translator('en')('header.updated')).toBe('Updated {time}')
  })
})

describe('format', () => {
  it('formats relative times in both languages', () => {
    const now = Date.UTC(2026, 9, 1, 12, 0, 0)
    expect(timeAgo('2026-10-01T10:00:00Z', now, 'en')).toBe('2 hours ago')
    expect(timeAgo('2026-10-01T10:00:00Z', now, 'es')).toBe('hace 2 horas')
    expect(timeAgo('2026-10-01T11:59:55Z', now, 'es')).toBe('ahora')
  })

  it('formats clock times', () => {
    expect(formatClock(Date.UTC(2026, 9, 1, 18, 42), 'es')).toMatch(/\d{1,2}:42/)
  })
})

import { describe, expect, it } from 'vitest'
import { arrangePrs, filterByQuery, matchesQuery, tabFor } from '../src/renderer/arrange'
import { pr } from './fixtures'

const a = pr('a', { createdAt: '2026-01-03T00:00:00Z', updatedAt: '2026-01-03T00:00:00Z', repo: 'acme/app' })
const b = pr('b', { createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-05T00:00:00Z', repo: 'acme/web', source: { kind: 'team', slug: 'fe' } })
const c = pr('c', { createdAt: '2026-01-02T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z', repo: 'globex/api' })

describe('arrangePrs', () => {
  it('sorts newest, oldest or recently updated', () => {
    expect(arrangePrs([a, b, c], 'all', null, 'newest').map((p) => p.id)).toEqual(['a', 'c', 'b'])
    expect(arrangePrs([a, b, c], 'all', null, 'oldest').map((p) => p.id)).toEqual(['b', 'c', 'a'])
    expect(arrangePrs([a, b, c], 'all', null, 'updated').map((p) => p.id)).toEqual(['b', 'a', 'c'])
  })

  it('filters by how the review was requested and by organization', () => {
    expect(arrangePrs([a, b, c], 'direct', null, 'newest').map((p) => p.id)).toEqual(['a', 'c'])
    expect(arrangePrs([a, b, c], 'team', null, 'newest').map((p) => p.id)).toEqual(['b'])
    expect(arrangePrs([a, b, c], 'all', 'acme', 'oldest').map((p) => p.id)).toEqual(['b', 'a'])
    expect(arrangePrs([a, b, c], 'team', 'globex', 'newest')).toEqual([])
  })

  it('does not mutate the input', () => {
    const input = [a, b, c]
    arrangePrs(input, 'all', null, 'oldest')
    expect(input.map((p) => p.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('tabFor', () => {
  it('names the tab that lists a PR', () => {
    const state = { prs: [{ id: 'a' }], myPrs: [{ id: 'm' }], involved: [{ id: 'i' }] }
    expect(tabFor(state, 'a')).toBe('review')
    expect(tabFor(state, 'm')).toBe('mine')
    expect(tabFor(state, 'i')).toBe('involved')
    expect(tabFor(state, 'gone')).toBeNull()
  })
})

describe('matchesQuery', () => {
  const sample = { title: 'Añadir filtros al CRM', repo: 'acme/web', number: 482, author: { login: 'José' }, branch: 'feat/filters' }

  it('finds PRs by title, repository, number, author or branch, ignoring case and accents', () => {
    expect(matchesQuery(sample, 'anadir')).toBe(true)
    expect(matchesQuery(sample, 'ACME/WEB')).toBe(true)
    expect(matchesQuery(sample, '#482')).toBe(true)
    expect(matchesQuery(sample, '482')).toBe(true)
    expect(matchesQuery(sample, 'jose')).toBe(true)
    expect(matchesQuery(sample, 'feat/filters')).toBe(true)
    expect(matchesQuery(sample, 'crm web')).toBe(true)
    expect(matchesQuery(sample, 'billing')).toBe(false)
    expect(matchesQuery({ ...sample, author: null }, 'jose')).toBe(false)
  })

  it('leaves the list alone without a query', () => {
    const prs = [sample, { ...sample, number: 7, title: 'Other' }]
    expect(filterByQuery(prs, '  ')).toBe(prs)
    expect(filterByQuery(prs, 'other')).toEqual([prs[1]])
  })
})

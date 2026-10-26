import { describe, expect, it } from 'vitest'
import { arrangeMyPrs, arrangePrs, filterByQuery, filterByRepos, linksText, matchesQuery, reposOf, tabFor } from '../src/renderer/arrange'
import { myPr, pr } from './fixtures'

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

  it('keeps only the chosen repositories, all of them when none is chosen', () => {
    expect(arrangePrs([a, b, c], 'all', null, 'newest', ['acme/web', 'globex/api']).map((p) => p.id)).toEqual(['c', 'b'])
    expect(arrangePrs([a, b, c], 'all', null, 'newest', []).map((p) => p.id)).toEqual(['a', 'c', 'b'])
    expect(arrangePrs([a, b, c], 'team', 'acme', 'newest', ['acme/app'])).toEqual([])
  })
})

describe('footer helpers', () => {
  it('lists the repositories of a list with their counts, by name', () => {
    expect(reposOf([a, b, c, pr('d', { repo: 'acme/web' })])).toEqual([
      { repo: 'acme/app', count: 1 },
      { repo: 'acme/web', count: 2 },
      { repo: 'globex/api', count: 1 }
    ])
    expect(reposOf([])).toEqual([])
  })

  it('keeps the chosen repositories of your PRs and of any list', () => {
    const mine = [myPr('m1', { repo: 'acme/app' }), myPr('m2', { repo: 'acme/web' })]
    expect(arrangeMyPrs(mine, 'all', null, 'newest', ['acme/web']).map((p) => p.id)).toEqual(['m2'])
    expect(arrangeMyPrs(mine, 'all', null, 'newest').map((p) => p.id).sort()).toEqual(['m1', 'm2'])
    expect(filterByRepos([a, b, c], ['globex/api']).map((p) => p.id)).toEqual(['c'])
    expect(filterByRepos([a, b, c], []).map((p) => p.id)).toEqual(['a', 'b', 'c'])
  })

  it('copies the links shown, one per line', () => {
    expect(linksText([a, c])).toBe(`${a.url}\n${c.url}`)
    expect(linksText([])).toBe('')
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

describe('arrangeMyPrs', () => {
  const ready = myPr('r', { readyToMerge: true, status: 'approved', repo: 'acme/app', createdAt: '2026-01-03T00:00:00Z', updatedAt: '2026-01-03T00:00:00Z' })
  const waiting = myPr('w', { status: 'waiting', repo: 'globex/api', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-05T00:00:00Z' })
  const changes = myPr('c', { status: 'changes_requested', repo: 'acme/web', createdAt: '2026-01-02T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z' })
  const blocked = myPr('b', { status: 'approved', blocker: 'behind', createdAt: '2026-01-04T00:00:00Z', updatedAt: '2026-01-04T00:00:00Z' })
  const all = [ready, waiting, changes, blocked]

  it('filters by readiness and review status, by organization, and sorts like the review list', () => {
    expect(arrangeMyPrs(all, 'all', null, 'newest').map((p) => p.id)).toEqual(['b', 'r', 'c', 'w'])
    expect(arrangeMyPrs(all, 'ready', null, 'newest').map((p) => p.id)).toEqual(['r'])
    expect(arrangeMyPrs(all, 'waiting', null, 'newest').map((p) => p.id)).toEqual(['w'])
    expect(arrangeMyPrs(all, 'changes', null, 'newest').map((p) => p.id)).toEqual(['c'])
    expect(arrangeMyPrs(all, 'all', 'acme', 'oldest').map((p) => p.id)).toEqual(['c', 'r', 'b'])
    expect(arrangeMyPrs(all, 'all', null, 'updated').map((p) => p.id)).toEqual(['w', 'b', 'r', 'c'])
  })
})

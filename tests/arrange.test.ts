import { describe, expect, it } from 'vitest'
import { arrangePrs } from '../src/renderer/arrange'
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

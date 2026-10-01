import { describe, expect, it } from 'vitest'
import { diffPrs, planNotifications } from '../src/main/diff'
import type { PullRequest } from '../src/shared/types'

const pr = (id: string): PullRequest => ({
  id,
  number: Number(id.replace(/\D/g, '')) || 1,
  title: `PR ${id}`,
  url: `https://github.com/acme/app/pull/${id}`,
  repo: 'acme/app',
  author: { login: 'octo', avatarUrl: '' },
  isDraft: false,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  additions: 1,
  deletions: 1,
  source: { kind: 'direct' }
})

describe('diffPrs', () => {
  it('treats a missing snapshot as first run without individual new PRs', () => {
    const d = diffPrs(null, [pr('a'), pr('b')])
    expect(d.firstRun).toBe(true)
    expect(d.newPrs).toEqual([])
    expect(d.seenIds).toEqual(['a', 'b'])
    expect(planNotifications(d, 2)).toEqual({ kind: 'summary', count: 2 })
  })

  it('does not notify on first run when nothing is pending', () => {
    expect(planNotifications(diffPrs(null, []), 0)).toEqual({ kind: 'none' })
  })

  it('detects newly requested PRs', () => {
    const d = diffPrs(['a'], [pr('a'), pr('b')])
    expect(d.newPrs.map((p) => p.id)).toEqual(['b'])
    expect(planNotifications(d, 2)).toMatchObject({ kind: 'individual' })
  })

  it('does nothing when the list is unchanged', () => {
    const d = diffPrs(['a', 'b'], [pr('a'), pr('b')])
    expect(d.newPrs).toEqual([])
    expect(planNotifications(d, 2)).toEqual({ kind: 'none' })
  })

  it('drops PRs that left the list so a re-request notifies again', () => {
    const afterReview = diffPrs(['a', 'b'], [pr('a')])
    expect(afterReview.seenIds).toEqual(['a'])
    const reRequested = diffPrs(afterReview.seenIds, [pr('a'), pr('b')])
    expect(reRequested.newPrs.map((p) => p.id)).toEqual(['b'])
  })

  it('groups notifications when many PRs arrive at once', () => {
    const d = diffPrs([], [pr('a'), pr('b'), pr('c'), pr('d')])
    expect(planNotifications(d, 4)).toMatchObject({ kind: 'grouped' })
    const three = diffPrs([], [pr('a'), pr('b'), pr('c')])
    expect(planNotifications(three, 3)).toMatchObject({ kind: 'individual' })
  })
})

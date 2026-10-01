import { describe, expect, it } from 'vitest'
import { applyDismissals, diffMyPrs, diffPrs, planNotifications } from '../src/main/diff'
import type { MyPullRequest, PullRequest } from '../src/shared/types'

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
  headOid: 'h',
  ci: 'none',
  source: { kind: 'direct' },
  lastReviewAt: null,
  newCommitsSinceReview: false
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

describe('applyDismissals', () => {
  it('hides dismissed PRs and keeps their ids', () => {
    const r = applyDismissals([pr('a'), pr('b'), pr('c')], ['b'])
    expect(r.visible.map((p) => p.id)).toEqual(['a', 'c'])
    expect(r.dismissedIds).toEqual(['b'])
  })

  it('forgets dismissals of PRs that left the list so a re-request shows again', () => {
    const afterReview = applyDismissals([pr('a')], ['b'])
    expect(afterReview.dismissedIds).toEqual([])
    const reRequested = applyDismissals([pr('a'), pr('b')], afterReview.dismissedIds)
    expect(reRequested.visible.map((p) => p.id)).toEqual(['a', 'b'])
  })
})

const mine = (id: string, over: Partial<MyPullRequest> = {}): MyPullRequest => ({
  ...pr(id),
  author: { login: 'me', avatarUrl: '' },
  status: 'waiting',
  pendingReviewers: [],
  reviews: [],
  readyToMerge: false,
  blocker: null,
  conflicts: false,
  ...over
})

describe('diffMyPrs', () => {
  it('stays silent without a previous snapshot and for PRs that just appeared', () => {
    const first = diffMyPrs(undefined, [mine('a', { status: 'approved' })])
    expect(first.events).toEqual([])
    const later = diffMyPrs(first.snapshot, [mine('a', { status: 'approved' }), mine('b', { status: 'changes_requested' })])
    expect(later.events).toEqual([])
  })

  it('notifies when changes are requested or the PR is approved, naming the reviewers', () => {
    const base = diffMyPrs(undefined, [mine('a'), mine('b')]).snapshot
    const reviews = [{ login: 'ana', avatarUrl: '', state: 'CHANGES_REQUESTED' as const }]
    const { events } = diffMyPrs(base, [
      mine('a', { status: 'changes_requested', reviews }),
      mine('b', { status: 'approved', reviews: [{ login: 'bob', avatarUrl: '', state: 'APPROVED' }] })
    ])
    expect(events.map((e) => [e.kind, 'by' in e ? e.by : []])).toEqual([
      ['my_pr_changes_requested', ['ana']],
      ['my_pr_approved', ['bob']]
    ])
  })

  it('announces "ready to merge" once per head commit, instead of "approved"', () => {
    let snap = diffMyPrs(undefined, [mine('a')]).snapshot
    let r = diffMyPrs(snap, [mine('a', { status: 'approved', readyToMerge: true, headOid: 'h1' })])
    expect(r.events.map((e) => e.kind)).toEqual(['my_pr_ready'])
    snap = r.snapshot
    r = diffMyPrs(snap, [mine('a', { status: 'approved', readyToMerge: true, headOid: 'h1' })])
    expect(r.events).toEqual([])
    r = diffMyPrs(r.snapshot, [mine('a', { status: 'approved', readyToMerge: true, headOid: 'h2' })])
    expect(r.events.map((e) => e.kind)).toEqual(['my_pr_ready'])
  })

  it('does not announce PRs that were already ready when first seen', () => {
    const snap = diffMyPrs({}, [mine('a', { status: 'approved', readyToMerge: true, headOid: 'h1' })]).snapshot
    expect(snap.a.readyNotifiedOid).toBe('h1')
    expect(diffMyPrs(snap, [mine('a', { status: 'approved', readyToMerge: true, headOid: 'h1' })]).events).toEqual([])
  })
})

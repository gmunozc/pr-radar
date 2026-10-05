import { describe, expect, it } from 'vitest'
import { applyDismissals, applyHidden, diffMyPrs, diffPrs, planNotifications } from '../src/main/diff'
import { myPr as mine, pr } from './fixtures'

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

describe('applyHidden', () => {
  it('hides snoozed PRs until their time, then brings them back', () => {
    const hidden = { dismissedIds: ['c'], snoozed: { a: 100, b: 500 } }
    const early = applyHidden([pr('a'), pr('b'), pr('c'), pr('d')], hidden, 50)
    expect(early.visible.map((p) => p.id)).toEqual(['d'])
    expect(early.returned).toEqual([])
    const later = applyHidden([pr('a'), pr('b'), pr('c'), pr('d')], hidden, 100)
    expect(later.visible.map((p) => p.id)).toEqual(['a', 'd'])
    expect(later.returned.map((p) => p.id)).toEqual(['a'])
    expect(later.snoozed).toEqual({ b: 500 })
    expect(later.dismissedIds).toEqual(['c'])
  })

  it('forgets snoozes of PRs that left the list', () => {
    expect(applyHidden([pr('a')], { dismissedIds: [], snoozed: { gone: 999 } }, 0).snoozed).toEqual({})
  })

  it('hides a PR snoozed until new commits while the head is unchanged, then brings it back', () => {
    const hidden = { dismissedIds: [], snoozed: {}, snoozedUntilPush: { a: 'h' } }
    const same = applyHidden([pr('a'), pr('b')], hidden, 0)
    expect(same.visible.map((p) => p.id)).toEqual(['b'])
    expect(same.snoozedUntilPush).toEqual({ a: 'h' })
    expect(same.returned).toEqual([])

    const pushed = applyHidden([pr('a', { headOid: 'h2' }), pr('b')], hidden, 0)
    expect(pushed.visible.map((p) => p.id)).toEqual(['a', 'b'])
    expect(pushed.returned.map((p) => p.id)).toEqual(['a'])
    expect(pushed.snoozedUntilPush).toEqual({})
  })

  it('forgets push snoozes of PRs that left, and lets a dismissal win', () => {
    expect(applyHidden([pr('a')], { dismissedIds: [], snoozed: {}, snoozedUntilPush: { gone: 'x' } }, 0).snoozedUntilPush).toEqual({})
    const dismissed = applyHidden([pr('a')], { dismissedIds: ['a'], snoozed: {}, snoozedUntilPush: { a: 'h' } }, 0)
    expect(dismissed.visible).toEqual([])
    expect(dismissed.snoozedUntilPush).toEqual({})
    expect(dismissed.returned).toEqual([])
  })
})

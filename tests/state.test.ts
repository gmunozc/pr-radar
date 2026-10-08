import { describe, expect, it } from 'vitest'
import { migrateState } from '../src/main/state'

describe('migrateState', () => {
  it('upgrades the v1 state.json written by 0.1/0.2', () => {
    expect(migrateState({ login: 'octo', seenIds: ['a', 'b'] })).toEqual({
      v: 2,
      login: 'octo',
      seenIds: ['a', 'b'],
      dismissedIds: [],
      snoozed: {},
      snoozedUntilPush: {},
      mergeWhenReady: {},
      queued: {
        reviews: [],
        reminders: [],
        approved: [],
        changes: [],
        ready: [],
        ciFailed: [],
        conflicts: [],
        commented: [],
        merged: [],
        mergeFailed: [],
        closed: [],
        sessionExpired: false
      },
      lastDigestDay: null
    })
    expect(migrateState({ login: 'octo', seenIds: ['a'], dismissedIds: ['a'] })?.dismissedIds).toEqual(['a'])
  })

  it('keeps v2 as is and drops non-string ids', () => {
    expect(migrateState({ v: 2, login: 'octo', seenIds: ['a', 3], dismissedIds: [null, 'b'] })).toMatchObject({
      v: 2,
      login: 'octo',
      seenIds: ['a'],
      dismissedIds: ['b']
    })
  })

  it('treats garbage as no state', () => {
    expect(migrateState(null)).toBeNull()
    expect(migrateState('x')).toBeNull()
    expect(migrateState({ seenIds: [] })).toBeNull()
    expect(migrateState({ login: 'octo' })).toBeNull()
  })
})

describe('migrateState and your PRs snapshot', () => {
  it('keeps a valid snapshot and drops broken entries', () => {
    const state = migrateState({
      v: 2,
      login: 'me',
      seenIds: [],
      dismissedIds: [],
      myPrs: { a: { status: 'approved', readyNotifiedOid: 'h1' }, b: { nope: true }, c: null }
    })
    expect(state?.myPrs).toEqual({ a: { status: 'approved', readyNotifiedOid: 'h1' } })
  })

  it('keeps what it knows about checks and conflicts, dropping invalid values', () => {
    const state = migrateState({
      v: 2,
      login: 'me',
      seenIds: [],
      myPrs: {
        a: { status: 'waiting', ci: 'failure', ciFailedOid: 'h1', conflicts: true, commented: ['ana', 3] },
        b: { status: 'waiting', ci: 'nope', ciFailedOid: 3, conflicts: 'yes', commented: 'ana' }
      },
      queued: { ciFailed: ['a', 1], conflicts: ['b'], commented: ['c'] }
    })
    expect(state?.myPrs).toEqual({
      a: { status: 'waiting', ci: 'failure', ciFailedOid: 'h1', conflicts: true, commented: ['ana'] },
      b: { status: 'waiting' }
    })
    expect(state?.queued).toMatchObject({ ciFailed: ['a'], conflicts: ['b'], commented: ['c'] })
  })

  it('leaves the snapshot undefined for older state files', () => {
    expect(migrateState({ login: 'me', seenIds: [] })?.myPrs).toBeUndefined()
  })
})

describe('migrateState and snoozes until new commits', () => {
  it('keeps head commits per PR and drops anything else', () => {
    const state = migrateState({ login: 'me', seenIds: [], snoozedUntilPush: { a: 'abc', b: 7, c: '' } })
    expect(state?.snoozedUntilPush).toEqual({ a: 'abc' })
    expect(migrateState({ login: 'me', seenIds: [], snoozedUntilPush: ['x'] })?.snoozedUntilPush).toEqual({})
  })
})

describe('migrateState and armed merges', () => {
  it('keeps well-formed entries and drops the rest', () => {
    const state = migrateState({
      login: 'me',
      seenIds: [],
      mergeWhenReady: {
        a: { headOid: 'h1', method: 'SQUASH', armedAt: 5, sawChecks: true },
        b: { headOid: 'h2', method: 'FAST' },
        c: { method: 'MERGE' },
        d: { headOid: 'h4', method: 'REBASE' }
      },
      queued: { merged: ['a', 1], mergeFailed: ['b'] }
    })
    expect(state?.mergeWhenReady).toEqual({
      a: { headOid: 'h1', method: 'SQUASH', armedAt: 5, sawChecks: true },
      d: { headOid: 'h4', method: 'REBASE', armedAt: 0, sawChecks: false }
    })
    expect(state?.queued).toMatchObject({ merged: ['a'], mergeFailed: ['b'] })
  })
})

describe('migrateState and phase 4 fields', () => {
  it('keeps snoozes, queued alerts and the digest day, dropping invalid values', () => {
    const state = migrateState({
      login: 'me',
      seenIds: [],
      snoozed: { a: 123, b: 'later', c: Number.NaN },
      queued: { reviews: ['x', 1], sessionExpired: true },
      lastDigestDay: '2026-10-05'
    })
    expect(state).toMatchObject({
      snoozed: { a: 123 },
      queued: { reviews: ['x'], reminders: [], sessionExpired: true },
      lastDigestDay: '2026-10-05'
    })
  })
})

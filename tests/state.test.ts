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
      queued: { reviews: [], reminders: [], approved: [], changes: [], ready: [], sessionExpired: false },
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

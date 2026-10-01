import { describe, expect, it } from 'vitest'
import { migrateState } from '../src/main/state'

describe('migrateState', () => {
  it('upgrades the v1 state.json written by 0.1/0.2', () => {
    expect(migrateState({ login: 'octo', seenIds: ['a', 'b'] })).toEqual({
      v: 2,
      login: 'octo',
      seenIds: ['a', 'b'],
      dismissedIds: []
    })
    expect(migrateState({ login: 'octo', seenIds: ['a'], dismissedIds: ['a'] })?.dismissedIds).toEqual(['a'])
  })

  it('keeps v2 as is and drops non-string ids', () => {
    expect(migrateState({ v: 2, login: 'octo', seenIds: ['a', 3], dismissedIds: [null, 'b'] })).toEqual({
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

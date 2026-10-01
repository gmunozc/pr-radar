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

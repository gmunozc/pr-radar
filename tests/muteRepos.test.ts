import { describe, expect, it } from 'vitest'
import { withMuted } from '../src/renderer/muteRepos'

describe('withMuted', () => {
  it('adds or removes a repository once, keeping the rest', () => {
    expect(withMuted([], 'acme/app', true)).toEqual(['acme/app'])
    expect(withMuted(['acme/app'], 'acme/app', true)).toEqual(['acme/app'])
    expect(withMuted(['acme/app', 'other/repo'], 'acme/app', false)).toEqual(['other/repo'])
    expect(withMuted(['other/repo'], 'acme/app', false)).toEqual(['other/repo'])
  })
})

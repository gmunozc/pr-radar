import { describe, expect, it } from 'vitest'
import { myPrMenuActions } from '../src/shared/prActions'
import { myPr } from './fixtures'

describe('myPrMenuActions', () => {
  it('only copies and opens without a session that can write', () => {
    expect(myPrMenuActions(myPr('a', { mergeable: true }), false)).toEqual(['copy_branch', 'copy_link', 'open'])
  })

  it('offers a merge whenever GitHub would accept one, approvals or not', () => {
    expect(myPrMenuActions(myPr('a', { mergeable: true, status: 'no_reviewers' }), true)).toEqual([
      'merge',
      'copy_branch',
      'copy_link',
      'open'
    ])
    const noMethods = myPr('a', { mergeable: true, merge: { methods: [], defaultMethod: 'MERGE', deleteBranchOnMerge: false, autoMergeAllowed: false } })
    expect(myPrMenuActions(noMethods, true)).not.toContain('merge')
    expect(myPrMenuActions(myPr('a', { mergeable: true, can: { ...myPr('a').can, merge: false } }), true)).not.toContain('merge')
  })

  it('follows GitHub for update-branch and auto-merge', () => {
    const behind = myPr('a', { can: { ...myPr('a').can, updateBranch: true, enableAutoMerge: true } })
    expect(myPrMenuActions(behind, true)).toEqual(['update_branch', 'enable_auto_merge', 'copy_branch', 'copy_link', 'open'])

    const enabled = myPr('a', {
      autoMerge: { method: 'SQUASH', enabledAt: 'T' },
      can: { ...myPr('a').can, disableAutoMerge: true, enableAutoMerge: false }
    })
    expect(myPrMenuActions(enabled, true)).toEqual(['disable_auto_merge', 'copy_branch', 'copy_link', 'open'])
  })

  it('explains a repository without auto-merge, with a settings link for admins', () => {
    const blocked = myPr('a', { permission: 'WRITE' })
    expect(myPrMenuActions(blocked, true)).toEqual(['no_auto_merge', 'copy_branch', 'copy_link', 'open'])
    expect(myPrMenuActions(myPr('a', { permission: 'ADMIN' }), true)).toEqual([
      'no_auto_merge',
      'repo_settings',
      'copy_branch',
      'copy_link',
      'open'
    ])
    const allowed = myPr('a', { merge: { ...myPr('a').merge, autoMergeAllowed: true } })
    expect(myPrMenuActions(allowed, true)).toEqual(['copy_branch', 'copy_link', 'open'])
  })

  it('never suggests auto-merge for drafts or a merge-ready PR, and skips copying an unknown branch', () => {
    expect(myPrMenuActions(myPr('a', { isDraft: true }), true)).toEqual(['copy_branch', 'copy_link', 'open'])
    expect(myPrMenuActions(myPr('a', { mergeable: true, can: { ...myPr('a').can, enableAutoMerge: true } }), true)).toEqual([
      'merge',
      'copy_branch',
      'copy_link',
      'open'
    ])
    expect(myPrMenuActions(myPr('a', { branch: '' }), false)).toEqual(['copy_link', 'open'])
  })
})

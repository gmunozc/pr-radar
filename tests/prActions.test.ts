import { describe, expect, it } from 'vitest'
import { myPrMenuActions, reviewMenuActions } from '../src/shared/prActions'
import { myPr, pr } from './fixtures'

describe('reviewMenuActions', () => {
  it('offers approval only to sessions that can write, never on your own PR', () => {
    expect(reviewMenuActions(pr('a'), true)).toEqual([
      'approve',
      'snooze_hour',
      'snooze_tomorrow',
      'snooze_push',
      'dismiss',
      'copy_branch',
      'copy_link',
      'open'
    ])
    expect(reviewMenuActions(pr('a', { viewerDidAuthor: true }), true)).not.toContain('approve')
    expect(reviewMenuActions(pr('a', { branch: '' }), false)).toEqual([
      'snooze_hour',
      'snooze_tomorrow',
      'snooze_push',
      'dismiss',
      'copy_link',
      'open'
    ])
  })

  it('never snoozes or dismisses a PR you merely take part in', () => {
    expect(reviewMenuActions(pr('a', { source: { kind: 'involved' } }), true)).toEqual(['approve', 'copy_branch', 'copy_link', 'open'])
  })
})

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

  it('asks reviewers again only after changes were requested by someone it can name', () => {
    const changes = myPr('a', {
      status: 'changes_requested',
      reviews: [{ login: 'ana', avatarUrl: '', state: 'CHANGES_REQUESTED', id: 'U_1' }]
    })
    expect(myPrMenuActions(changes, true)).toEqual(['rerequest_review', 'arm_merge', 'copy_branch', 'copy_link', 'open'])
    const anonymous = myPr('a', { status: 'changes_requested', reviews: [{ login: 'ana', avatarUrl: '', state: 'CHANGES_REQUESTED' }] })
    expect(myPrMenuActions(anonymous, true)).not.toContain('rerequest_review')
    expect(myPrMenuActions(myPr('a', { status: 'approved', reviews: changes.reviews }), true)).not.toContain('rerequest_review')
  })

  it("offers PR Radar's own merge-when-ready where GitHub's auto-merge is not available", () => {
    expect(myPrMenuActions(myPr('a', { permission: 'WRITE' }), true)).toEqual(['arm_merge', 'copy_branch', 'copy_link', 'open'])
    expect(myPrMenuActions(myPr('a', { permission: 'ADMIN' }), true)).toEqual([
      'arm_merge',
      'repo_settings',
      'copy_branch',
      'copy_link',
      'open'
    ])
    // Allowed by the repository but not for this user: PR Radar can still do it.
    const allowed = myPr('a', { merge: { ...myPr('a').merge, autoMergeAllowed: true } })
    expect(myPrMenuActions(allowed, true)).toEqual(['arm_merge', 'copy_branch', 'copy_link', 'open'])
    expect(myPrMenuActions(myPr('a'), true, true)).toEqual(['disarm_merge', 'copy_branch', 'copy_link', 'open'])
    expect(myPrMenuActions(myPr('a', { can: { ...myPr('a').can, merge: false } }), true)).toEqual(['copy_branch', 'copy_link', 'open'])
  })

  it('never suggests merging later for drafts or a merge-ready PR, and skips copying an unknown branch', () => {
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

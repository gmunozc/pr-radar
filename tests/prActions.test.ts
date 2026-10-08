import { describe, expect, it } from 'vitest'
import { MENU_KEY, myPrMenuActions, quickKeyHint, REVIEW_QUICK_KEYS, reviewMenuActions } from '../src/shared/prActions'
import { myPr, pr } from './fixtures'

/** What every row ends with, when the row knows nothing about muting. */
const shared = ['copy_branch', 'copy_link', 'copy_title_link', 'details', 'view_files', 'view_checks', 'open']
const sharedNoBranch = shared.filter((id) => id !== 'copy_branch')

describe('reviewMenuActions', () => {
  it('offers approval only to sessions that can write, never on your own PR', () => {
    expect(reviewMenuActions(pr('a'), true)).toEqual(['approve', 'snooze_hour', 'snooze_tomorrow', 'snooze_push', 'dismiss', ...shared])
    expect(reviewMenuActions(pr('a', { viewerDidAuthor: true }), true)).not.toContain('approve')
    expect(reviewMenuActions(pr('a', { branch: '' }), false)).toEqual([
      'snooze_hour',
      'snooze_tomorrow',
      'snooze_push',
      'dismiss',
      ...sharedNoBranch
    ])
  })

  it('lets you dismiss, but not snooze, a PR you merely take part in', () => {
    expect(reviewMenuActions(pr('a', { source: { kind: 'involved' } }), true)).toEqual(['approve', 'dismiss', ...shared])
  })

  it('offers to mute or unmute the repository once the row knows its state', () => {
    expect(reviewMenuActions(pr('a'), false, { muted: false })).toEqual([
      'snooze_hour',
      'snooze_tomorrow',
      'snooze_push',
      'dismiss',
      'copy_branch',
      'copy_link',
      'copy_title_link',
      'details',
      'mute_repo',
      'view_files',
      'view_checks',
      'open'
    ])
    expect(reviewMenuActions(pr('a'), false, { muted: true })).toContain('unmute_repo')
    expect(reviewMenuActions(pr('a'), false, { muted: true })).not.toContain('mute_repo')
  })
})

describe('myPrMenuActions', () => {
  it('only copies and opens without a session that can write', () => {
    expect(myPrMenuActions(myPr('a', { mergeable: true }), false)).toEqual(shared)
  })

  it('offers a merge whenever GitHub would accept one, approvals or not', () => {
    expect(myPrMenuActions(myPr('a', { mergeable: true, status: 'no_reviewers' }), true)).toEqual(['merge', ...shared])
    const noMethods = myPr('a', { mergeable: true, merge: { methods: [], defaultMethod: 'MERGE', deleteBranchOnMerge: false, autoMergeAllowed: false } })
    expect(myPrMenuActions(noMethods, true)).not.toContain('merge')
    expect(myPrMenuActions(myPr('a', { mergeable: true, can: { ...myPr('a').can, merge: false } }), true)).not.toContain('merge')
  })

  it('follows GitHub for update-branch and auto-merge', () => {
    const behind = myPr('a', { can: { ...myPr('a').can, updateBranch: true, enableAutoMerge: true } })
    expect(myPrMenuActions(behind, true)).toEqual(['update_branch', 'enable_auto_merge', ...shared])

    const enabled = myPr('a', {
      autoMerge: { method: 'SQUASH', enabledAt: 'T' },
      can: { ...myPr('a').can, disableAutoMerge: true, enableAutoMerge: false }
    })
    expect(myPrMenuActions(enabled, true)).toEqual(['disable_auto_merge', ...shared])
  })

  it('asks reviewers again only after changes were requested by someone it can name', () => {
    const changes = myPr('a', {
      status: 'changes_requested',
      reviews: [{ login: 'ana', avatarUrl: '', state: 'CHANGES_REQUESTED', id: 'U_1' }]
    })
    expect(myPrMenuActions(changes, true)).toEqual(['rerequest_review', 'arm_merge', ...shared])
    const anonymous = myPr('a', { status: 'changes_requested', reviews: [{ login: 'ana', avatarUrl: '', state: 'CHANGES_REQUESTED' }] })
    expect(myPrMenuActions(anonymous, true)).not.toContain('rerequest_review')
    expect(myPrMenuActions(myPr('a', { status: 'approved', reviews: changes.reviews }), true)).not.toContain('rerequest_review')
  })

  it("offers PR Radar's own merge-when-ready where GitHub's auto-merge is not available", () => {
    expect(myPrMenuActions(myPr('a', { permission: 'WRITE' }), true)).toEqual(['arm_merge', ...shared])
    expect(myPrMenuActions(myPr('a', { permission: 'ADMIN' }), true)).toEqual(['arm_merge', 'repo_settings', ...shared])
    // Allowed by the repository but not for this user: PR Radar can still do it.
    const allowed = myPr('a', { merge: { ...myPr('a').merge, autoMergeAllowed: true } })
    expect(myPrMenuActions(allowed, true)).toEqual(['arm_merge', ...shared])
    expect(myPrMenuActions(myPr('a'), true, true)).toEqual(['disarm_merge', ...shared])
    expect(myPrMenuActions(myPr('a', { can: { ...myPr('a').can, merge: false } }), true)).toEqual(shared)
  })

  it('never suggests merging later for drafts or a merge-ready PR, and skips copying an unknown branch', () => {
    expect(myPrMenuActions(myPr('a', { isDraft: true }), true)).toEqual(shared)
    expect(myPrMenuActions(myPr('a', { mergeable: true, can: { ...myPr('a').can, enableAutoMerge: true } }), true)).toEqual(['merge', ...shared])
    expect(myPrMenuActions(myPr('a', { branch: '' }), false)).toEqual(sharedNoBranch)
    expect(myPrMenuActions(myPr('a'), false, false, { muted: true })).toContain('unmute_repo')
  })
})

describe('quick keys', () => {
  it('map to review actions that exist, and hint their letter in the menu', () => {
    const offered = reviewMenuActions(pr('a'), true)
    for (const [key, action] of Object.entries(REVIEW_QUICK_KEYS)) {
      expect(offered).toContain(action)
      expect(quickKeyHint(action)).toBe(key.toUpperCase())
    }
    expect(quickKeyHint('open')).toBeUndefined()
    expect(MENU_KEY).toBe('m')
  })
})

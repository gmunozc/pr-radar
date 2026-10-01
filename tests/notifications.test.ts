import { describe, expect, it } from 'vitest'
import { planToEvents, renderNotification as render, type NotificationEvent } from '../src/main/notifications'
import { translator } from '../src/shared/i18n'
import type { MyPullRequest, PullRequest } from '../src/shared/types'

const pr = (over: Partial<PullRequest> = {}): PullRequest => ({
  id: 'PR_1',
  number: 12,
  title: 'Add feature',
  url: 'https://github.com/acme/app/pull/12',
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
  newCommitsSinceReview: false,
  ...over
})

describe('planToEvents', () => {
  it('maps every notification plan to events', () => {
    expect(planToEvents({ kind: 'none' })).toEqual([])
    expect(planToEvents({ kind: 'summary', count: 3 })).toEqual([{ kind: 'reviews_summary', count: 3 }])
    expect(planToEvents({ kind: 'individual', prs: [pr(), pr({ id: 'PR_2' })] })).toHaveLength(2)
    expect(planToEvents({ kind: 'grouped', prs: [pr()] })).toEqual([{ kind: 'reviews_grouped', prs: [pr()] }])
  })
})

const es = translator('es')
const en = translator('en')
const renderNotification = (event: NotificationEvent) => render(event, es)

describe('renderNotification', () => {
  it('opens the PR for a single review request and replaces by PR id', () => {
    expect(renderNotification({ kind: 'review_requested', pr: pr() })).toEqual({
      id: 'PR_1',
      title: 'Nueva review solicitada',
      body: 'acme/app#12 · Add feature — @octo',
      action: { kind: 'open_url', url: 'https://github.com/acme/app/pull/12' }
    })
  })

  it('names the team for team requests', () => {
    const n = renderNotification({ kind: 'review_requested', pr: pr({ source: { kind: 'team', slug: 'backend' } }) })
    expect(n.title).toBe('Review solicitada a tu equipo backend')
  })

  it('opens the panel for summaries and grouped requests', () => {
    expect(renderNotification({ kind: 'reviews_summary', count: 1 }).body).toBe('Tienes 1 PR pendiente de revisar')
    expect(renderNotification({ kind: 'reviews_summary', count: 4 }).body).toBe('Tienes 4 PRs pendientes de revisar')
    const grouped = renderNotification({ kind: 'reviews_grouped', prs: [pr(), pr({ number: 13 }), pr({ number: 14 }), pr({ number: 15 })] })
    expect(grouped).toMatchObject({ title: '4 nuevas reviews solicitadas', action: { kind: 'open_panel' } })
    expect(grouped.body).toBe('acme/app#12, acme/app#13, acme/app#14…')
  })

  it('uses fixed ids for the session and test notifications', () => {
    expect(renderNotification({ kind: 'session_expired' }).id).toBe('pr-radar-logged-out')
    expect(renderNotification({ kind: 'test' }).id).toBe('pr-radar-test')
  })
})

describe('renderNotification in English', () => {
  it('translates every notification', () => {
    expect(render({ kind: 'review_requested', pr: pr() }, en).title).toBe('New review requested')
    expect(render({ kind: 'review_requested', pr: pr({ source: { kind: 'team', slug: 'core' } }) }, en).title).toBe(
      'Review requested from your team core'
    )
    expect(render({ kind: 'reviews_summary', count: 1 }, en).body).toBe('You have 1 PR to review')
    expect(render({ kind: 'reviews_summary', count: 2 }, en).body).toBe('You have 2 PRs to review')
    expect(render({ kind: 'reviews_grouped', prs: [pr(), pr()] }, en).title).toBe('2 new review requests')
    expect(render({ kind: 'session_expired' }, en).body).toBe('Your GitHub session expired. Reconnect your account.')
    expect(render({ kind: 'test' }, en).body).toBe('Notifications are working.')
  })
})

describe('notifications about your PRs', () => {
  const mine = { ...pr({ id: 'MY_1' }), status: 'approved', pendingReviewers: [], reviews: [], readyToMerge: true, blocker: null, conflicts: false } as MyPullRequest

  it('reads well in both languages and replaces per PR', () => {
    expect(render({ kind: 'my_pr_approved', pr: mine, by: ['ana', 'bob'] }, es)).toEqual({
      id: 'mine-MY_1',
      title: 'Aprobaron tu PR',
      body: 'acme/app#12 · Add feature — @ana, @bob',
      action: { kind: 'open_url', url: 'https://github.com/acme/app/pull/12' }
    })
    expect(render({ kind: 'my_pr_changes_requested', pr: mine, by: ['ana'] }, en).title).toBe('Changes requested on your PR')
    expect(render({ kind: 'my_pr_ready', pr: mine }, en)).toMatchObject({ id: 'mine-MY_1', title: 'Ready to merge' })
    expect(render({ kind: 'my_prs_grouped', count: 5 }, es).body).toBe('5 novedades en tus PRs')
  })

  it('says when a review is requested again after new commits', () => {
    expect(render({ kind: 'review_requested', pr: pr({ newCommitsSinceReview: true }) }, es).title).toBe('Te piden revisar de nuevo')
  })
})

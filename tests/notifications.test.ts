import { describe, expect, it } from 'vitest'
import { planToEvents, renderNotification as render, type NotificationEvent } from '../src/main/notifications'
import { translator } from '../src/shared/i18n'
import type { PullRequest } from '../src/shared/types'
import * as fx from './fixtures'

const sample = { number: 12, title: 'Add feature', url: 'https://github.com/acme/app/pull/12' }
const pr = (over: Partial<PullRequest> = {}): PullRequest => fx.pr('PR_1', { ...sample, ...over })

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
      action: { kind: 'open_url', url: 'https://github.com/acme/app/pull/12' },
      buttons: [{ label: 'Posponer 1 h', action: { kind: 'snooze', prId: 'PR_1', option: 'hour' } }]
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
  const mine = fx.myPr('MY_1', { ...sample, status: 'approved', readyToMerge: true })

  it('reads well in both languages and replaces per PR', () => {
    expect(render({ kind: 'my_pr_approved', pr: mine, by: ['ana', 'bob'] }, es)).toEqual({
      id: 'mine-MY_1',
      title: 'Aprobaron tu PR',
      body: 'acme/app#12 · Add feature — @ana, @bob',
      action: { kind: 'open_url', url: 'https://github.com/acme/app/pull/12' }
    })
    expect(render({ kind: 'my_pr_changes_requested', pr: mine, by: ['ana'] }, en).title).toBe('Changes requested on your PR')
    expect(render({ kind: 'my_pr_ready', pr: mine }, en)).toMatchObject({ id: 'mine-MY_1', title: 'Ready to merge' })
    const auto = { ...mine, autoMerge: { method: 'SQUASH' as const, enabledAt: 'T' } }
    expect(render({ kind: 'my_pr_ready', pr: auto }, en).body).toBe('acme/app#12 · Add feature · It will merge on its own.')
    expect(render({ kind: 'my_pr_ready', pr: auto }, es).body).toBe('acme/app#12 · Add feature · Se mergeará solo.')
  })

  it('reports merges PR Radar did itself, and the ones it could not do', () => {
    expect(render({ kind: 'my_pr_merged', pr: mine, method: 'SQUASH' }, es)).toEqual({
      id: 'mine-MY_1',
      title: 'Mergeado (Squash)',
      body: 'acme/app#12 · Add feature',
      action: { kind: 'open_url', url: 'https://github.com/acme/app/pull/12' }
    })
    expect(render({ kind: 'merge_failed', pr: mine, code: 'not_mergeable' }, en)).toMatchObject({
      title: 'Could not merge',
      body: 'acme/app#12 · Add feature — GitHub does not allow merging it right now.'
    })
    expect(render({ kind: 'my_prs_grouped', count: 5 }, es).body).toBe('5 novedades en tus PRs')
  })

  it('says when a review is requested again after new commits', () => {
    expect(render({ kind: 'review_requested', pr: pr({ newCommitsSinceReview: true }) }, es).title).toBe('Te piden revisar de nuevo')
  })
})

describe('reminders, catch-up and digest notifications', () => {
  const none = { reviews: 0, reminders: 0, approved: 0, changes: 0, ready: 0, merged: 0, mergeFailed: 0, sessionExpired: false }

  it('reminds about one snoozed PR by opening it, and summarizes several', () => {
    expect(render({ kind: 'snooze_returned', prs: [pr()] }, es)).toMatchObject({
      id: 'PR_1',
      title: 'Recordatorio: review pendiente',
      action: { kind: 'open_url' }
    })
    expect(render({ kind: 'snooze_returned', prs: [pr(), pr()] }, en).body).toBe('2 snoozed reviews are pending again')
  })

  it('lists what happened while you were away', () => {
    const counts = { ...none, reviews: 2, approved: 1, sessionExpired: true }
    expect(render({ kind: 'catch_up', counts }, es)).toMatchObject({
      title: 'Mientras no estabas',
      body: '2 reviews nuevas · 1 PR aprobado · tu sesión caducó'
    })
  })

  it('builds the daily digest, with the caught-up alerts first', () => {
    const digest = { kind: 'digest' as const, reviews: 3, oldestDays: 4, ready: 1, changes: 0, caughtUp: null }
    expect(render(digest, en)).toMatchObject({
      title: 'PR Radar · daily summary',
      body: '3 reviews pending (oldest: 4 days) · 1 PR ready to merge'
    })
    expect(render({ ...digest, oldestDays: 0, ready: 0, caughtUp: { ...none, reviews: 1 } }, es).body).toBe(
      'Mientras no estabas: 1 review nueva. 3 reviews pendientes'
    )
  })
})

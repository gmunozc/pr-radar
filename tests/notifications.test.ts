import { describe, expect, it } from 'vitest'
import type { MyPrEvent } from '../src/main/diff'
import { filterMyPrEvents, planToEvents, renderNotification as render, staleNotifications, type NotificationEvent } from '../src/main/notifications'
import { translator } from '../src/shared/i18n'
import { DEFAULT_SETTINGS, type PullRequest } from '../src/shared/types'
import * as fx from './fixtures'

const sample = { number: 12, title: 'Add feature', url: 'https://github.com/acme/app/pull/12' }
const pr = (over: Partial<PullRequest> = {}): PullRequest => fx.pr('PR_1', { ...sample, ...over })
const avatar = 'https://avatars.githubusercontent.com/u/1?v=4'

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

const reviewButtons = [
  { label: 'Posponer 1 h', action: { kind: 'snooze', prId: 'PR_1', option: 'hour' } },
  { label: 'Hasta mañana', action: { kind: 'snooze', prId: 'PR_1', option: 'tomorrow' } },
  { label: 'Descartar', action: { kind: 'dismiss', prId: 'PR_1' } }
]

describe('renderNotification', () => {
  it('opens the PR for a single review request, with snooze and dismiss buttons, grouped by repository', () => {
    expect(renderNotification({ kind: 'review_requested', pr: pr() })).toEqual({
      id: 'PR_1',
      groupId: 'acme/app',
      title: 'Nueva review solicitada',
      subtitle: 'acme/app#12 · @octo',
      body: 'Add feature',
      action: { kind: 'open_pr', prId: 'PR_1', url: 'https://github.com/acme/app/pull/12' },
      buttons: reviewButtons
    })
  })

  it("shows the author's avatar when GitHub has one, and copes without an author", () => {
    expect(renderNotification({ kind: 'review_requested', pr: pr({ author: { login: 'octo', avatarUrl: avatar } }) }).imageUrl).toBe(avatar)
    const orphan = renderNotification({ kind: 'review_requested', pr: pr({ author: null }) })
    expect(orphan.subtitle).toBe('acme/app#12')
    expect(orphan).not.toHaveProperty('imageUrl')
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
    expect(grouped.buttons).toBeUndefined()
  })

  it('uses fixed ids for the session and test notifications, and a button on the test one', () => {
    expect(renderNotification({ kind: 'session_expired' }).id).toBe('pr-radar-logged-out')
    expect(renderNotification({ kind: 'test' })).toMatchObject({
      id: 'pr-radar-test',
      buttons: [{ label: 'Abrir PR Radar', action: { kind: 'open_panel' } }]
    })
  })
})

describe('renderNotification in English', () => {
  it('translates every notification', () => {
    expect(render({ kind: 'review_requested', pr: pr() }, en).title).toBe('New review requested')
    expect(render({ kind: 'review_requested', pr: pr() }, en).buttons?.map((b) => b.label)).toEqual(['Snooze 1 h', 'Until tomorrow', 'Dismiss'])
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
      groupId: 'acme/app',
      title: 'Aprobaron tu PR',
      subtitle: 'acme/app#12 · @ana, @bob',
      body: 'Add feature',
      action: { kind: 'open_pr', prId: 'MY_1', url: 'https://github.com/acme/app/pull/12' }
    })
    expect(render({ kind: 'my_pr_changes_requested', pr: mine, by: ['ana'] }, en).title).toBe('Changes requested on your PR')
    expect(render({ kind: 'my_pr_ready', pr: mine }, en)).toMatchObject({ id: 'mine-MY_1', title: 'Ready to merge', subtitle: 'acme/app#12' })
    const auto = { ...mine, autoMerge: { method: 'SQUASH' as const, enabledAt: 'T' } }
    expect(render({ kind: 'my_pr_ready', pr: auto }, en).body).toBe('Add feature · It will merge on its own.')
    expect(render({ kind: 'my_pr_ready', pr: auto }, es).body).toBe('Add feature · Se mergeará solo.')
  })

  it("shows the avatar of the reviewer named first", () => {
    const reviewed = { ...mine, reviews: [{ login: 'ana', avatarUrl: avatar, state: 'APPROVED' as const }] }
    expect(render({ kind: 'my_pr_approved', pr: reviewed, by: ['ana'] }, es).imageUrl).toBe(avatar)
    expect(render({ kind: 'my_pr_approved', pr: reviewed, by: ['bob'] }, es)).not.toHaveProperty('imageUrl')
  })

  it('reports failing checks by name, opening the checks tab, and new conflicts', () => {
    expect(render({ kind: 'my_pr_ci_failed', pr: mine, failing: ['Pytest shard 1/4', 'lint', 'build'] }, es)).toEqual({
      id: 'ci-MY_1',
      groupId: 'acme/app',
      title: 'Fallan los checks de tu PR',
      subtitle: 'acme/app#12',
      body: 'Add feature · Fallando: Pytest shard 1/4, lint…',
      action: { kind: 'open_pr', prId: 'MY_1', url: 'https://github.com/acme/app/pull/12/checks' }
    })
    expect(render({ kind: 'my_pr_ci_failed', pr: mine, failing: [] }, en)).toMatchObject({ title: 'Checks failed on your PR', body: 'Add feature' })
    expect(render({ kind: 'my_pr_conflicts', pr: mine }, es)).toEqual({
      id: 'conflicts-MY_1',
      groupId: 'acme/app',
      title: 'Tu PR tiene conflictos',
      subtitle: 'acme/app#12',
      body: 'Add feature · Conflictos con main',
      action: { kind: 'open_pr', prId: 'MY_1', url: 'https://github.com/acme/app/pull/12' }
    })
    expect(render({ kind: 'my_pr_conflicts', pr: { ...mine, baseBranch: '' } }, en)).toMatchObject({ title: 'Your PR has conflicts', body: 'Add feature' })
  })

  it('reports new comments under their own id, naming the commenter', () => {
    const reviewed = { ...mine, reviews: [{ login: 'ana', avatarUrl: avatar, state: 'COMMENTED' as const }] }
    expect(render({ kind: 'my_pr_commented', pr: reviewed, by: ['ana'] }, es)).toEqual({
      id: 'comments-MY_1',
      groupId: 'acme/app',
      title: 'Comentaron en tu PR',
      subtitle: 'acme/app#12 · @ana',
      body: 'Add feature',
      imageUrl: avatar,
      action: { kind: 'open_pr', prId: 'MY_1', url: 'https://github.com/acme/app/pull/12' }
    })
    expect(render({ kind: 'my_pr_commented', pr: mine, by: ['ana'] }, en).title).toBe('New comments on your PR')
  })

  it('reports merges PR Radar did itself under their own id, and the ones it could not do', () => {
    expect(render({ kind: 'my_pr_merged', pr: mine, method: 'SQUASH' }, es)).toEqual({
      id: 'merged-MY_1',
      groupId: 'acme/app',
      title: 'Mergeado (Squash)',
      subtitle: 'acme/app#12',
      body: 'Add feature',
      action: { kind: 'open_pr', prId: 'MY_1', url: 'https://github.com/acme/app/pull/12' }
    })
    expect(render({ kind: 'merge_failed', pr: mine, code: 'not_mergeable' }, en)).toMatchObject({
      id: 'mine-MY_1',
      title: 'Could not merge',
      body: 'Add feature · GitHub does not allow merging it right now.'
    })
    expect(render({ kind: 'my_prs_grouped', count: 5 }, es).body).toBe('5 novedades en tus PRs')
  })

  it('says when a review is requested again after new commits', () => {
    expect(render({ kind: 'review_requested', pr: pr({ newCommitsSinceReview: true }) }, es).title).toBe('Te piden revisar de nuevo')
  })
})

describe('reminders, catch-up and digest notifications', () => {
  const none = {
    reviews: 0,
    reminders: 0,
    approved: 0,
    changes: 0,
    ready: 0,
    ciFailed: 0,
    conflicts: 0,
    commented: 0,
    merged: 0,
    mergeFailed: 0,
    sessionExpired: false
  }

  it('reminds about one snoozed PR by opening it, with the same buttons as a request, and summarizes several', () => {
    expect(render({ kind: 'snooze_returned', prs: [pr()] }, es)).toMatchObject({
      id: 'PR_1',
      groupId: 'acme/app',
      title: 'Recordatorio: review pendiente',
      subtitle: 'acme/app#12 · @octo',
      body: 'Add feature',
      action: { kind: 'open_pr', prId: 'PR_1' },
      buttons: reviewButtons
    })
    const many = render({ kind: 'snooze_returned', prs: [pr(), pr()] }, en)
    expect(many.body).toBe('2 snoozed reviews are pending again')
    expect(many.buttons).toBeUndefined()
  })

  it('lists what happened while you were away', () => {
    const counts = { ...none, reviews: 2, approved: 1, ciFailed: 1, conflicts: 2, sessionExpired: true }
    expect(render({ kind: 'catch_up', counts }, es)).toMatchObject({
      title: 'Mientras no estabas',
      body: '2 reviews nuevas · 1 PR aprobado · 1 PR con checks fallidos · 2 PRs con conflictos · tu sesión caducó'
    })
    expect(render({ kind: 'catch_up', counts: { ...none, ciFailed: 2, conflicts: 1 } }, en).body).toBe(
      '2 PRs with failing checks · 1 PR with conflicts'
    )
    expect(render({ kind: 'catch_up', counts: { ...none, commented: 2 } }, es).body).toBe('2 PRs con comentarios nuevos')
  })

  it('builds the daily digest, with the caught-up alerts first', () => {
    const digest = { kind: 'digest' as const, reviews: 3, oldestDays: 4, ready: 1, changes: 0, stale: [], staleDays: 3, caughtUp: null }
    expect(render(digest, en)).toMatchObject({
      title: 'PR Radar · daily summary',
      body: '3 reviews pending (oldest: 4 days) · 1 PR ready to merge'
    })
    expect(render({ ...digest, oldestDays: 0, ready: 0, caughtUp: { ...none, reviews: 1 } }, es).body).toBe(
      'Mientras no estabas: 1 review nueva. 3 reviews pendientes'
    )
  })

  it('reminds about stale reviews, listing three at most, alone or inside the digest', () => {
    const digest = { kind: 'digest' as const, reviews: 3, oldestDays: 4, ready: 1, changes: 0, stale: [], staleDays: 3, caughtUp: null }
    const prs = [pr(), pr({ id: 'PR_2', number: 13 }), pr({ id: 'PR_3', number: 14 }), pr({ id: 'PR_4', number: 15 })]
    expect(render({ kind: 'stale_reviews', prs, days: 3 }, es)).toEqual({
      id: 'pr-radar-stale',
      title: 'Reviews estancadas',
      body: '4 reviews llevan esperando más de 3 días: acme/app#12, acme/app#13, acme/app#14…',
      action: { kind: 'open_panel' }
    })
    expect(render({ kind: 'stale_reviews', prs: prs.slice(0, 1), days: 1 }, en).body).toBe(
      '1 review has been waiting more than 1 day: acme/app#12'
    )
    expect(render({ ...digest, stale: prs.slice(0, 2), staleDays: 3 }, es).body).toBe(
      '3 reviews pendientes (la más antigua: 4 días) · 2 reviews llevan esperando más de 3 días: acme/app#12, acme/app#13 · 1 PR listo para merge'
    )
  })
})

describe('staleNotifications', () => {
  it('retires review requests that left, your PRs that closed, checks green again and conflicts solved', () => {
    const prev = {
      m1: { status: 'waiting' as const, ci: 'failure' as const },
      m2: { status: 'waiting' as const, conflicts: true },
      m3: { status: 'approved' as const }
    }
    const ids = staleNotifications(['a', 'b'], [fx.pr('b')], prev, [fx.myPr('m1', { ci: 'success' }), fx.myPr('m2', { conflicts: false })])
    expect(ids).toEqual(['a', 'ci-m1', 'conflicts-m2', 'mine-m3', 'ci-m3', 'conflicts-m3', 'comments-m3'])
  })

  it('keeps notifications about PRs that are still there as they were', () => {
    const prev = { m1: { status: 'waiting' as const, ci: 'failure' as const, conflicts: true } }
    expect(staleNotifications(['a'], [fx.pr('a')], prev, [fx.myPr('m1', { ci: 'failure', conflicts: true })])).toEqual([])
    expect(staleNotifications([], [], undefined, [])).toEqual([])
  })
})

describe('filterMyPrEvents', () => {
  it('drops everything when updates on your PRs are off, and the kinds turned off otherwise', () => {
    const mine = fx.myPr('MY_1')
    const events: MyPrEvent[] = [
      { kind: 'my_pr_approved', pr: mine, by: [] },
      { kind: 'my_pr_ci_failed', pr: mine, failing: [] },
      { kind: 'my_pr_commented', pr: mine, by: ['ana'] }
    ]
    expect(filterMyPrEvents(events, { notifyMyPrs: false, notifyKinds: DEFAULT_SETTINGS.notifyKinds })).toEqual([])
    const kinds = { ...DEFAULT_SETTINGS.notifyKinds, ciFailed: false, commented: false }
    expect(filterMyPrEvents(events, { notifyMyPrs: true, notifyKinds: kinds }).map((e) => e.kind)).toEqual(['my_pr_approved'])
  })
})

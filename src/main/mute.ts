/** Muted repositories: their PRs stay in the lists, but nothing about them is notified. */
import { MAX_INDIVIDUAL_NOTIFICATIONS, type NotificationPlan } from './diff'
import type { Alerts } from './engine'

/**
 * Drops the alerts about muted repositories. Merges PR Radar did on the user's behalf are
 * reported whatever the repository: the user asked for them.
 */
export function applyMute(alerts: Alerts, repos: readonly string[]): Alerts {
  if (repos.length === 0) return alerts
  const muted = new Set(repos)
  const keep = <T extends { repo: string }>(prs: T[]): T[] => prs.filter((p) => !muted.has(p.repo))
  let reviewPlan: NotificationPlan = alerts.reviewPlan
  if (reviewPlan.kind === 'individual' || reviewPlan.kind === 'grouped') {
    const prs = keep(reviewPlan.prs)
    // A group that shrank to a few can be told PR by PR after all.
    reviewPlan = prs.length === 0 ? { kind: 'none' } : prs.length <= MAX_INDIVIDUAL_NOTIFICATIONS ? { kind: 'individual', prs } : { kind: 'grouped', prs }
  }
  return {
    ...alerts,
    reviewPlan,
    returned: keep(alerts.returned),
    mine: alerts.mine.filter((e) => !muted.has(e.pr.repo)),
    ...(alerts.outcomes ? { outcomes: alerts.outcomes.filter((o) => !muted.has(o.pr.repo)) } : {})
  }
}

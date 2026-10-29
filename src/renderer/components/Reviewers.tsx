import type { ReactNode } from 'react'
import type { Translate } from '../../shared/i18n'
import type { PrReviewers } from '../../shared/types'
import { useT } from '../i18n'
import { REVIEW_LOOK } from '../reviews'

const MAX_AVATARS = 4

interface Person {
  key: string
  avatarUrl: string
  ring: 'approved' | 'changes' | 'commented' | 'waiting'
  title: string
}

/** Who already reviewed (approved, changes, comments) and who is still pending, as avatars. */
function people(pr: PrReviewers, t: Translate): { avatars: Person[]; teams: string[] } {
  const avatars: Person[] = []
  for (const r of pr.reviews) {
    const look = REVIEW_LOOK[r.state]
    if (look) avatars.push({ key: `r-${r.login}`, avatarUrl: r.avatarUrl, ring: look.ring, title: t(look.label, { login: r.login }) })
  }
  const teams: string[] = []
  for (const r of pr.pendingReviewers) {
    if (r.kind === 'user') {
      avatars.push({
        key: `p-${r.login}`,
        avatarUrl: r.avatarUrl,
        ring: 'waiting',
        title: t('reviewer.pending', { name: `@${r.login}` })
      })
    } else {
      teams.push(r.slug ? `@${r.slug}` : t('reviewer.team'))
    }
  }
  return { avatars, teams }
}

/** The end of a row: approvals out of the required ones, then the reviewers; `children` follow them. */
export function Reviewers({ pr, children }: { pr: PrReviewers; children?: ReactNode }) {
  const t = useT()
  const { avatars, teams } = people(pr, t)
  const extra = avatars.length - MAX_AVATARS
  return (
    <span className="reviewers">
      {pr.requiredApprovals !== null && pr.requiredApprovals > 0 && (
        <span className="reviewers-count" title={t('mine.approvalsHint', { have: pr.approvals, need: pr.requiredApprovals })}>
          {pr.approvals}/{pr.requiredApprovals}
        </span>
      )}
      {teams.map((team) => (
        <span key={team} className="reviewer-team" title={t('reviewer.pending', { name: team })}>
          {team}
        </span>
      ))}
      {avatars.slice(0, MAX_AVATARS).map((p) => (
        <img key={p.key} className={`reviewer ring-${p.ring}`} src={p.avatarUrl} alt="" title={p.title} />
      ))}
      {extra > 0 && <span className="reviewer-more">+{extra}</span>}
      {children}
    </span>
  )
}

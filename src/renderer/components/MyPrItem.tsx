import type { KeyboardEvent } from 'react'
import { formatDateTime, timeAgo } from '../../shared/format'
import type { Translate } from '../../shared/i18n'
import type { MessageKey } from '../../shared/i18n/en'
import type { MyPullRequest, MyReviewStatus } from '../../shared/types'
import { PullRequestIcon } from '../icons'
import { useLocale, useT } from '../i18n'

const STATUS: Record<MyReviewStatus, { label: MessageKey; className: string }> = {
  waiting: { label: 'status.waiting', className: 'waiting' },
  approved: { label: 'status.approved', className: 'approved' },
  changes_requested: { label: 'status.changes_requested', className: 'changes' },
  no_reviewers: { label: 'status.no_reviewers', className: 'none' }
}

const MAX_AVATARS = 4

interface Person {
  key: string
  avatarUrl: string
  ring: 'approved' | 'changes' | 'waiting'
  title: string
}

/** Who already reviewed (approved / changes) and who is still pending, as avatars. */
function people(pr: MyPullRequest, t: Translate): { avatars: Person[]; teams: string[] } {
  const avatars: Person[] = pr.reviews
    .filter((r) => r.state === 'APPROVED' || r.state === 'CHANGES_REQUESTED')
    .map((r) => ({
      key: `r-${r.login}`,
      avatarUrl: r.avatarUrl,
      ring: r.state === 'APPROVED' ? 'approved' : 'changes',
      title: t(r.state === 'APPROVED' ? 'reviewer.approved' : 'reviewer.changes', { login: r.login })
    }))
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

export function MyPrItem({ pr }: { pr: MyPullRequest }) {
  const t = useT()
  const locale = useLocale()
  const open = () => void window.prRadar.openExternal(pr.url)
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      open()
    }
  }
  const [owner, name] = pr.repo.split('/')
  const status = STATUS[pr.status]
  const { avatars, teams } = people(pr, t)
  const extra = avatars.length - MAX_AVATARS

  return (
    <div className="pr" role="button" tabIndex={0} onClick={open} onKeyDown={onKeyDown} title={pr.url}>
      <div className={`status-icon status-${status.className}`}>
        <PullRequestIcon size={14} />
      </div>
      <div className="pr-body">
        <div className="pr-meta">
          <span className="pr-repo">
            <span className="pr-owner">{owner}/</span>
            {name}
          </span>
          <span className="pr-number">#{pr.number}</span>
          <span className="pr-age" title={formatDateTime(pr.createdAt, locale)}>
            {timeAgo(pr.createdAt, Date.now(), locale)}
          </span>
        </div>
        <div className="pr-title">{pr.title}</div>
        <div className="pr-tags">
          <span className={`chip chip-${status.className}`}>{t(status.label)}</span>
          {pr.isDraft && <span className="chip chip-draft">{t('pr.draft')}</span>}
          <span className="diff">
            <span className="add">+{pr.additions}</span> <span className="del">−{pr.deletions}</span>
          </span>
          <span className="reviewers">
            {teams.map((team) => (
              <span key={team} className="reviewer-team" title={t('reviewer.pending', { name: team })}>
                {team}
              </span>
            ))}
            {avatars.slice(0, MAX_AVATARS).map((p) => (
              <img key={p.key} className={`reviewer ring-${p.ring}`} src={p.avatarUrl} alt="" title={p.title} />
            ))}
            {extra > 0 && <span className="reviewer-more">+{extra}</span>}
          </span>
        </div>
      </div>
    </div>
  )
}

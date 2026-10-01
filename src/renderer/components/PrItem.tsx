import type { KeyboardEvent, MouseEvent } from 'react'
import { formatDateTime, timeAgo } from '../../shared/format'
import type { PullRequest } from '../../shared/types'
import { XIcon } from '../icons'
import { useLocale, useT } from '../i18n'

export function PrItem({ pr }: { pr: PullRequest }) {
  const t = useT()
  const locale = useLocale()
  const open = () => void window.prRadar.openExternal(pr.url)
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      open()
    }
  }
  const dismiss = (e: MouseEvent) => {
    e.stopPropagation()
    void window.prRadar.dismiss(pr.id)
  }
  const [owner, name] = pr.repo.split('/')

  // A div rather than a <button>, because it contains the dismiss button.
  return (
    <div className="pr" role="button" tabIndex={0} onClick={open} onKeyDown={onKeyDown} title={pr.url}>
      {pr.author ? (
        <img className="avatar" src={pr.author.avatarUrl} alt="" />
      ) : (
        <div className="avatar avatar-placeholder" />
      )}
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
          {pr.source.kind === 'direct' ? (
            <span className="chip chip-direct">{t('pr.direct')}</span>
          ) : (
            <span className="chip chip-team">
              {pr.source.slug ? t('pr.teamNamed', { slug: pr.source.slug }) : t('pr.team')}
            </span>
          )}
          {pr.isDraft && <span className="chip chip-draft">{t('pr.draft')}</span>}
          <span className="diff">
            <span className="add">+{pr.additions}</span> <span className="del">−{pr.deletions}</span>
          </span>
          {pr.author && <span className="pr-author">@{pr.author.login}</span>}
        </div>
      </div>
      <button
        className="pr-dismiss"
        onClick={dismiss}
        onMouseDown={(e) => e.preventDefault()}
        onKeyDown={(e) => e.stopPropagation()}
        title={t('pr.dismissHint')}
        aria-label={t('pr.dismiss')}
      >
        <XIcon size={12} />
      </button>
    </div>
  )
}

import { useState, type KeyboardEvent, type MouseEvent } from 'react'
import { formatClock, formatDateTime, isTomorrow, timeAgo, weekdayName } from '../../shared/format'
import type { PullRequest } from '../../shared/types'
import { ClockIcon, XIcon } from '../icons'
import { useLocale, useT } from '../i18n'
import { CiIcon } from './CiIcon'

export function PrItem({ pr, snoozeTomorrowAt }: { pr: PullRequest; snoozeTomorrowAt: number }) {
  const t = useT()
  const locale = useLocale()
  const [snoozing, setSnoozing] = useState(false)
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
  const toggleSnooze = (e: MouseEvent) => {
    e.stopPropagation()
    setSnoozing(!snoozing)
  }
  const snooze = (option: 'hour' | 'tomorrow') => (e: MouseEvent) => {
    e.stopPropagation()
    void window.prRadar.snooze(pr.id, option)
  }
  const now = Date.now()
  const tomorrowLabel = isTomorrow(snoozeTomorrowAt, now)
    ? t('pr.snoozeTomorrow', { time: formatClock(snoozeTomorrowAt, locale) })
    : t('pr.snoozeDay', { day: weekdayName(snoozeTomorrowAt, locale), time: formatClock(snoozeTomorrowAt, locale) })
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
          <CiIcon state={pr.ci} />
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
          {pr.newCommitsSinceReview && (
            <span
              className="chip chip-new"
              title={pr.lastReviewAt ? t('pr.newCommitsHint', { date: formatDateTime(pr.lastReviewAt, locale) }) : undefined}
            >
              {t('pr.newCommits')}
            </span>
          )}
          <span className="diff">
            <span className="add">+{pr.additions}</span> <span className="del">−{pr.deletions}</span>
          </span>
          {pr.author && <span className="pr-author">@{pr.author.login}</span>}
        </div>
        {snoozing && (
          <div className="snooze-row" onClick={(e) => e.stopPropagation()}>
            <ClockIcon size={12} />
            <button className="btn btn-small" onMouseDown={(e) => e.preventDefault()} onClick={snooze('hour')}>
              {t('pr.snoozeHour')}
            </button>
            <button className="btn btn-small" onMouseDown={(e) => e.preventDefault()} onClick={snooze('tomorrow')}>
              {tomorrowLabel}
            </button>
          </div>
        )}
      </div>
      <div className={`pr-actions ${snoozing ? 'pr-actions-open' : ''}`} onKeyDown={(e) => e.stopPropagation()}>
        <button
          className="pr-action"
          onClick={toggleSnooze}
          onMouseDown={(e) => e.preventDefault()}
          title={t('pr.snooze')}
          aria-label={t('pr.snooze')}
          aria-expanded={snoozing}
        >
          <ClockIcon size={12} />
        </button>
        <button
          className="pr-action pr-action-dismiss"
          onClick={dismiss}
          onMouseDown={(e) => e.preventDefault()}
          title={t('pr.dismissHint')}
          aria-label={t('pr.dismiss')}
        >
          <XIcon size={12} />
        </button>
      </div>
    </div>
  )
}

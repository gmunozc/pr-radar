import { useCallback, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { formatClock, formatDateTime, isTomorrow, timeAgo, weekdayName } from '../../shared/format'
import { isSharedMenuAction, reviewMenuActions, type ReviewMenuAction } from '../../shared/prActions'
import type { PrAction, PullRequest, SnoozeOption } from '../../shared/types'
import { CheckIcon, CopyIcon, KebabHorizontalIcon, XIcon } from '../icons'
import { useLocale, useT } from '../i18n'
import { sharedMenuItem } from '../rowMenu'
import { ActionMenu, type MenuItem } from './ActionMenu'
import { ChecksRow } from './ChecksRow'
import { CiIcon } from './CiIcon'
import { ConfirmRow } from './ConfirmRow'
import { Labels } from './Labels'

const DAY_MS = 86_400_000
const COPIED_MS = 2000

interface Props {
  pr: PullRequest
  snoozeTomorrowAt: number
  canWrite: boolean
  pending?: PrAction['kind']
  /** Highlight requests older than this many days; 0 disables it. */
  staleDays: number
  /** Opens the detail view (title click, menu); absent inside the detail view itself. */
  onDetail?(prId: string): void
}

export function PrItem({ pr, snoozeTomorrowAt, canWrite, pending, staleDays, onDetail }: Props) {
  const t = useT()
  const locale = useLocale()
  const [menuOpen, setMenuOpen] = useState(false)
  const [approving, setApproving] = useState(false)
  const [checksOpen, setChecksOpen] = useState(false)
  const [comment, setComment] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const kebab = useRef<HTMLButtonElement>(null)
  const closeMenu = useCallback(() => setMenuOpen(false), [])
  const busy = pending !== undefined
  const canApprove = canWrite && !pr.viewerDidAuthor
  // A PR you merely take part in can be dismissed, but a snooze reminder would make no sense.
  const snoozable = pr.source.kind !== 'involved'

  const open = () => void window.prRadar.openExternal(pr.url)
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      open()
    } else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
      e.preventDefault()
      setMenuOpen(true)
    } else if ((e.metaKey || e.ctrlKey) && e.key === 'c' && !window.getSelection()?.toString()) {
      // ⌘C on a focused row copies its link; with text selected, the system copy wins.
      e.preventDefault()
      void copy(pr.url)
    }
  }
  const onContextMenu = (e: MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setMenuOpen(true)
  }
  const toggleMenu = (e: MouseEvent) => {
    e.stopPropagation()
    setMenuOpen((o) => !o)
  }
  const dismiss = () => void window.prRadar.dismiss(pr.id)
  const snooze = (option: SnoozeOption) => void window.prRadar.snooze(pr.id, option)
  const approve = async () => {
    setError(null)
    const result = await window.prRadar.prs.action(pr.id, { kind: 'approve', body: comment.trim() || undefined })
    if (result.ok) {
      setApproving(false)
      setComment('')
    } else {
      setError(t(`action.error.${result.code}`, { detail: result.detail ?? '' }))
    }
  }
  const flashCopied = () => {
    setCopied(true)
    setTimeout(() => setCopied(false), COPIED_MS)
  }
  const copy = async (text: string) => {
    if ((await window.prRadar.copyText(text)).ok) flashCopied()
  }
  const copyLink = async () => {
    if ((await window.prRadar.copyLink({ title: pr.title, url: pr.url })).ok) flashCopied()
  }

  const now = Date.now()
  const tomorrowLabel = isTomorrow(snoozeTomorrowAt, now)
    ? t('pr.snoozeTomorrow', { time: formatClock(snoozeTomorrowAt, locale) })
    : t('pr.snoozeDay', { day: weekdayName(snoozeTomorrowAt, locale), time: formatClock(snoozeTomorrowAt, locale) })
  const ageDays = Math.floor((now - Date.parse(pr.createdAt)) / DAY_MS)
  const stale = staleDays > 0 && ageDays >= staleDays
  const [owner, name] = pr.repo.split('/')

  const menuItem = (id: ReviewMenuAction): MenuItem => {
    if (isSharedMenuAction(id)) {
      return sharedMenuItem(id, {
        pr,
        t,
        copy: (text) => void copy(text),
        copyLink: () => void copyLink(),
        open: (url) => void window.prRadar.openExternal(url),
        onDetail
      })
    }
    switch (id) {
      case 'approve':
        return { id, label: t('action.approve'), disabled: busy, onSelect: () => setApproving(true) }
      case 'snooze_hour':
        return { id, label: t('action.snoozeHour'), onSelect: () => snooze('hour') }
      case 'snooze_tomorrow':
        return { id, label: t('action.snoozeTomorrow', { time: tomorrowLabel }), onSelect: () => snooze('tomorrow') }
      case 'snooze_push':
        return { id, label: t('action.snoozePush'), onSelect: () => snooze('push') }
      case 'dismiss':
        return { id, label: t('action.dismiss'), onSelect: dismiss }
    }
  }
  const items = reviewMenuActions(pr, canWrite)
    .filter((id) => id !== 'details' || onDetail)
    .map(menuItem)
  const showDetail = (e: MouseEvent) => {
    if (!onDetail) return
    e.stopPropagation()
    onDetail(pr.id)
  }
  const actionsOpen = menuOpen || approving || busy

  const sourceChip =
    pr.source.kind === 'direct' ? (
      <span className="chip chip-direct">{t('pr.direct')}</span>
    ) : pr.source.kind === 'team' ? (
      <span className="chip chip-team">{pr.source.slug ? t('pr.teamNamed', { slug: pr.source.slug }) : t('pr.team')}</span>
    ) : (
      <span className="chip chip-draft">{t('pr.involved')}</span>
    )

  // A div rather than a <button>, because it contains buttons of its own.
  return (
    <div
      className="pr"
      role="button"
      tabIndex={0}
      data-pr-id={pr.id}
      onClick={open}
      onKeyDown={onKeyDown}
      onContextMenu={onContextMenu}
      title={pr.url}
    >
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
          <CiIcon state={pr.ci} checks={pr.checks} open={checksOpen} onToggle={() => setChecksOpen((o) => !o)} />
          <span
            className={`pr-age ${stale ? 'pr-age-stale' : ''}`}
            title={stale ? t('pr.stale', { count: ageDays }) : formatDateTime(pr.createdAt, locale)}
          >
            {timeAgo(pr.createdAt, now, locale)}
          </span>
          <div className={`pr-actions ${actionsOpen ? 'pr-actions-open' : ''}`} onKeyDown={(e) => e.stopPropagation()}>
            {copied && <span className="pr-copied">{t('action.copied')}</span>}
            {canApprove && (
              <button
                className="pr-action pr-action-approve"
                onClick={(e) => {
                  e.stopPropagation()
                  setApproving((a) => !a)
                  setError(null)
                }}
                onMouseDown={(e) => e.preventDefault()}
                title={t('action.approve')}
                aria-label={t('action.approve')}
                aria-expanded={approving}
              >
                {busy ? <span className="spinner spinner-sm" /> : <CheckIcon size={12} />}
              </button>
            )}
            <button
              className="pr-action"
              onClick={(e) => {
                e.stopPropagation()
                void copy(pr.url)
              }}
              onMouseDown={(e) => e.preventDefault()}
              title={t('action.copyLink')}
              aria-label={t('action.copyLink')}
            >
              <CopyIcon size={12} />
            </button>
            <button
              className="pr-action pr-action-dismiss"
              onClick={(e) => {
                e.stopPropagation()
                dismiss()
              }}
              onMouseDown={(e) => e.preventDefault()}
              title={t(snoozable ? 'pr.dismissHint' : 'pr.dismissInvolvedHint')}
              aria-label={t('pr.dismiss')}
            >
              <XIcon size={12} />
            </button>
            <button
              ref={kebab}
              className="pr-action pr-action-menu"
              onClick={toggleMenu}
              onMouseDown={(e) => e.preventDefault()}
              title={t('action.menu')}
              aria-label={t('action.menu')}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
            >
              <KebabHorizontalIcon size={12} />
            </button>
          </div>
        </div>
        <div className={`pr-title ${onDetail ? 'pr-title-link' : ''}`} onClick={showDetail} title={onDetail ? t('detail.titleHint') : undefined}>
          {pr.title}
        </div>
        <div className="pr-tags">
          {sourceChip}
          {pr.isDraft && <span className="chip chip-draft">{t('pr.draft')}</span>}
          {pr.newCommitsSinceReview && (
            <span
              className="chip chip-new"
              title={pr.lastReviewAt ? t('pr.newCommitsHint', { date: formatDateTime(pr.lastReviewAt, locale) }) : undefined}
            >
              {t('pr.newCommits')}
            </span>
          )}
          <Labels labels={pr.labels} />
          <span className="diff">
            <span className="add">+{pr.additions}</span> <span className="del">−{pr.deletions}</span>
          </span>
          {pr.author && <span className="pr-author">@{pr.author.login}</span>}
        </div>
        {checksOpen && <ChecksRow checks={pr.checks} total={pr.checksTotal} />}
        {approving && (
          <ConfirmRow
            message={t('action.approveConfirm', { number: pr.number, author: pr.author?.login ?? '' })}
            confirmLabel={t('action.approve')}
            cancelLabel={t('action.cancel')}
            busy={busy}
            error={error}
            onConfirm={() => void approve()}
            onCancel={() => {
              setApproving(false)
              setError(null)
            }}
          >
            <input
              className="input"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder={t('action.approveComment')}
              maxLength={2000}
              spellCheck
            />
          </ConfirmRow>
        )}
        {!approving && error && (
          <div className="confirm-error" role="alert">
            {error}
          </div>
        )}
      </div>
      {menuOpen && <ActionMenu items={items} onClose={closeMenu} label={t('action.menu')} anchor={kebab} />}
    </div>
  )
}

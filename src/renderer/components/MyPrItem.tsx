import { useCallback, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { formatDateTime, timeAgo } from '../../shared/format'
import type { Translate } from '../../shared/i18n'
import type { MessageKey } from '../../shared/i18n/en'
import { myPrMenuActions, type MyPrMenuAction } from '../../shared/prActions'
import type { MergeMethod, MyPullRequest, MyReviewStatus, PrAction } from '../../shared/types'
import { GitMergeIcon, KebabHorizontalIcon, PullRequestIcon } from '../icons'
import { useLocale, useT } from '../i18n'
import { ActionMenu, type MenuItem } from './ActionMenu'
import { CiIcon } from './CiIcon'
import { ConfirmRow } from './ConfirmRow'
import { Labels } from './Labels'
import { Segmented } from './Segmented'

const DAY_MS = 86_400_000

const STATUS: Record<MyReviewStatus, { label: MessageKey; className: string }> = {
  waiting: { label: 'status.waiting', className: 'waiting' },
  approved: { label: 'status.approved', className: 'approved' },
  changes_requested: { label: 'status.changes_requested', className: 'changes' },
  no_reviewers: { label: 'status.no_reviewers', className: 'none' }
}

const BLOCKER_CHIPS: Partial<Record<NonNullable<MyPullRequest['blocker']>, { label: MessageKey; hint: MessageKey }>> = {
  behind: { label: 'blocker.behind', hint: 'blocker.behindHint' },
  blocked: { label: 'blocker.blocked', hint: 'blocker.blockedHint' }
}

const MAX_AVATARS = 4
const COPIED_MS = 2000

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

/** An action that needs a confirmation (and a merge method) before it runs. */
interface Confirming {
  kind: 'merge' | 'enable_auto_merge'
  method: MergeMethod
}

interface Props {
  pr: MyPullRequest
  canWrite: boolean
  pending?: PrAction['kind']
  /** Highlight PRs open for more than this many days; 0 disables it. */
  staleDays: number
}

export function MyPrItem({ pr, canWrite, pending, staleDays }: Props) {
  const t = useT()
  const locale = useLocale()
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirming, setConfirming] = useState<Confirming | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const kebab = useRef<HTMLButtonElement>(null)
  const closeMenu = useCallback(() => setMenuOpen(false), [])
  const busy = pending !== undefined

  const open = () => void window.prRadar.openExternal(pr.url)
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      open()
    } else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
      e.preventDefault()
      setMenuOpen(true)
    }
  }
  const toggleMenu = (e: MouseEvent) => {
    e.stopPropagation()
    setMenuOpen((o) => !o)
  }
  const onContextMenu = (e: MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setMenuOpen(true)
  }
  const run = async (action: PrAction) => {
    setError(null)
    const result = await window.prRadar.prs.action(pr.id, action)
    if (result.ok) setConfirming(null)
    else setError(t(`action.error.${result.code}`, { detail: result.detail ?? '' }))
  }
  const copy = async (text: string) => {
    const { ok } = await window.prRadar.copyText(text)
    if (!ok) return
    setCopied(true)
    setTimeout(() => setCopied(false), COPIED_MS)
  }

  const menuItem = (id: MyPrMenuAction): MenuItem => {
    switch (id) {
      case 'merge':
        return {
          id,
          label: t('action.mergeNow'),
          disabled: busy,
          onSelect: () => setConfirming({ kind: 'merge', method: pr.merge.defaultMethod })
        }
      case 'update_branch':
        return { id, label: t('action.updateBranch'), disabled: busy, onSelect: () => void run({ kind: 'update_branch' }) }
      case 'rerequest_review':
        return { id, label: t('action.rerequest'), disabled: busy, onSelect: () => void run({ kind: 'rerequest_review' }) }
      case 'enable_auto_merge':
        return {
          id,
          label: t('action.enableAutoMerge'),
          disabled: busy,
          onSelect: () => setConfirming({ kind: 'enable_auto_merge', method: pr.merge.defaultMethod })
        }
      case 'disable_auto_merge':
        return { id, label: t('action.disableAutoMerge'), disabled: busy, onSelect: () => void run({ kind: 'disable_auto_merge' }) }
      case 'no_auto_merge':
        return { id, label: t('action.noAutoMerge'), disabled: true, onSelect: () => {} }
      case 'repo_settings':
        return {
          id,
          label: t('action.repoSettings'),
          onSelect: () => void window.prRadar.openExternal(`https://github.com/${pr.repo}/settings`)
        }
      case 'copy_branch':
        return { id, label: t('action.copyBranch'), onSelect: () => void copy(pr.branch) }
      case 'copy_link':
        return { id, label: t('action.copyLink'), onSelect: () => void copy(pr.url) }
      case 'open':
        return { id, label: t('action.open'), onSelect: open }
    }
  }
  const items = myPrMenuActions(pr, canWrite).map(menuItem)
  if (!canWrite) items.unshift({ id: 'read_only', label: t('action.readOnly'), disabled: true, onSelect: () => {} })

  const [owner, name] = pr.repo.split('/')
  const status = pr.readyToMerge ? { label: 'status.ready' as MessageKey, className: 'ready' } : STATUS[pr.status]
  const blockerChip = pr.blocker ? BLOCKER_CHIPS[pr.blocker] : undefined
  const { avatars, teams } = people(pr, t)
  const extra = avatars.length - MAX_AVATARS
  const actionsOpen = menuOpen || confirming !== null || busy
  const now = Date.now()
  const ageDays = Math.floor((now - Date.parse(pr.createdAt)) / DAY_MS)
  const stale = staleDays > 0 && ageDays >= staleDays

  return (
    <div
      className="pr"
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={onKeyDown}
      onContextMenu={onContextMenu}
      title={pr.url}
    >
      <div className={`status-icon status-${status.className}`}>
        {pr.readyToMerge ? <GitMergeIcon size={14} /> : <PullRequestIcon size={14} />}
      </div>
      <div className="pr-body">
        <div className="pr-meta">
          <span className="pr-repo">
            <span className="pr-owner">{owner}/</span>
            {name}
          </span>
          <span className="pr-number">#{pr.number}</span>
          <CiIcon state={pr.ci} />
          <span
            className={`pr-age ${stale ? 'pr-age-stale' : ''}`}
            title={stale ? t('pr.stale', { count: ageDays }) : formatDateTime(pr.createdAt, locale)}
          >
            {timeAgo(pr.createdAt, now, locale)}
          </span>
        </div>
        <div className="pr-title">{pr.title}</div>
        <div className="pr-tags">
          <span className={`chip chip-${status.className}`}>{t(status.label)}</span>
          {pr.autoMerge && (
            <span className="chip chip-automerge" title={t('chip.autoMergeHint')}>
              {t('chip.autoMerge', { method: t(`action.method.${pr.autoMerge.method}`) })}
            </span>
          )}
          {pr.conflicts && (
            <span className="chip chip-conflicts" title={t('blocker.conflictsHint')}>
              {t('blocker.conflicts')}
            </span>
          )}
          {blockerChip && (
            <span className="chip chip-blocked" title={t(blockerChip.hint)}>
              {t(blockerChip.label)}
            </span>
          )}
          {pr.isDraft && <span className="chip chip-draft">{t('pr.draft')}</span>}
          <Labels labels={pr.labels} />
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
        {confirming && (
          <ConfirmRow
            message={
              confirming.kind === 'merge'
                ? t('action.mergeConfirm', { number: pr.number, base: pr.baseBranch || 'base' })
                : t('action.autoMergeConfirm')
            }
            hint={pr.merge.deleteBranchOnMerge ? t('action.deletesBranch') : undefined}
            confirmLabel={confirming.kind === 'merge' ? t('action.mergeNow') : t('action.enableAutoMerge')}
            cancelLabel={t('action.cancel')}
            busy={busy}
            error={error}
            onConfirm={() =>
              void run(
                confirming.kind === 'merge'
                  ? { kind: 'merge', method: confirming.method }
                  : { kind: 'enable_auto_merge', method: confirming.method }
              )
            }
            onCancel={() => {
              setConfirming(null)
              setError(null)
            }}
          >
            {pr.merge.methods.length > 1 && (
              <Segmented
                options={pr.merge.methods.map((m) => ({ value: m, label: t(`action.method.${m}`) }))}
                value={confirming.method}
                onChange={(method) => setConfirming({ kind: confirming.kind, method })}
                label={t('action.method')}
              />
            )}
          </ConfirmRow>
        )}
        {!confirming && error && (
          <div className="confirm-error" role="alert">
            {error}
          </div>
        )}
      </div>
      <div className={`pr-actions ${actionsOpen ? 'pr-actions-open' : ''}`} onKeyDown={(e) => e.stopPropagation()}>
        {copied && <span className="pr-copied">{t('action.copied')}</span>}
        <button
          ref={kebab}
          className="pr-action"
          onClick={toggleMenu}
          onMouseDown={(e) => e.preventDefault()}
          title={t('action.menu')}
          aria-label={t('action.menu')}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
        >
          {busy ? <span className="spinner spinner-sm" /> : <KebabHorizontalIcon size={12} />}
        </button>
      </div>
      {menuOpen && <ActionMenu items={items} onClose={closeMenu} label={t('action.menu')} anchor={kebab} />}
    </div>
  )
}

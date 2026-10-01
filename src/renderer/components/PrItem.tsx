import type { KeyboardEvent, MouseEvent } from 'react'
import type { PullRequest } from '../../shared/types'
import { XIcon } from '../icons'
import { timeAgo } from '../time'

export function PrItem({ pr }: { pr: PullRequest }) {
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
          <span className="pr-age" title={new Date(pr.createdAt).toLocaleString('es')}>
            {timeAgo(pr.createdAt)}
          </span>
        </div>
        <div className="pr-title">{pr.title}</div>
        <div className="pr-tags">
          {pr.source.kind === 'direct' ? (
            <span className="chip chip-direct">Directo</span>
          ) : (
            <span className="chip chip-team">{pr.source.slug ? `Equipo · ${pr.source.slug}` : 'Equipo'}</span>
          )}
          {pr.isDraft && <span className="chip chip-draft">Draft</span>}
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
        title="Descartar (vuelve a aparecer si te piden review de nuevo)"
        aria-label="Descartar"
      >
        <XIcon size={12} />
      </button>
    </div>
  )
}

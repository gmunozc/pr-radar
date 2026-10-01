import type { PullRequest } from '../../shared/types'
import { timeAgo } from '../time'

export function PrItem({ pr }: { pr: PullRequest }) {
  const open = () => void window.prRadar.openExternal(pr.url)
  const [owner, name] = pr.repo.split('/')

  return (
    <button className="pr" onClick={open} title={pr.url}>
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
    </button>
  )
}

import type { MouseEvent } from 'react'
import type { CheckInfo, CiState } from '../../shared/types'
import { CheckIcon, DotFillIcon, XIcon } from '../icons'
import { useT } from '../i18n'

interface Props {
  state: CiState
  /** Individual checks; when given, the icon opens their list and names the failing ones. */
  checks?: CheckInfo[]
  open?: boolean
  onToggle?(): void
}

/** Status of the checks on a PR's head commit; renders nothing when the PR has no checks. */
export function CiIcon({ state, checks = [], open = false, onToggle }: Props) {
  const t = useT()
  if (state === 'none') return null
  const icon =
    state === 'success' ? <CheckIcon size={12} /> : state === 'failure' ? <XIcon size={12} /> : <DotFillIcon size={10} />
  const failing = checks.filter((c) => c.state === 'failure').map((c) => c.name)
  const title = failing.length ? t('checks.failing', { names: failing.join(', ') }) : t(`ci.${state}`)
  if (!onToggle || checks.length === 0) {
    return (
      <span className={`ci ci-${state}`} title={title} aria-label={title}>
        {icon}
      </span>
    )
  }
  const toggle = (e: MouseEvent) => {
    e.stopPropagation()
    onToggle()
  }
  return (
    <button
      className={`ci ci-${state} ci-button`}
      onClick={toggle}
      onMouseDown={(e) => e.preventDefault()}
      title={title}
      aria-label={`${title} · ${t('checks.toggle')}`}
      aria-expanded={open}
    >
      {icon}
    </button>
  )
}

import type { CiState } from '../../shared/types'
import { CheckIcon, DotFillIcon, XIcon } from '../icons'
import { useT } from '../i18n'

/** Status of the checks on a PR's head commit; renders nothing when the PR has no checks. */
export function CiIcon({ state }: { state: CiState }) {
  const t = useT()
  if (state === 'none') return null
  const icon =
    state === 'success' ? <CheckIcon size={12} /> : state === 'failure' ? <XIcon size={12} /> : <DotFillIcon size={10} />
  return (
    <span className={`ci ci-${state}`} title={t(`ci.${state}`)} aria-label={t(`ci.${state}`)}>
      {icon}
    </span>
  )
}

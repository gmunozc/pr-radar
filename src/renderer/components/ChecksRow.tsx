import type { MouseEvent, ReactElement } from 'react'
import type { CheckInfo, CheckState } from '../../shared/types'
import { CheckIcon, DotFillIcon, XIcon } from '../icons'
import { useT } from '../i18n'

const ICONS: Record<CheckState, ReactElement> = {
  failure: <XIcon size={11} />,
  pending: <DotFillIcon size={9} />,
  success: <CheckIcon size={11} />,
  skipped: <DotFillIcon size={9} />
}

/** The checks on a PR's head commit, failing ones first; each opens its details page. */
export function ChecksRow({ checks, total }: { checks: CheckInfo[]; total: number }) {
  const t = useT()
  const rest = total - checks.length
  const stop = (e: MouseEvent) => e.stopPropagation()
  return (
    <div className="checks-row" onClick={stop}>
      {checks.map((check, i) => (
        <button
          key={`${check.name}-${i}`}
          className={`check check-${check.state}`}
          disabled={!check.url}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => check.url && void window.prRadar.openCheck(check.url)}
          title={check.url ?? undefined}
        >
          {ICONS[check.state]}
          <span className="check-name">{check.name}</span>
        </button>
      ))}
      {rest > 0 && <span className="check-more">{t('checks.more', { count: rest })}</span>}
    </div>
  )
}

import type { MessageKey } from '../../shared/i18n/en'
import { useT } from '../i18n'

export type Tab = 'review' | 'mine' | 'involved'

interface Props {
  tab: Tab
  onChange(tab: Tab): void
  /** Tabs to show, in order (the "involved" one can be turned off in Settings). */
  tabs: Tab[]
  counts: Record<Tab, number>
}

const LABELS: Record<Tab, MessageKey> = {
  review: 'tabs.review',
  mine: 'tabs.mine',
  involved: 'tabs.involved'
}

export function Tabs({ tab, onChange, tabs, counts }: Props) {
  const t = useT()
  return (
    <nav className="tabs" role="tablist">
      {tabs.map((id) => (
        <button
          key={id}
          role="tab"
          aria-selected={tab === id}
          className={`tab ${tab === id ? 'tab-active' : ''}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onChange(id)}
        >
          {t(LABELS[id])}
          <span className="tab-count">{counts[id]}</span>
        </button>
      ))}
    </nav>
  )
}

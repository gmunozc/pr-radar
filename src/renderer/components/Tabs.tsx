import type { MessageKey } from '../../shared/i18n/en'
import { useT } from '../i18n'

export type Tab = 'review' | 'mine'

interface Props {
  tab: Tab
  onChange(tab: Tab): void
  reviewCount: number
  mineCount: number
}

const TABS: Array<{ id: Tab; label: MessageKey }> = [
  { id: 'review', label: 'tabs.review' },
  { id: 'mine', label: 'tabs.mine' }
]

export function Tabs({ tab, onChange, reviewCount, mineCount }: Props) {
  const t = useT()
  const counts: Record<Tab, number> = { review: reviewCount, mine: mineCount }
  return (
    <nav className="tabs" role="tablist">
      {TABS.map((item) => (
        <button
          key={item.id}
          role="tab"
          aria-selected={tab === item.id}
          className={`tab ${tab === item.id ? 'tab-active' : ''}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onChange(item.id)}
        >
          {t(item.label)}
          <span className="tab-count">{counts[item.id]}</span>
        </button>
      ))}
    </nav>
  )
}

export type Tab = 'review' | 'mine'

interface Props {
  tab: Tab
  onChange(tab: Tab): void
  reviewCount: number
  mineCount: number
}

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'review', label: 'Por revisar' },
  { id: 'mine', label: 'Mis PRs' }
]

export function Tabs({ tab, onChange, reviewCount, mineCount }: Props) {
  const counts: Record<Tab, number> = { review: reviewCount, mine: mineCount }
  return (
    <nav className="tabs" role="tablist">
      {TABS.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={tab === t.id}
          className={`tab ${tab === t.id ? 'tab-active' : ''}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onChange(t.id)}
        >
          {t.label}
          <span className="tab-count">{counts[t.id]}</span>
        </button>
      ))}
    </nav>
  )
}

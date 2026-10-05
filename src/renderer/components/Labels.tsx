import type { CSSProperties } from 'react'
import type { Label } from '../../shared/types'

const MAX_LABELS = 3

/** A PR's labels in their GitHub colours; the chip mixes the colour with the theme so it reads in light and dark. */
export function Labels({ labels }: { labels: Label[] }) {
  if (labels.length === 0) return null
  const shown = labels.slice(0, MAX_LABELS)
  const rest = labels.slice(MAX_LABELS)
  return (
    <>
      {shown.map((label) => (
        <span
          key={label.name}
          className="chip chip-label"
          style={{ '--label': `#${/^[0-9a-f]{6}$/i.test(label.color) ? label.color : '888888'}` } as CSSProperties}
          title={label.name}
        >
          {label.name}
        </span>
      ))}
      {rest.length > 0 && (
        <span className="chip chip-label" title={rest.map((l) => l.name).join(', ')}>
          +{rest.length}
        </span>
      )}
    </>
  )
}

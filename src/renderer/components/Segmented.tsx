import type { KeyboardEvent } from 'react'

interface Props<T extends string> {
  options: Array<{ value: T; label: string }>
  value: T
  onChange(value: T): void
  /** Accessible name of the group. */
  label: string
}

/** A row of mutually exclusive options (merge method, snooze length…); arrow keys move the choice. */
export function Segmented<T extends string>({ options, value, onChange, label }: Props<T>) {
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const delta = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (delta === 0) return
    e.preventDefault()
    e.stopPropagation()
    const current = Math.max(0, options.findIndex((o) => o.value === value))
    const next = options[(current + delta + options.length) % options.length]
    if (next) onChange(next.value)
  }

  return (
    <div className="segmented" role="radiogroup" aria-label={label} onKeyDown={onKeyDown}>
      {options.map((o) => {
        const on = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            className={`segment ${on ? 'segment-on' : ''}`}
            tabIndex={on ? 0 : -1}
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              e.stopPropagation()
              onChange(o.value)
            }}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

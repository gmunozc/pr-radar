import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react'

export interface MenuItem {
  id: string
  label: string
  onSelect(): void
  disabled?: boolean
  /** Destructive action (shown in the error colour). */
  danger?: boolean
  /** Short text at the right of the label, e.g. a shortcut or a value. */
  hint?: string
}

/**
 * Index of the next enabled item from `current`, moving by `delta` (±1) and wrapping around.
 * `current` may be -1 (before the first) or `enabled.length` (after the last). -1 when nothing is enabled.
 */
export function nextIndex(current: number, delta: number, enabled: readonly boolean[]): number {
  const count = enabled.length
  if (count === 0 || !enabled.some(Boolean)) return -1
  let i = current
  for (let step = 0; step < count; step++) {
    i = (((i + delta) % count) + count) % count
    if (enabled[i]) return i
  }
  return -1
}

interface Props {
  items: MenuItem[]
  onClose(): void
  /** Accessible name of the menu. */
  label: string
  /** Element whose clicks don't close the menu (the button that opened it), so it can toggle. */
  anchor?: RefObject<HTMLElement | null>
}

/**
 * A menu rendered inside a `.pr` row (position: relative), below the hover actions. The panel hides
 * on blur, so this replaces native context menus. Closes on Escape, Tab, a click elsewhere or after
 * selecting an item.
 */
export function ActionMenu({ items, onClose, label, anchor }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const enabled = items.map((item) => !item.disabled)
  const [active, setActive] = useState(() => nextIndex(-1, 1, enabled))
  const [up, setUp] = useState(false)

  // Open upward when the menu would run past the bottom of the list.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const container = el.closest('.list')
    const limit = container ? container.getBoundingClientRect().bottom : window.innerHeight
    if (el.getBoundingClientRect().bottom > limit) setUp(true)
  }, [])

  // Keyboard focus follows the active item (first enabled one on mount).
  useEffect(() => {
    if (active < 0) return
    ref.current?.querySelectorAll<HTMLButtonElement>('.menu-item')[active]?.focus()
  }, [active])

  // A press anywhere else closes the menu; capture phase, so it runs before the target reacts.
  useEffect(() => {
    const onDown = (e: Event) => {
      const target = e.target as Node
      if (ref.current?.contains(target) || anchor?.current?.contains(target)) return
      onClose()
    }
    document.addEventListener('mousedown', onDown, true)
    return () => document.removeEventListener('mousedown', onDown, true)
  }, [onClose, anchor])

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    switch (e.key) {
      case 'ArrowDown':
        setActive((i) => nextIndex(i, 1, enabled))
        break
      case 'ArrowUp':
        setActive((i) => nextIndex(i, -1, enabled))
        break
      case 'Home':
        setActive(nextIndex(-1, 1, enabled))
        break
      case 'End':
        setActive(nextIndex(items.length, -1, enabled))
        break
      case 'Escape':
        e.preventDefault()
        e.stopPropagation()
        onClose()
        return
      case 'Tab':
        onClose()
        return
      case 'Enter':
      case ' ':
        // The button's own click fires; keep the row underneath from opening the PR.
        e.stopPropagation()
        return
      default:
        return
    }
    e.preventDefault()
    e.stopPropagation()
  }

  return (
    <div
      ref={ref}
      className={`menu ${up ? 'menu-up' : ''}`}
      role="menu"
      aria-label={label}
      onKeyDown={onKeyDown}
      onClick={(e) => e.stopPropagation()}
    >
      {items.map((item, i) => (
        <button
          key={item.id}
          type="button"
          role="menuitem"
          className={`menu-item ${i === active ? 'menu-item-active' : ''} ${item.danger ? 'menu-item-danger' : ''}`}
          tabIndex={i === active ? 0 : -1}
          disabled={item.disabled}
          onMouseDown={(e) => e.preventDefault()}
          onMouseEnter={() => !item.disabled && setActive(i)}
          onFocus={() => setActive(i)}
          onClick={(e) => {
            e.stopPropagation()
            item.onSelect()
            onClose()
          }}
        >
          <span className="menu-label">{item.label}</span>
          {item.hint && <span className="menu-hint">{item.hint}</span>}
        </button>
      ))}
    </div>
  )
}

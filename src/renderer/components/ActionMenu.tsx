import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { useT } from '../i18n'

export interface MenuItem {
  id: string
  label: string
  onSelect?(): void
  disabled?: boolean
  /** Destructive action (shown in the error colour). */
  danger?: boolean
  /** Short text at the right of the label, e.g. a shortcut or a value. */
  hint?: string
  /** A submenu: choosing the item shows these in its place, after a "Back" entry. */
  children?: MenuItem[]
}

const BACK = '__back'

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
 * on blur, so this replaces native context menus (and nests submenus in place for the same reason).
 * Closes on Escape, Tab, a click elsewhere or after selecting an item; in a submenu, Escape and
 * ArrowLeft go back.
 */
export function ActionMenu({ items, onClose, label, anchor }: Props) {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  const [parent, setParent] = useState<MenuItem | null>(null)
  const shown: MenuItem[] = parent ? [{ id: BACK, label: `‹ ${t('action.back')}` }, ...(parent.children ?? [])] : items
  const enabled = shown.map((item) => !item.disabled)
  const [active, setActive] = useState(() => nextIndex(-1, 1, enabled))
  const [up, setUp] = useState(false)

  // Open upward when the menu would run past the bottom of the list.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || up) return
    const container = el.closest('.list')
    const limit = container ? container.getBoundingClientRect().bottom : window.innerHeight
    if (el.getBoundingClientRect().bottom > limit) setUp(true)
  }, [parent, up])

  // Keyboard focus follows the active item (first enabled one on mount).
  useEffect(() => {
    if (active < 0) return
    ref.current?.querySelectorAll<HTMLButtonElement>('.menu-item')[active]?.focus()
  }, [active, parent])

  const openSubmenu = (item: MenuItem) => {
    const children = item.children ?? []
    setParent(item)
    // Start on the first entry rather than "Back".
    setActive(nextIndex(0, 1, [false, ...children.map((c) => !c.disabled)]))
  }
  const back = () => {
    if (!parent) return
    setActive(items.indexOf(parent))
    setParent(null)
  }
  const choose = (item: MenuItem) => {
    if (item.id === BACK) return back()
    if (item.children) return openSubmenu(item)
    item.onSelect?.()
    onClose()
  }

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
        setActive(nextIndex(shown.length, -1, enabled))
        break
      case 'ArrowRight': {
        const item = shown[active]
        if (item?.children && !item.disabled) openSubmenu(item)
        break
      }
      case 'ArrowLeft':
        back()
        break
      case 'Escape':
        e.preventDefault()
        e.stopPropagation()
        if (parent) back()
        else onClose()
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
      {shown.map((item, i) => (
        <button
          key={item.id}
          type="button"
          role="menuitem"
          className={`menu-item ${i === active ? 'menu-item-active' : ''} ${item.danger ? 'menu-item-danger' : ''} ${item.id === BACK ? 'menu-item-back' : ''}`}
          tabIndex={i === active ? 0 : -1}
          disabled={item.disabled}
          aria-haspopup={item.children ? 'menu' : undefined}
          onMouseDown={(e) => e.preventDefault()}
          onMouseEnter={() => !item.disabled && setActive(i)}
          onFocus={() => setActive(i)}
          onClick={(e) => {
            e.stopPropagation()
            choose(item)
          }}
        >
          <span className="menu-label">{item.label}</span>
          {(item.hint || item.children) && <span className="menu-hint">{item.children ? '›' : item.hint}</span>}
        </button>
      ))}
    </div>
  )
}

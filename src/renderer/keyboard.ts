/** Keyboard navigation between the PR rows of a list. */
import type { KeyboardEvent } from 'react'

const ROW = '.pr'

/** Moves focus to the next (+1) or previous (-1) row; from outside the rows, to the first or last. */
export function moveFocus(container: HTMLElement, delta: 1 | -1 | 'first' | 'last'): void {
  const rows = Array.from(container.querySelectorAll<HTMLElement>(ROW))
  if (rows.length === 0) return
  const active = document.activeElement
  const index = rows.findIndex((row) => row === active || row.contains(active))
  let next: number
  if (delta === 'first') next = 0
  else if (delta === 'last') next = rows.length - 1
  else if (index === -1) next = delta > 0 ? 0 : rows.length - 1
  else next = Math.min(rows.length - 1, Math.max(0, index + delta))
  rows[next].focus()
}

/** Arrow keys and Home/End on a list; typing in inputs and open menus are left alone. */
export function onListKeyDown(e: KeyboardEvent<HTMLElement>): void {
  const target = e.target as HTMLElement
  if (target.closest('input, select, textarea, [role="menu"], .confirm-row')) return
  const moves: Record<string, 1 | -1 | 'first' | 'last'> = { ArrowDown: 1, ArrowUp: -1, Home: 'first', End: 'last' }
  const move = moves[e.key]
  if (!move) return
  e.preventDefault()
  moveFocus(e.currentTarget, move)
}

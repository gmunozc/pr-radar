import { useEffect, useRef, type KeyboardEvent } from 'react'
import { XIcon } from '../icons'
import { useT } from '../i18n'
import { moveFocus } from '../keyboard'

interface Props {
  value: string
  onChange(value: string): void
  /** Clears the text and hides the row. */
  onClose(): void
  /** Bumped by ⌘F, so the input takes the focus again while the row is already showing. */
  focusToken: number
}

/** The text filter above a list (⌘F): title, repository, number, author or branch. */
export function SearchRow({ value, onChange, onClose, focusToken }: Props) {
  const t = useT()
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [focusToken])
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      // Ours, not the panel's: Escape here only clears the search.
      e.stopPropagation()
      onClose()
    } else if (e.key === 'ArrowDown') {
      const list = document.querySelector<HTMLElement>('.list')
      if (list) {
        e.preventDefault()
        moveFocus(list, 'first')
      }
    }
  }
  return (
    <div className="filters search-row">
      <input
        ref={input}
        className="input"
        type="search"
        value={value}
        placeholder={t('search.placeholder')}
        aria-label={t('search.label')}
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <button className="icon-btn search-close" onClick={onClose} title={t('search.close')} aria-label={t('search.close')}>
        <XIcon size={12} />
      </button>
    </div>
  )
}

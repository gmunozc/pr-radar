import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { CheckIcon, ChevronDownIcon } from '../icons'
import { useT } from '../i18n'

interface Props {
  /** The repositories of the list, with how many PRs each has. */
  options: ReadonlyArray<{ repo: string; count: number }>
  /** Chosen repositories; none means all. */
  selected: readonly string[]
  onChange(repos: string[]): void
}

/**
 * The footer's repository filter: a button with the choice, and a list of the repositories with
 * check marks that opens upwards (the footer sits at the bottom). Several can be chosen; "All"
 * clears. Closes on Escape or a click elsewhere, without closing the panel.
 */
export function RepoFilter({ options, selected, onChange }: Props) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const toggle = (repo: string) => onChange(selected.includes(repo) ? selected.filter((r) => r !== repo) : [...selected, repo])
  const label =
    selected.length === 0 ? t('footer.allRepos') : selected.length === 1 ? selected[0] : t('footer.repos', { count: selected.length })
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && open) {
      e.stopPropagation()
      setOpen(false)
    }
  }

  return (
    <div className="repo-filter" ref={ref} onKeyDown={onKeyDown}>
      <button
        className="repo-filter-btn"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={t('footer.reposLabel')}
      >
        <span className="repo-filter-label">{label}</span>
        <ChevronDownIcon size={12} />
      </button>
      {open && (
        <div className="menu repo-menu" role="listbox" aria-multiselectable="true" aria-label={t('footer.reposLabel')}>
          <button
            className="menu-item repo-option"
            role="option"
            aria-selected={selected.length === 0}
            onClick={() => {
              onChange([])
              setOpen(false)
            }}
          >
            <span className="repo-option-check">{selected.length === 0 && <CheckIcon size={12} />}</span>
            <span className="repo-option-name">{t('footer.allRepos')}</span>
          </button>
          {options.map(({ repo, count }) => {
            const on = selected.includes(repo)
            return (
              <button key={repo} className="menu-item repo-option" role="option" aria-selected={on} onClick={() => toggle(repo)}>
                <span className="repo-option-check">{on && <CheckIcon size={12} />}</span>
                <span className="repo-option-name">{repo}</span>
                <span className="repo-option-count">{count}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

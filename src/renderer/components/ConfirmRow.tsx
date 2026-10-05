import type { KeyboardEvent, ReactNode } from 'react'

interface Props {
  message: string
  hint?: string
  confirmLabel: string
  cancelLabel: string
  /** Destructive confirmation (red button). */
  danger?: boolean
  /** The action is running: spinner, both buttons disabled. */
  busy?: boolean
  error?: string | null
  /** Confirming isn't possible yet (e.g. nothing selected). */
  disabled?: boolean
  onConfirm(): void
  onCancel(): void
  /** Extra controls between the message and the buttons: a Segmented picker, an input… */
  children?: ReactNode
}

const keepFocus = (e: { preventDefault(): void }) => e.preventDefault()

/**
 * An inline confirmation under a PR, in place of a native dialog (the panel hides when it loses
 * focus). Escape cancels; Enter in an input confirms.
 */
export function ConfirmRow({
  message,
  hint,
  confirmLabel,
  cancelLabel,
  danger,
  busy,
  error,
  disabled,
  onConfirm,
  onCancel,
  children
}: Props) {
  const canConfirm = !busy && !disabled
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      if (!busy) onCancel()
      return
    }
    if (e.key !== 'Enter' && e.key !== ' ') return
    // Keep the row underneath from opening the PR; buttons still get their own click.
    e.stopPropagation()
    if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT' && canConfirm) {
      e.preventDefault()
      onConfirm()
    }
  }

  return (
    <div className="confirm-row" onClick={(e) => e.stopPropagation()} onKeyDown={onKeyDown}>
      <div className="confirm-message">{message}</div>
      {hint && <div className="confirm-hint">{hint}</div>}
      {children}
      <div className="confirm-actions">
        <button
          type="button"
          className={`btn btn-small ${danger ? 'btn-danger' : 'btn-primary'}`}
          disabled={!canConfirm}
          onMouseDown={keepFocus}
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
        <button type="button" className="btn btn-small" disabled={busy} onMouseDown={keepFocus} onClick={onCancel}>
          {cancelLabel}
        </button>
        {busy && <div className="spinner spinner-sm" />}
      </div>
      {error && (
        <div className="confirm-error" role="alert">
          {error}
        </div>
      )}
    </div>
  )
}

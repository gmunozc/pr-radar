/** Scrolls to, focuses and briefly highlights a row, e.g. the PR a notification was about. */
import { useEffect, type RefObject } from 'react'

const FLASH_MS = 1500

export function useFocusRow(list: RefObject<HTMLElement | null>, prId: string | null | undefined, onDone?: () => void): void {
  useEffect(() => {
    if (!prId) return
    // The list may have just been mounted for this: wait for a frame so the rows exist.
    const frame = requestAnimationFrame(() => {
      const row = list.current?.querySelector<HTMLElement>(`[data-pr-id="${CSS.escape(prId)}"]`)
      if (row) {
        row.scrollIntoView({ block: 'center' })
        row.focus({ preventScroll: true })
        row.classList.add('pr-flash')
        setTimeout(() => row.classList.remove('pr-flash'), FLASH_MS)
      }
      onDone?.()
    })
    return () => cancelAnimationFrame(frame)
  }, [list, prId, onDone])
}

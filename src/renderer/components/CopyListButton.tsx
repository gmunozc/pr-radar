import { useEffect, useRef, useState } from 'react'
import type { MyPullRequest, PullRequest } from '../../shared/types'
import { useLocale, useT } from '../i18n'
import { listMarkdown } from '../listMarkdown'

const COPIED_MS = 2000

/** "Copy list": the PRs shown (after filters, search and sort) as Markdown bullets. */
export function CopyListButton({ prs }: { prs: ReadonlyArray<PullRequest | MyPullRequest> }) {
  const t = useT()
  const locale = useLocale()
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const copy = async () => {
    const { ok } = await window.prRadar.copyText(listMarkdown(prs, t, locale, Date.now()))
    if (!ok) return
    setCopied(true)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied(false), COPIED_MS)
  }
  return (
    <button className="link" onClick={() => void copy()} disabled={prs.length === 0}>
      {copied ? t('action.copied') : t('list.copy')}
    </button>
  )
}

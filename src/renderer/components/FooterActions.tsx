import { useEffect, useRef, useState } from 'react'
import { linksText } from '../arrange'
import { CheckIcon, CopyIcon, MarkGithubIcon } from '../icons'
import { useT } from '../i18n'

const COPIED_MS = 2000

interface Props {
  /** The PRs shown (after filters, search and sort): their links are what gets copied. */
  prs: ReadonlyArray<{ url: string }>
  /** The list's page on GitHub. */
  githubUrl: string
  githubLabel: string
}

/** The footer's right side: open the list on GitHub, or copy the links of the PRs shown, one per line. */
export function FooterActions({ prs, githubUrl, githubLabel }: Props) {
  const t = useT()
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const copy = async () => {
    const { ok } = await window.prRadar.copyText(linksText(prs))
    if (!ok) return
    setCopied(true)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied(false), COPIED_MS)
  }
  const copyLabel = copied ? t('footer.linksCopied') : t('footer.copyLinks', { count: prs.length })
  return (
    <div className="footer-actions">
      <button className="icon-btn" onClick={() => void window.prRadar.openExternal(githubUrl)} title={githubLabel} aria-label={githubLabel}>
        <MarkGithubIcon size={16} />
      </button>
      <button className="icon-btn" onClick={() => void copy()} disabled={prs.length === 0} title={copyLabel} aria-label={copyLabel}>
        {copied ? <CheckIcon size={16} /> : <CopyIcon size={16} />}
      </button>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { launchersFor, type LauncherEntry, type LaunchersView } from '../shared/launchers'
import type { MyPullRequest, PullRequest } from '../shared/types'
import type { MenuItem } from './components/ActionMenu'
import { useT } from './i18n'

// One copy for the whole panel: every PR row reads it, so it isn't fetched once per row.
let current: LaunchersView | null = null
let subscribed = false
const listeners = new Set<(view: LaunchersView) => void>()

/** Shares a new configuration with every row (also used after saving from Settings). */
export function publishLaunchers(view: LaunchersView): void {
  current = view
  for (const cb of listeners) cb(view)
}

/** Re-reads launchers.json (Settings does it when shown). */
export function reloadLaunchers(): void {
  void window.prRadar.launchers.get().then(publishLaunchers)
}

/** The "Send to…" setup, kept in sync with launchers.json. */
export function useLaunchers(): LaunchersView | null {
  const [info, setInfo] = useState(current)
  useEffect(() => {
    listeners.add(setInfo)
    if (!subscribed) {
      subscribed = true
      window.prRadar.launchers.onChange(publishLaunchers)
      reloadLaunchers()
    }
    return () => {
      listeners.delete(setInfo)
    }
  }, [])
  return info
}

export interface SendTo {
  /** The "Send to…" menu entry, or null when no action applies to this PR. */
  item: MenuItem | null
  /** Label of the action being prepared (fetch, worktree), if any. */
  launching: string | null
  error: string | null
}

/** The "Send to…" submenu for a PR, and the state of a launch from it. */
export function useSendTo(pr: PullRequest | MyPullRequest): SendTo {
  const t = useT()
  const info = useLaunchers()
  const [launching, setLaunching] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const launch = async (entry: LauncherEntry) => {
    setError(null)
    setLaunching(entry.label)
    try {
      const result = await window.prRadar.launchers.launch(pr.id, entry.id)
      if (!result.ok) setError(t(`launch.error.${result.code}`, { repo: pr.repo }))
    } finally {
      setLaunching(null)
    }
  }
  const entries = info ? launchersFor(pr, info.entries) : []
  const item: MenuItem | null =
    entries.length === 0
      ? null
      : {
          id: 'send_to',
          label: t('action.sendTo'),
          disabled: launching !== null,
          children: entries.map((entry) => ({ id: `send_to:${entry.id}`, label: entry.label, onSelect: () => void launch(entry) }))
        }
  return { item, launching, error }
}

/** Puts "Send to…" before the copy and open entries, after the ones that act on the PR. */
export function withSendTo(items: MenuItem[], sendTo: MenuItem | null): MenuItem[] {
  if (!sendTo) return items
  const at = items.findIndex((i) => i.id === 'copy_branch' || i.id === 'copy_link')
  return at < 0 ? [...items, sendTo] : [...items.slice(0, at), sendTo, ...items.slice(at)]
}

/**
 * "Send to…": actions from launchers.json that open a terminal tab with an agent on a PR.
 * The panel only sees ids and labels; commands and paths stay in the main process.
 */
import type { MyPullRequest, PullRequest } from './types'

/** Which list a PR comes from, as an action's `showOn` names it. */
export type LaunchTarget = 'mine' | 'review' | 'involved'

export type LauncherShowOn = LaunchTarget | 'all'

/** An entry of the "Send to…" submenu. */
export interface LauncherEntry {
  id: string
  label: string
  showOn: LauncherShowOn
}

export type LauncherConfigErrorCode =
  | 'invalid_json'
  | 'not_object'
  | 'invalid_terminal'
  | 'invalid_agent'
  | 'invalid_path'
  | 'invalid_repo'
  | 'invalid_action'
  | 'duplicate_action'
  | 'unknown_agent'
  | 'unknown_placeholder'
  | 'missing_placeholder'
  | 'too_many_actions'

/** A problem in launchers.json; `at` says where (e.g. "actions[1].prompt"), `detail` what. */
export interface LauncherConfigError {
  code: LauncherConfigErrorCode
  at: string
  detail?: string
}

export interface LaunchersInfo {
  /** Where launchers.json lives. */
  path: string
  exists: boolean
  /** Valid actions; invalid ones are left out and reported in `errors`. */
  actions: LauncherEntry[]
  errors: LauncherConfigError[]
  worktreesDir: string
}

export type LaunchErrorCode =
  | 'not_configured'
  | 'unknown_action'
  | 'pr_not_found'
  | 'repo_not_mapped'
  | 'repo_not_found'
  | 'fetch_failed'
  | 'commit_not_found'
  | 'git_failed'
  | 'terminal_failed'
  | 'busy'

export type LaunchResult = { ok: true } | { ok: false; code: LaunchErrorCode }

export function launchTargetOf(pr: PullRequest | MyPullRequest): LaunchTarget {
  if ('reviews' in pr) return 'mine'
  return pr.source.kind === 'involved' ? 'involved' : 'review'
}

/** The actions offered on this PR, in the file's order. */
export function launchersFor(pr: PullRequest | MyPullRequest, actions: readonly LauncherEntry[]): LauncherEntry[] {
  const target = launchTargetOf(pr)
  return actions.filter((a) => a.showOn === 'all' || a.showOn === target)
}

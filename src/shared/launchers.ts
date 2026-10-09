/**
 * "Send to…": actions that open a terminal tab with Claude Code on a PR. They are set up in
 * Settings and stored in launchers.json; the PR menu only sees ids, labels and repositories.
 */
import type { MyPullRequest, PullRequest } from './types'

/** Which list a PR comes from, as an action's `showOn` names it. */
export type LaunchTarget = 'mine' | 'review' | 'involved'

export type LauncherShowOn = LaunchTarget | 'all'

export type LauncherTerminal = 'warp' | 'warp-preview'

export const LAUNCHER_TERMINALS: readonly LauncherTerminal[] = ['warp', 'warp-preview']
export const LAUNCHER_SHOW_ON: readonly LauncherShowOn[] = ['mine', 'review', 'involved', 'all']

/** A local folder (usually a repository, maybe with submodules) where the agent starts. */
export interface LauncherProject {
  id: string
  name: string
  /** The repository root; the agent starts here, so its CLAUDE.md and skills load. */
  path: string
  /** GitHub "owner/name" → its local clone: the root and its checked-out submodules. */
  repos: Record<string, string>
}

/** What the agent is asked: a skill (`/name <PR url>`) or a prompt written by hand. */
export type LauncherRun = { kind: 'skill'; skill: string; scope: SkillScope } | { kind: 'prompt'; text: string }

export interface LauncherAction {
  id: string
  label: string
  projectId: string
  showOn: LauncherShowOn
  run: LauncherRun
  /** Optional text added after the skill and the PR link. */
  extra: string
  /** `worktree`: a git worktree at the PR's latest commit; `folder`: the project as it is. */
  workspace: 'worktree' | 'folder'
}

export interface LaunchersConfig {
  version: 2
  terminal: LauncherTerminal
  projects: LauncherProject[]
  actions: LauncherAction[]
}

export const EMPTY_LAUNCHERS: LaunchersConfig = { version: 2, terminal: 'warp', projects: [], actions: [] }

/** An entry of the "Send to…" submenu: shown on PRs of `repos` ("owner/name", lower case). */
export interface LauncherEntry {
  id: string
  label: string
  showOn: LauncherShowOn
  repos: string[]
}

export type LauncherConfigErrorCode =
  | 'invalid_json'
  | 'not_object'
  | 'old_format'
  | 'invalid_terminal'
  | 'invalid_project'
  | 'duplicate_project'
  | 'invalid_path'
  | 'invalid_repo'
  | 'invalid_action'
  | 'duplicate_action'
  | 'unknown_project'
  | 'invalid_skill'
  | 'unknown_placeholder'
  | 'too_many'

/** A problem in launchers.json; `at` says where (e.g. "actions[1].run"), `detail` what. */
export interface LauncherConfigError {
  code: LauncherConfigErrorCode
  at: string
  detail?: string
}

/** Everything the Settings screen needs. */
export interface LaunchersView {
  path: string
  exists: boolean
  config: LaunchersConfig
  entries: LauncherEntry[]
  errors: LauncherConfigError[]
  worktreesDir: string
}

export type SkillScope = 'project' | 'user'

export interface SkillInfo {
  name: string
  description: string
  scope: SkillScope
}

export type SaveLaunchersResult = { ok: true; view: LaunchersView } | { ok: false; errors: LauncherConfigError[] }

export type ProjectErrorCode = 'cancelled' | 'not_git' | 'no_github' | 'not_found' | 'unknown'

export type ProjectResult = { ok: true; view: LaunchersView; projectId: string } | { ok: false; code: ProjectErrorCode }

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
  | 'unknown'

export type LaunchResult = { ok: true } | { ok: false; code: LaunchErrorCode }

/** Placeholders a hand-written prompt may use; PR values are validated before they fill it. */
export const PROMPT_PLACEHOLDERS = ['url', 'number', 'repo', 'sha'] as const

export function launchTargetOf(pr: PullRequest | MyPullRequest): LaunchTarget {
  if ('reviews' in pr) return 'mine'
  return pr.source.kind === 'involved' ? 'involved' : 'review'
}

/** The actions offered on this PR: its list and its repository must match. */
export function launchersFor(pr: PullRequest | MyPullRequest, entries: readonly LauncherEntry[]): LauncherEntry[] {
  const target = launchTargetOf(pr)
  const repo = pr.repo.toLowerCase()
  return entries.filter((e) => (e.showOn === 'all' || e.showOn === target) && e.repos.includes(repo))
}

/** The local clone of `repo` ("owner/name", any case) in a project, if it has one. */
export function projectRepoPath(project: LauncherProject, repo: string): string | null {
  const wanted = repo.toLowerCase()
  const key = Object.keys(project.repos).find((r) => r.toLowerCase() === wanted)
  return key ? project.repos[key] : null
}

/** What the action runs, as the list shows it: "/triage-review" or the prompt's start. */
export function runSummary(run: LauncherRun): string {
  if (run.kind === 'skill') return `/${run.skill}`
  return run.text.length > 40 ? `${run.text.slice(0, 39)}…` : run.text
}

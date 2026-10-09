/**
 * "Send to…": prepares a workspace for a PR (a git worktree at its head commit, or the project
 * as it is) and opens a Warp tab in the project's root running Claude Code on it.
 *
 * Only validated PR values (URL, number, owner/name, hex SHA) ever reach a command line, and
 * each one shell-quoted: branch names and titles are chosen by the PR's author and are never used.
 * The command itself is fixed (`claude`); settings only choose the prompt. Git runs without a
 * shell; the agent runs in the user's own shell inside the terminal.
 */
import { dirname, join } from 'node:path'
import {
  projectRepoPath,
  type LauncherAction,
  type LauncherProject,
  type LaunchersConfig,
  type LauncherTerminal,
  type LaunchErrorCode,
  type LaunchResult
} from '../shared/launchers'
import type { Logger } from './log'
import { REPO } from './settings'

/** The PR fields a launch needs; the main process takes them from its own state, never from the panel. */
export interface LaunchPr {
  repo: string
  number: number
  url: string
  headOid: string
}

export type LaunchValues = Record<'url' | 'number' | 'repo' | 'sha', string>

export const GIT_TIMEOUT_MS = 30_000
export const FETCH_TIMEOUT_MS = 120_000
/** Warp reads a tab config when it opens it; ours are removed once they're this old. */
export const TAB_CONFIG_TTL_MS = 10 * 60_000

const PR_URL = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/
const SHA = /^[0-9a-f]{40}$/
const TAB_CONFIG = /^pr_radar_(\d+)_\d+\.toml$/

/** The values prompts may use, or null when any of them doesn't look like GitHub's. */
export function launchValues(pr: LaunchPr): LaunchValues | null {
  if (!REPO.test(pr.repo) || !SHA.test(pr.headOid) || !PR_URL.test(pr.url)) return null
  if (!Number.isSafeInteger(pr.number) || pr.number <= 0) return null
  return { url: pr.url, number: String(pr.number), repo: pr.repo, sha: pr.headOid }
}

/** One argument for a POSIX shell (also fine in zsh and fish): single-quoted. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/** A TOML basic string. */
export function tomlString(value: string): string {
  const escaped = value.replace(/[\\"\u0000-\u001f\u007f]/g, (c) => {
    if (c === '\\') return '\\\\'
    if (c === '"') return '\\"'
    if (c === '\n') return '\\n'
    if (c === '\t') return '\\t'
    if (c === '\r') return '\\r'
    return `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`
  })
  return `"${escaped}"`
}

/** Replaces {name} with values[name]; other braces stay as written. */
export function fillTemplate(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (Object.hasOwn(values, name) ? values[name] : match))
}

export function worktreePath(worktreesDir: string, values: LaunchValues): string {
  return join(worktreesDir, values.repo.replace('/', '__'), `pr-${values.number}-${values.sha.slice(0, 7)}`)
}

/**
 * What Claude is asked: `/skill <url>` or the hand-written prompt, then the extra text, then
 * where the PR's code is when it has a worktree (the agent starts in the project root).
 */
export function promptFor(action: LauncherAction, values: LaunchValues, worktree: string | null): string {
  const base = action.run.kind === 'skill' ? `/${action.run.skill} ${values.url}` : fillTemplate(action.run.text, values)
  const extra = action.extra ? ` ${action.extra}` : ''
  const where = worktree ? ` (PR code at commit ${values.sha.slice(0, 7)}: ${worktree})` : ''
  return `${base}${extra}${where}`
}

/** The command typed in the terminal. */
export function agentCommand(prompt: string, worktree: string | null): string {
  return worktree ? `claude --add-dir ${shellQuote(worktree)} ${shellQuote(prompt)}` : `claude ${shellQuote(prompt)}`
}

export function warpTabConfig(title: string, dir: string, command: string): string {
  return [
    '# Written by PR Radar for one "Send to" launch; removed after a few minutes.',
    `name = ${tomlString(title)}`,
    '',
    '[[panes]]',
    'id = "main"',
    'type = "terminal"',
    `directory = ${tomlString(dir)}`,
    `commands = [${tomlString(command)}]`,
    ''
  ].join('\n')
}

export class LaunchError extends Error {
  constructor(
    readonly code: LaunchErrorCode,
    detail?: string
  ) {
    super(detail ?? code)
  }
}

export interface LauncherDeps {
  config(): LaunchersConfig
  findPr(prId: string): LaunchPr | null
  /** Detects the project's repositories again (a submodule checked out later) and saves them. */
  redetect(projectId: string): Promise<LauncherProject | null>
  /** Runs a program without a shell; resolves with its stdout, rejects when it fails or times out. */
  run(file: string, args: string[], options: { cwd: string; timeoutMs: number }): Promise<string>
  isDir(path: string): boolean
  mkdir(path: string): void
  writeFile(path: string, text: string): void
  listDir(path: string): string[]
  removeFile(path: string): void
  openUrl(url: string): Promise<void>
  worktreesDir: string
  home: string
  now(): number
  log: Logger
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err))

export class Launcher {
  private readonly pending = new Set<string>()
  private runs = 0

  constructor(private readonly deps: LauncherDeps) {}

  async launch(prId: string, actionId: string): Promise<LaunchResult> {
    const config = this.deps.config()
    if (config.actions.length === 0) return { ok: false, code: 'not_configured' }
    const action = config.actions.find((a) => a.id === actionId)
    const project = action && config.projects.find((p) => p.id === action.projectId)
    if (!action || !project) return { ok: false, code: 'unknown_action' }
    const pr = this.deps.findPr(prId)
    const values = pr && launchValues(pr)
    if (!values) return { ok: false, code: 'pr_not_found' }
    if (this.pending.has(prId)) return { ok: false, code: 'busy' }

    this.pending.add(prId)
    const context = { action: action.id, repo: values.repo, number: values.number }
    try {
      const repoPath = await this.repoPath(project, values.repo)
      const worktree = action.workspace === 'worktree' ? await this.worktree(repoPath, values) : null
      if (!worktree && !this.deps.isDir(project.path)) throw new LaunchError('repo_not_found', 'the project folder does not exist')
      const command = agentCommand(promptFor(action, values, worktree), worktree)
      await this.openTerminal(config.terminal, project.path, command, `${values.repo}#${values.number} · ${action.label}`)
      this.deps.log.info('launched an agent', { ...context, workspace: action.workspace, terminal: config.terminal })
      return { ok: true }
    } catch (err) {
      const code = err instanceof LaunchError ? err.code : 'unknown'
      this.deps.log.warn('could not launch an agent', { ...context, code, detail: message(err) })
      return { ok: false, code }
    } finally {
      this.pending.delete(prId)
    }
  }

  /** Removes our Warp tab configs that are old enough to have been read. */
  cleanTabConfigs(): void {
    for (const folder of ['.warp', '.warp-preview']) this.cleanFolder(join(this.deps.home, folder, 'tab_configs'))
  }

  /** The PR repository's clone in the project, detecting the project again once if it's missing. */
  private async repoPath(project: LauncherProject, repo: string): Promise<string> {
    let path = projectRepoPath(project, repo)
    if (!path) {
      const fresh = await this.deps.redetect(project.id)
      path = fresh && projectRepoPath(fresh, repo)
    }
    if (!path) throw new LaunchError('repo_not_mapped')
    if (!this.deps.isDir(path)) throw new LaunchError('repo_not_found', 'the local clone does not exist')
    return path
  }

  private async worktree(repoPath: string, values: LaunchValues): Promise<string> {
    const git = (args: string[], cwd = repoPath, timeoutMs = GIT_TIMEOUT_MS) => this.deps.run('git', args, { cwd, timeoutMs })
    const dir = worktreePath(this.deps.worktreesDir, values)
    if (this.deps.isDir(dir)) {
      const head = await git(['rev-parse', 'HEAD'], dir).catch(() => '')
      if (head.trim() === values.sha) return dir
      throw new LaunchError('git_failed', 'the worktree folder exists but is not at the PR head')
    }
    await git(['rev-parse', '--git-dir']).catch((err) => {
      throw new LaunchError('repo_not_found', message(err))
    })
    const hasCommit = () =>
      git(['cat-file', '-e', `${values.sha}^{commit}`]).then(
        () => true,
        () => false
      )
    if (!(await hasCommit())) {
      // pull/<n>/head also carries PRs from forks.
      await git(['fetch', '--no-tags', 'origin', `pull/${values.number}/head`], repoPath, FETCH_TIMEOUT_MS).catch((err) => {
        throw new LaunchError('fetch_failed', message(err))
      })
      if (!(await hasCommit())) throw new LaunchError('commit_not_found')
    }
    this.deps.mkdir(dirname(dir))
    // A worktree folder deleted by hand stays registered and would block `add`.
    await git(['worktree', 'prune']).catch(() => '')
    await git(['worktree', 'add', '--detach', dir, values.sha]).catch((err) => {
      throw new LaunchError('git_failed', message(err))
    })
    return dir
  }

  private async openTerminal(terminal: LauncherTerminal, dir: string, command: string, title: string): Promise<void> {
    // Warp can't take a command in a URL; it opens a tab config (a TOML file) by name instead.
    const preview = terminal === 'warp-preview'
    const folder = join(this.deps.home, preview ? '.warp-preview' : '.warp', 'tab_configs')
    this.cleanFolder(folder)
    const name = `pr_radar_${this.deps.now()}_${++this.runs}`
    try {
      this.deps.mkdir(folder)
      this.deps.writeFile(join(folder, `${name}.toml`), warpTabConfig(title, dir, command))
      await this.deps.openUrl(`${preview ? 'warppreview' : 'warp'}://tab_config/${name}`)
    } catch (err) {
      throw new LaunchError('terminal_failed', message(err))
    }
  }

  private cleanFolder(folder: string): void {
    let names: string[]
    try {
      names = this.deps.listDir(folder)
    } catch {
      return
    }
    const cutoff = this.deps.now() - TAB_CONFIG_TTL_MS
    for (const name of names) {
      const written = TAB_CONFIG.exec(name)
      if (!written || Number(written[1]) > cutoff) continue
      try {
        this.deps.removeFile(join(folder, name))
      } catch (err) {
        this.deps.log.warn('could not remove an old Warp tab config', { name, detail: message(err) })
      }
    }
  }
}

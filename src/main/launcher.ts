/**
 * "Send to…": prepares a workspace for a PR (a git worktree at its head commit, or the local
 * clone as it is) and opens a terminal tab there running the action's agent command.
 *
 * Only validated PR values (URL, number, owner/name, hex SHA) ever reach a command line, and
 * each one shell-quoted: branch names and titles are chosen by the PR's author and are never used.
 * Git runs without a shell; the agent command runs in the user's own shell inside the terminal.
 */
import { dirname, join } from 'node:path'
import type { LaunchErrorCode, LaunchResult } from '../shared/launchers'
import type { ActionConfig, LauncherConfig, RepoConfig, TerminalConfig } from './launcherConfig'
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

/** The values templates may use, or null when any of them doesn't look like GitHub's. */
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

/** The command typed in the terminal: the agent, with the prompt and workspace quoted. */
export function agentCommand(agent: string, action: ActionConfig, values: LaunchValues, workspace: string): string {
  return fillTemplate(agent, { prompt: shellQuote(fillTemplate(action.prompt, values)), workspace: shellQuote(workspace) })
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
  config(): LauncherConfig | null
  findPr(prId: string): LaunchPr | null
  /** Runs a program without a shell; resolves with its stdout, rejects when it fails or times out. */
  run(file: string, args: string[], options: { cwd: string; timeoutMs: number }): Promise<string>
  /** Starts a program that keeps running on its own (a terminal); rejects only if it can't start. */
  spawnDetached(file: string, args: string[]): Promise<void>
  isDir(path: string): boolean
  mkdir(path: string): void
  writeFile(path: string, text: string): void
  listDir(path: string): string[]
  removeFile(path: string): void
  openUrl(url: string): Promise<void>
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
    if (!config) return { ok: false, code: 'not_configured' }
    const action = config.actions.find((a) => a.id === actionId)
    if (!action) return { ok: false, code: 'unknown_action' }
    const pr = this.deps.findPr(prId)
    const values = pr && launchValues(pr)
    if (!values) return { ok: false, code: 'pr_not_found' }
    const repo = config.repos[values.repo.toLowerCase()]
    if (!repo) return { ok: false, code: 'repo_not_mapped' }
    if (this.pending.has(prId)) return { ok: false, code: 'busy' }

    this.pending.add(prId)
    const context = { action: action.id, repo: values.repo, number: values.number }
    try {
      const workspace = await this.workspace(action, repo, values, config.worktreesDir)
      const command = agentCommand(config.agents[action.agent], action, values, workspace)
      await this.openTerminal(config.terminal, repo.agentDir ?? workspace, command, `${values.repo}#${values.number} · ${action.label}`)
      this.deps.log.info('launched an agent', { ...context, workspace: action.workspace, terminal: config.terminal.kind })
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

  private async workspace(action: ActionConfig, repo: RepoConfig, values: LaunchValues, worktreesDir: string): Promise<string> {
    if (!this.deps.isDir(repo.path)) throw new LaunchError('repo_not_found', 'the local clone does not exist')
    if (action.workspace === 'folder') return repo.path

    const git = (args: string[], cwd = repo.path, timeoutMs = GIT_TIMEOUT_MS) => this.deps.run('git', args, { cwd, timeoutMs })
    const dir = worktreePath(worktreesDir, values)
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
      await git(['fetch', '--no-tags', repo.remote, `pull/${values.number}/head`], repo.path, FETCH_TIMEOUT_MS).catch((err) => {
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

  private async openTerminal(terminal: TerminalConfig, dir: string, command: string, title: string): Promise<void> {
    if (terminal.kind === 'custom') {
      const line = fillTemplate(terminal.command, {
        command: shellQuote(`cd ${shellQuote(dir)} && ${command}`),
        dir: shellQuote(dir)
      })
      await this.deps.spawnDetached('/bin/sh', ['-c', line]).catch((err) => {
        throw new LaunchError('terminal_failed', message(err))
      })
      return
    }
    // Warp can't take a command in a URL; it opens a tab config (a TOML file) by name instead.
    const preview = terminal.kind === 'warp-preview'
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

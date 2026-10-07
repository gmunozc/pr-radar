/**
 * Reads launchers.json. Pure: the caller passes the file's text (null when missing) and the
 * home folder. Invalid entries are dropped and reported, so one typo doesn't disable the rest.
 */
import { isAbsolute, join } from 'node:path'
import type { LauncherConfigError, LauncherShowOn } from '../shared/launchers'
import { REPO } from './settings'

export type TerminalConfig = { kind: 'warp' } | { kind: 'warp-preview' } | { kind: 'custom'; command: string }

export interface RepoConfig {
  /** The repository's local clone, where worktrees are added from. */
  path: string
  /** Where the agent starts instead of the workspace (e.g. a monorepo root holding CLAUDE.md). */
  agentDir: string | null
  remote: string
}

export interface ActionConfig {
  id: string
  label: string
  showOn: LauncherShowOn
  agent: string
  prompt: string
  workspace: 'worktree' | 'folder'
}

export interface LauncherConfig {
  terminal: TerminalConfig
  /** Agent name → command template ({prompt}, {workspace}). */
  agents: Record<string, string>
  worktreesDir: string
  /** "owner/name" → local clone. */
  repos: Record<string, RepoConfig>
  actions: ActionConfig[]
}

export const LAUNCHERS_FILE = 'launchers.json'
export const DEFAULT_WORKTREES_DIR = '~/.pr-radar/worktrees'
export const MAX_ACTIONS = 20

/** Placeholders each template may use. PR values are validated before they fill a template. */
export const PROMPT_PLACEHOLDERS = ['url', 'number', 'repo', 'sha'] as const
export const AGENT_PLACEHOLDERS = ['prompt', 'workspace'] as const
export const TERMINAL_PLACEHOLDERS = ['command', 'dir'] as const

const ACTION_ID = /^[\w-]{1,40}$/
const AGENT_NAME = /^[\w-]{1,40}$/
const REMOTE = /^[\w.-]{1,100}$/
const MAX_LABEL = 60
const MAX_TEMPLATE = 1000

const SHOW_ON: readonly LauncherShowOn[] = ['mine', 'review', 'involved', 'all']

export interface ParsedLaunchers {
  /** Null when the file doesn't exist or isn't a JSON object. */
  config: LauncherConfig | null
  errors: LauncherConfigError[]
}

export function placeholders(template: string): string[] {
  return [...template.matchAll(/\{(\w+)\}/g)].map((m) => m[1])
}

/** "~" and "~/x" relative to `home`; anything else as written. */
export function expandHome(path: string, home: string): string {
  if (path === '~') return home
  if (path.startsWith('~/')) return join(home, path.slice(2))
  return path
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

export function parseLauncherConfig(text: string | null, home: string): ParsedLaunchers {
  if (text === null) return { config: null, errors: [] }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (err) {
    return { config: null, errors: [{ code: 'invalid_json', at: '', detail: err instanceof Error ? err.message : String(err) }] }
  }
  if (!isObject(raw)) return { config: null, errors: [{ code: 'not_object', at: '' }] }

  const errors: LauncherConfigError[] = []
  const fail = (code: LauncherConfigError['code'], at: string, detail?: string) => {
    errors.push(detail === undefined ? { code, at } : { code, at, detail })
  }
  /** Template with only `allowed` placeholders (and `required` ones, if any); null when not. */
  const template = (v: unknown, at: string, allowed: readonly string[], required: readonly string[] = []) => {
    if (typeof v !== 'string' || v.trim() === '' || v.length > MAX_TEMPLATE) return null
    const used = placeholders(v)
    const unknown = used.filter((p) => !allowed.includes(p))
    if (unknown.length > 0) {
      fail('unknown_placeholder', at, unknown.map((p) => `{${p}}`).join(', '))
      return null
    }
    const missing = required.filter((p) => !used.includes(p))
    if (missing.length > 0) {
      fail('missing_placeholder', at, missing.map((p) => `{${p}}`).join(', '))
      return null
    }
    return v.trim()
  }
  const absolute = (v: unknown, at: string): string | null => {
    const path = typeof v === 'string' ? expandHome(v.trim(), home) : ''
    if (isAbsolute(path)) return path
    fail('invalid_path', at)
    return null
  }

  // Terminal: Warp unless said otherwise.
  let terminal: TerminalConfig = { kind: 'warp' }
  if (raw.terminal !== undefined) {
    const t = raw.terminal
    if (isObject(t) && (t.kind === 'warp' || t.kind === 'warp-preview')) terminal = { kind: t.kind }
    else if (isObject(t) && t.kind === 'custom') {
      const command = template(t.command, 'terminal.command', TERMINAL_PLACEHOLDERS, ['command'])
      if (command) terminal = { kind: 'custom', command }
      else if (!errors.some((e) => e.at === 'terminal.command')) fail('invalid_terminal', 'terminal.command')
    } else fail('invalid_terminal', 'terminal')
  }

  const agents: Record<string, string> = {}
  if (isObject(raw.agents)) {
    for (const [name, value] of Object.entries(raw.agents)) {
      const at = `agents.${name}`
      if (!AGENT_NAME.test(name)) {
        fail('invalid_agent', at)
        continue
      }
      const command = template(value, at, AGENT_PLACEHOLDERS, ['prompt'])
      if (command) agents[name] = command
      else if (!errors.some((e) => e.at === at)) fail('invalid_agent', at)
    }
  } else if (raw.agents !== undefined) fail('invalid_agent', 'agents')

  const worktreesDir = absolute(raw.worktreesDir ?? DEFAULT_WORKTREES_DIR, 'worktreesDir') ?? expandHome(DEFAULT_WORKTREES_DIR, home)

  const repos: Record<string, RepoConfig> = {}
  if (isObject(raw.repos)) {
    for (const [repo, value] of Object.entries(raw.repos)) {
      const at = `repos.${repo}`
      const entry = typeof value === 'string' ? { path: value } : value
      if (!REPO.test(repo) || !isObject(entry)) {
        fail('invalid_repo', at)
        continue
      }
      const path = absolute(entry.path, `${at}.path`)
      const agentDir = entry.agentDir === undefined ? null : absolute(entry.agentDir, `${at}.agentDir`)
      const remote = entry.remote === undefined ? 'origin' : typeof entry.remote === 'string' && REMOTE.test(entry.remote) ? entry.remote : null
      if (remote === null) fail('invalid_repo', `${at}.remote`)
      if (!path || remote === null || (entry.agentDir !== undefined && !agentDir)) continue
      // GitHub treats owner/name case-insensitively; PRs carry GitHub's own casing.
      repos[repo.toLowerCase()] = { path, agentDir, remote }
    }
  } else if (raw.repos !== undefined) fail('invalid_repo', 'repos')

  const actions: ActionConfig[] = []
  if (Array.isArray(raw.actions)) {
    if (raw.actions.length > MAX_ACTIONS) fail('too_many_actions', 'actions', String(MAX_ACTIONS))
    raw.actions.slice(0, MAX_ACTIONS).forEach((a, i) => {
      const at = `actions[${i}]`
      if (!isObject(a) || typeof a.id !== 'string' || !ACTION_ID.test(a.id)) return fail('invalid_action', `${at}.id`)
      if (actions.some((x) => x.id === a.id)) return fail('duplicate_action', `${at}.id`, a.id)
      const label = typeof a.label === 'string' ? a.label.trim().slice(0, MAX_LABEL) : ''
      if (!label) return fail('invalid_action', `${at}.label`)
      const showOn = a.showOn === undefined ? 'all' : SHOW_ON.find((s) => s === a.showOn)
      if (!showOn) return fail('invalid_action', `${at}.showOn`)
      const names = Object.keys(agents)
      const agent = a.agent === undefined && names.length === 1 ? names[0] : a.agent
      if (typeof agent !== 'string' || !(agent in agents)) return fail('unknown_agent', `${at}.agent`, typeof agent === 'string' ? agent : undefined)
      const prompt = template(a.prompt, `${at}.prompt`, PROMPT_PLACEHOLDERS)
      if (!prompt) {
        if (!errors.some((e) => e.at === `${at}.prompt`)) fail('invalid_action', `${at}.prompt`)
        return
      }
      const workspace = a.workspace === undefined ? 'worktree' : a.workspace === 'worktree' || a.workspace === 'folder' ? a.workspace : null
      if (!workspace) return fail('invalid_action', `${at}.workspace`)
      actions.push({ id: a.id, label, showOn, agent, prompt, workspace })
    })
  } else if (raw.actions !== undefined) fail('invalid_action', 'actions')

  return { config: { terminal, agents, worktreesDir, repos, actions }, errors }
}

/** A starting point written when the user opens a launchers.json that doesn't exist yet. */
export const EXAMPLE_LAUNCHERS = {
  terminal: { kind: 'warp' },
  agents: { claude: 'claude {prompt}' },
  worktreesDir: DEFAULT_WORKTREES_DIR,
  repos: { 'owner/repo': '~/code/repo' },
  actions: [
    { id: 'triage-review', label: 'Triage the review', showOn: 'mine', agent: 'claude', prompt: '/triage-review {url}' },
    { id: 'code-review', label: 'Code review', showOn: 'review', agent: 'claude', prompt: '/code-review {url}' }
  ]
}

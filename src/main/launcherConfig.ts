/**
 * Reads and validates launchers.json (version 2, written by the Settings screen). Pure: the
 * caller passes the file's text (null when missing). Invalid entries are dropped and reported;
 * saving from the panel refuses any error instead.
 */
import { isAbsolute, join } from 'node:path'
import {
  EMPTY_LAUNCHERS,
  LAUNCHER_SHOW_ON,
  LAUNCHER_TERMINALS,
  PROMPT_PLACEHOLDERS,
  type LauncherAction,
  type LauncherConfigError,
  type LauncherEntry,
  type LauncherProject,
  type LauncherRun,
  type LaunchersConfig,
  type LaunchersView
} from '../shared/launchers'
import { REPO } from './settings'

export const LAUNCHERS_FILE = 'launchers.json'
export const DEFAULT_WORKTREES_DIR = '~/.pr-radar/worktrees'
export const MAX_ACTIONS = 30
export const MAX_PROJECTS = 20
export const MAX_REPOS = 50

const ID = /^[\w-]{1,40}$/
/** A skill name as Claude Code accepts it after "/" (plugins use "plugin:skill"). */
export const SKILL_NAME = /^[\w][\w:.-]{0,79}$/
const MAX_LABEL = 60
const MAX_NAME = 60
const MAX_PROMPT = 1000
const MAX_EXTRA = 500

export interface ParsedLaunchers {
  config: LaunchersConfig
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

/** One line, whitespace collapsed: prompts go on a command line. */
export function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

export function parseLaunchers(text: string | null, home: string): ParsedLaunchers {
  if (text === null) return { config: EMPTY_LAUNCHERS, errors: [] }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (err) {
    return { config: EMPTY_LAUNCHERS, errors: [{ code: 'invalid_json', at: '', detail: err instanceof Error ? err.message : String(err) }] }
  }
  return validateLaunchers(raw, home)
}

/** Validates a config object, from the file or from the panel. */
export function validateLaunchers(raw: unknown, home: string): ParsedLaunchers {
  if (!isObject(raw)) return { config: EMPTY_LAUNCHERS, errors: [{ code: 'not_object', at: '' }] }
  // Version 1 was edited by hand with another shape; the screen starts over.
  if (raw.version !== 2) return { config: EMPTY_LAUNCHERS, errors: [{ code: 'old_format', at: '' }] }

  const errors: LauncherConfigError[] = []
  const fail = (code: LauncherConfigError['code'], at: string, detail?: string) => {
    errors.push(detail === undefined ? { code, at } : { code, at, detail })
  }
  const absolute = (v: unknown): string | null => {
    const path = typeof v === 'string' ? expandHome(v.trim(), home) : ''
    return isAbsolute(path) ? path : null
  }

  let terminal = EMPTY_LAUNCHERS.terminal
  if (raw.terminal !== undefined) {
    const t = LAUNCHER_TERMINALS.find((x) => x === raw.terminal)
    if (t) terminal = t
    else fail('invalid_terminal', 'terminal')
  }

  const projects: LauncherProject[] = []
  if (Array.isArray(raw.projects)) {
    if (raw.projects.length > MAX_PROJECTS) fail('too_many', 'projects', String(MAX_PROJECTS))
    raw.projects.slice(0, MAX_PROJECTS).forEach((p, i) => {
      const at = `projects[${i}]`
      if (!isObject(p) || typeof p.id !== 'string' || !ID.test(p.id)) return fail('invalid_project', `${at}.id`)
      if (projects.some((x) => x.id === p.id)) return fail('duplicate_project', `${at}.id`, p.id)
      const path = absolute(p.path)
      if (!path) return fail('invalid_path', `${at}.path`)
      const name = typeof p.name === 'string' && p.name.trim() ? p.name.trim().slice(0, MAX_NAME) : null
      if (!name) return fail('invalid_project', `${at}.name`)
      const repos: Record<string, string> = {}
      if (!isObject(p.repos)) return fail('invalid_repo', `${at}.repos`)
      for (const [repo, value] of Object.entries(p.repos).slice(0, MAX_REPOS)) {
        const local = absolute(value)
        if (!REPO.test(repo) || !local) fail('invalid_repo', `${at}.repos.${repo}`)
        else repos[repo] = local
      }
      projects.push({ id: p.id, name, path, repos })
    })
  } else if (raw.projects !== undefined) fail('invalid_project', 'projects')

  const actions: LauncherAction[] = []
  if (Array.isArray(raw.actions)) {
    if (raw.actions.length > MAX_ACTIONS) fail('too_many', 'actions', String(MAX_ACTIONS))
    raw.actions.slice(0, MAX_ACTIONS).forEach((a, i) => {
      const at = `actions[${i}]`
      if (!isObject(a) || typeof a.id !== 'string' || !ID.test(a.id)) return fail('invalid_action', `${at}.id`)
      if (actions.some((x) => x.id === a.id)) return fail('duplicate_action', `${at}.id`, a.id)
      const label = typeof a.label === 'string' ? oneLine(a.label).slice(0, MAX_LABEL) : ''
      if (!label) return fail('invalid_action', `${at}.label`)
      if (typeof a.projectId !== 'string' || !projects.some((p) => p.id === a.projectId)) return fail('unknown_project', `${at}.projectId`)
      const showOn = a.showOn === undefined ? 'all' : LAUNCHER_SHOW_ON.find((s) => s === a.showOn)
      if (!showOn) return fail('invalid_action', `${at}.showOn`)
      const run = parseRun(a.run, `${at}.run`, fail)
      if (!run) return
      const extra = a.extra === undefined ? '' : typeof a.extra === 'string' ? oneLine(a.extra) : null
      if (extra === null || extra.length > MAX_EXTRA) return fail('invalid_action', `${at}.extra`)
      const workspace = a.workspace === undefined ? 'worktree' : a.workspace === 'worktree' || a.workspace === 'folder' ? a.workspace : null
      if (!workspace) return fail('invalid_action', `${at}.workspace`)
      actions.push({ id: a.id, label, projectId: a.projectId, showOn, run, extra, workspace })
    })
  } else if (raw.actions !== undefined) fail('invalid_action', 'actions')

  return { config: { version: 2, terminal, projects, actions }, errors }
}

function parseRun(v: unknown, at: string, fail: (code: LauncherConfigError['code'], at: string, detail?: string) => void): LauncherRun | null {
  if (isObject(v) && v.kind === 'skill') {
    if (typeof v.skill !== 'string' || !SKILL_NAME.test(v.skill)) {
      fail('invalid_skill', at, typeof v.skill === 'string' ? v.skill : undefined)
      return null
    }
    return { kind: 'skill', skill: v.skill, scope: v.scope === 'user' ? 'user' : 'project' }
  }
  if (isObject(v) && v.kind === 'prompt' && typeof v.text === 'string') {
    const text = oneLine(v.text)
    if (!text || text.length > MAX_PROMPT) {
      fail('invalid_action', at)
      return null
    }
    const unknown = placeholders(text).filter((p) => !(PROMPT_PLACEHOLDERS as readonly string[]).includes(p))
    if (unknown.length > 0) {
      fail('unknown_placeholder', at, unknown.map((p) => `{${p}}`).join(', '))
      return null
    }
    return { kind: 'prompt', text }
  }
  fail('invalid_action', at)
  return null
}

/** The submenu entries: each action with the repositories of its project. */
export function entriesOf(config: LaunchersConfig): LauncherEntry[] {
  return config.actions.map(({ id, label, showOn, projectId }) => {
    const project = config.projects.find((p) => p.id === projectId)
    return { id, label, showOn, repos: Object.keys(project?.repos ?? {}).map((r) => r.toLowerCase()) }
  })
}

export function describeLaunchers(parsed: ParsedLaunchers, path: string, exists: boolean, home: string): LaunchersView {
  return {
    path,
    exists,
    config: parsed.config,
    entries: entriesOf(parsed.config),
    errors: parsed.errors,
    worktreesDir: expandHome(DEFAULT_WORKTREES_DIR, home)
  }
}

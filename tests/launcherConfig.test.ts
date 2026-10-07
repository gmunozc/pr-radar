import { describe, expect, it } from 'vitest'
import { describeLaunchers, EXAMPLE_LAUNCHERS, expandHome, parseLauncherConfig, placeholders } from '../src/main/launcherConfig'
import { launchersFor, launchTargetOf, type LauncherEntry } from '../src/shared/launchers'
import { myPr, pr } from './fixtures'

const HOME = '/Users/me'
const parse = (value: unknown) => parseLauncherConfig(JSON.stringify(value), HOME)

const valid = {
  terminal: { kind: 'warp' },
  agents: { claude: 'claude {prompt}' },
  repos: {
    'Acme/App': '~/code/app',
    'acme/mono-sub': { path: '/src/mono/sub', agentDir: '~/src/mono', remote: 'upstream' }
  },
  actions: [
    { id: 'triage', label: 'Triage the review', showOn: 'mine', agent: 'claude', prompt: '/triage-review {url}' },
    { id: 'review', label: 'Code review', showOn: 'review', prompt: '/code-review {number}', workspace: 'folder' }
  ]
}

describe('parseLauncherConfig', () => {
  it('reads a valid file, with defaults for what it leaves out', () => {
    const { config, errors } = parse(valid)
    expect(errors).toEqual([])
    expect(config).toEqual({
      terminal: { kind: 'warp' },
      agents: { claude: 'claude {prompt}' },
      worktreesDir: '/Users/me/.pr-radar/worktrees',
      repos: {
        'acme/app': { path: '/Users/me/code/app', agentDir: null, remote: 'origin' },
        'acme/mono-sub': { path: '/src/mono/sub', agentDir: '/Users/me/src/mono', remote: 'upstream' }
      },
      actions: [
        { id: 'triage', label: 'Triage the review', showOn: 'mine', agent: 'claude', prompt: '/triage-review {url}', workspace: 'worktree' },
        { id: 'review', label: 'Code review', showOn: 'review', agent: 'claude', prompt: '/code-review {number}', workspace: 'folder' }
      ]
    })
  })

  it('treats a missing file as not configured and broken JSON as an error', () => {
    expect(parseLauncherConfig(null, HOME)).toEqual({ config: null, errors: [] })
    expect(parseLauncherConfig('{ nope', HOME).errors[0].code).toBe('invalid_json')
    expect(parse([1, 2]).errors).toEqual([{ code: 'not_object', at: '' }])
  })

  it('accepts Warp Preview and a custom terminal that takes {command}', () => {
    expect(parse({ terminal: { kind: 'warp-preview' } }).config?.terminal).toEqual({ kind: 'warp-preview' })
    expect(parse({ terminal: { kind: 'custom', command: 'ghostty -e {command}' } }).config?.terminal).toEqual({
      kind: 'custom',
      command: 'ghostty -e {command}'
    })
    const noCommand = parse({ terminal: { kind: 'custom', command: 'ghostty' } })
    expect(noCommand.config?.terminal).toEqual({ kind: 'warp' })
    expect(noCommand.errors).toEqual([{ code: 'missing_placeholder', at: 'terminal.command', detail: '{command}' }])
    expect(parse({ terminal: 'iterm' }).errors).toEqual([{ code: 'invalid_terminal', at: 'terminal' }])
  })

  it('keeps the valid actions and reports the rest', () => {
    const { config, errors } = parse({
      ...valid,
      actions: [
        ...valid.actions,
        { id: 'triage', label: 'Again', prompt: 'x' },
        { id: 'bad id!', label: 'x', prompt: 'x' },
        { id: 'branch', label: 'Branch', prompt: 'look at {branch}' },
        { id: 'ghost', label: 'Ghost', agent: 'codex', prompt: 'x' },
        { id: 'where', label: 'Where', prompt: 'x', showOn: 'everywhere' },
        { id: 'nolabel', label: '  ', prompt: 'x' }
      ]
    })
    expect(config?.actions.map((a) => a.id)).toEqual(['triage', 'review'])
    expect(errors).toEqual([
      { code: 'duplicate_action', at: 'actions[2].id', detail: 'triage' },
      { code: 'invalid_action', at: 'actions[3].id' },
      { code: 'unknown_placeholder', at: 'actions[4].prompt', detail: '{branch}' },
      { code: 'unknown_agent', at: 'actions[5].agent', detail: 'codex' },
      { code: 'invalid_action', at: 'actions[6].showOn' },
      { code: 'invalid_action', at: 'actions[7].label' }
    ])
  })

  it('needs the agent named when there is more than one', () => {
    const { config, errors } = parse({
      agents: { claude: 'claude {prompt}', codex: 'codex {prompt}' },
      actions: [{ id: 'a', label: 'A', prompt: 'x' }]
    })
    expect(config?.actions).toEqual([])
    expect(errors).toEqual([{ code: 'unknown_agent', at: 'actions[0].agent' }])
  })

  it('checks agent commands and repository entries', () => {
    const { config, errors } = parse({
      agents: { claude: 'claude {prompt} {workspace}', bare: 'claude', evil: 'claude {prompt} {title}', 'bad name': 'x {prompt}' },
      repos: { 'not a repo': '/x', 'acme/rel': 'code/rel', 'acme/remote': { path: '/x', remote: 'a b' }, 'acme/ok': '/ok' }
    })
    expect(config?.agents).toEqual({ claude: 'claude {prompt} {workspace}' })
    expect(Object.keys(config?.repos ?? {})).toEqual(['acme/ok'])
    expect(errors).toEqual([
      { code: 'missing_placeholder', at: 'agents.bare', detail: '{prompt}' },
      { code: 'unknown_placeholder', at: 'agents.evil', detail: '{title}' },
      { code: 'invalid_agent', at: 'agents.bad name' },
      { code: 'invalid_repo', at: 'repos.not a repo' },
      { code: 'invalid_path', at: 'repos.acme/rel.path' },
      { code: 'invalid_repo', at: 'repos.acme/remote.remote' }
    ])
  })

  it('caps the number of actions', () => {
    const actions = Array.from({ length: 25 }, (_, i) => ({ id: `a${i}`, label: `A${i}`, prompt: 'x' }))
    const { config, errors } = parse({ agents: { claude: 'claude {prompt}' }, actions })
    expect(config?.actions).toHaveLength(20)
    expect(errors).toEqual([{ code: 'too_many_actions', at: 'actions', detail: '20' }])
  })
})

describe('template helpers', () => {
  it('lists placeholders and expands ~', () => {
    expect(placeholders('/x {url} and {number}{sha} {not-one}')).toEqual(['url', 'number', 'sha'])
    expect(expandHome('~', HOME)).toBe(HOME)
    expect(expandHome('~/a/b', HOME)).toBe('/Users/me/a/b')
    expect(expandHome('/abs/~/x', HOME)).toBe('/abs/~/x')
  })
})

describe('launchersFor', () => {
  const entries: LauncherEntry[] = [
    { id: 'mine', label: 'M', showOn: 'mine' },
    { id: 'review', label: 'R', showOn: 'review' },
    { id: 'involved', label: 'I', showOn: 'involved' },
    { id: 'all', label: 'A', showOn: 'all' }
  ]

  it('offers each action on the lists it names', () => {
    expect(launchTargetOf(myPr('a'))).toBe('mine')
    expect(launchTargetOf(pr('a', { source: { kind: 'team', slug: 'core' } }))).toBe('review')
    expect(launchersFor(myPr('a'), entries).map((e) => e.id)).toEqual(['mine', 'all'])
    expect(launchersFor(pr('a'), entries).map((e) => e.id)).toEqual(['review', 'all'])
    expect(launchersFor(pr('a', { source: { kind: 'involved' } }), entries).map((e) => e.id)).toEqual(['involved', 'all'])
  })
})

describe('describeLaunchers', () => {
  it('gives the panel ids and labels only', () => {
    const info = describeLaunchers(parse(valid), '/data/launchers.json', true, HOME)
    expect(info).toEqual({
      path: '/data/launchers.json',
      exists: true,
      actions: [
        { id: 'triage', label: 'Triage the review', showOn: 'mine' },
        { id: 'review', label: 'Code review', showOn: 'review' }
      ],
      errors: [],
      worktreesDir: '/Users/me/.pr-radar/worktrees'
    })
    expect(describeLaunchers(parseLauncherConfig(null, HOME), '/x', false, HOME).actions).toEqual([])
  })
})

describe('EXAMPLE_LAUNCHERS', () => {
  it('is a valid file', () => {
    const { config, errors } = parse(EXAMPLE_LAUNCHERS)
    expect(errors).toEqual([])
    expect(config?.actions.map((a) => a.id)).toEqual(['triage-review', 'code-review'])
  })
})

import { describe, expect, it } from 'vitest'
import { describeLaunchers, entriesOf, expandHome, oneLine, parseLaunchers, placeholders, validateLaunchers } from '../src/main/launcherConfig'
import { launchersFor, launchTargetOf, projectRepoPath, runSummary, type LauncherEntry } from '../src/shared/launchers'
import { myPr, pr } from './fixtures'

const HOME = '/Users/me'
const parse = (value: unknown) => validateLaunchers(value, HOME)

const project = {
  id: 'p1',
  name: 'development',
  path: '/code/development',
  repos: { 'orion-global/development': '/code/development', 'orion-global/Core': '/code/development/core' }
}
const valid = {
  version: 2,
  terminal: 'warp',
  projects: [project],
  actions: [
    { id: 'a1', label: 'Revisar la review', projectId: 'p1', showOn: 'mine', run: { kind: 'skill', skill: 'triage-review', scope: 'project' }, extra: '', workspace: 'worktree' },
    { id: 'a2', label: 'Code review', projectId: 'p1', showOn: 'review', run: { kind: 'prompt', text: '/code-review {number}' }, extra: '', workspace: 'folder' }
  ]
}

describe('validateLaunchers', () => {
  it('reads a valid config, with defaults for what it leaves out', () => {
    const { config, errors } = parse({ ...valid, actions: [{ id: 'a3', label: 'X', projectId: 'p1', run: { kind: 'skill', skill: 'audit' } }] })
    expect(errors).toEqual([])
    expect(config).toEqual({
      version: 2,
      terminal: 'warp',
      projects: [project],
      actions: [{ id: 'a3', label: 'X', projectId: 'p1', showOn: 'all', run: { kind: 'skill', skill: 'audit', scope: 'project' }, extra: '', workspace: 'worktree' }]
    })
    expect(parse(valid)).toEqual({ config: valid, errors: [] })
  })

  it('treats a missing file as empty, and broken or old files as errors', () => {
    expect(parseLaunchers(null, HOME)).toEqual({ config: { version: 2, terminal: 'warp', projects: [], actions: [] }, errors: [] })
    expect(parseLaunchers('{ nope', HOME).errors[0].code).toBe('invalid_json')
    expect(parse([1]).errors).toEqual([{ code: 'not_object', at: '' }])
    expect(parse({ terminal: { kind: 'warp' }, actions: [] }).errors).toEqual([{ code: 'old_format', at: '' }])
  })

  it('keeps valid entries and reports the rest', () => {
    const { config, errors } = parse({
      ...valid,
      terminal: 'iterm',
      projects: [
        project,
        { ...project },
        { id: 'p2', name: 'x', path: 'relative', repos: {} },
        { id: 'p3', name: 'y', path: '~/y', repos: { 'not a repo': '/y', 'a/b': 'rel' } }
      ],
      actions: [
        ...valid.actions,
        { ...valid.actions[0] },
        { id: 'bad id!', label: 'x', projectId: 'p1', run: { kind: 'skill', skill: 'x' } },
        { id: 'a4', label: 'x', projectId: 'nope', run: { kind: 'skill', skill: 'x' } },
        { id: 'a5', label: 'x', projectId: 'p1', run: { kind: 'skill', skill: '-rf; echo' } },
        { id: 'a6', label: 'x', projectId: 'p1', run: { kind: 'prompt', text: 'look at {branch}' } },
        { id: 'a7', label: ' ', projectId: 'p1', run: { kind: 'skill', skill: 'x' } },
        { id: 'a8', label: 'x', projectId: 'p1', showOn: 'everywhere', run: { kind: 'skill', skill: 'x' } }
      ]
    })
    expect(config.terminal).toBe('warp')
    expect(config.projects.map((p) => p.id)).toEqual(['p1', 'p3'])
    expect(config.projects[1]).toEqual({ id: 'p3', name: 'y', path: '/Users/me/y', repos: {} })
    expect(config.actions.map((a) => a.id)).toEqual(['a1', 'a2'])
    expect(errors).toEqual([
      { code: 'invalid_terminal', at: 'terminal' },
      { code: 'duplicate_project', at: 'projects[1].id', detail: 'p1' },
      { code: 'invalid_path', at: 'projects[2].path' },
      { code: 'invalid_repo', at: 'projects[3].repos.not a repo' },
      { code: 'invalid_repo', at: 'projects[3].repos.a/b' },
      { code: 'duplicate_action', at: 'actions[2].id', detail: 'a1' },
      { code: 'invalid_action', at: 'actions[3].id' },
      { code: 'unknown_project', at: 'actions[4].projectId' },
      { code: 'invalid_skill', at: 'actions[5].run', detail: '-rf; echo' },
      { code: 'unknown_placeholder', at: 'actions[6].run', detail: '{branch}' },
      { code: 'invalid_action', at: 'actions[7].label' },
      { code: 'invalid_action', at: 'actions[8].showOn' }
    ])
  })

  it('keeps prompts and extra text on one line', () => {
    const { config } = parse({
      ...valid,
      actions: [{ id: 'a1', label: 'L', projectId: 'p1', run: { kind: 'prompt', text: 'one\ntwo' }, extra: ' be\n brief ' }]
    })
    expect(config.actions[0].run).toEqual({ kind: 'prompt', text: 'one two' })
    expect(config.actions[0].extra).toBe('be brief')
    expect(oneLine('  a \t b\r\n')).toBe('a b')
  })
})

describe('entries and helpers', () => {
  it('gives each entry the repositories of its project, lower case', () => {
    expect(entriesOf(parse(valid).config)).toEqual([
      { id: 'a1', label: 'Revisar la review', showOn: 'mine', repos: ['orion-global/development', 'orion-global/core'] },
      { id: 'a2', label: 'Code review', showOn: 'review', repos: ['orion-global/development', 'orion-global/core'] }
    ])
    const view = describeLaunchers(parse(valid), '/data/launchers.json', true, HOME)
    expect(view.worktreesDir).toBe('/Users/me/.pr-radar/worktrees')
    expect(view.entries).toHaveLength(2)
  })

  it('finds a clone whatever the casing', () => {
    expect(projectRepoPath(project, 'Orion-Global/core')).toBe('/code/development/core')
    expect(projectRepoPath(project, 'orion-global/altio')).toBeNull()
  })

  it('summarizes what an action runs', () => {
    expect(runSummary({ kind: 'skill', skill: 'triage-review', scope: 'project' })).toBe('/triage-review')
    expect(runSummary({ kind: 'prompt', text: 'x'.repeat(50) })).toBe(`${'x'.repeat(39)}…`)
  })

  it('lists placeholders and expands ~', () => {
    expect(placeholders('/x {url} and {number}{sha} {not-one}')).toEqual(['url', 'number', 'sha'])
    expect(expandHome('~', HOME)).toBe(HOME)
    expect(expandHome('~/a/b', HOME)).toBe('/Users/me/a/b')
    expect(expandHome('/abs/~/x', HOME)).toBe('/abs/~/x')
  })
})

describe('launchersFor', () => {
  const entries: LauncherEntry[] = [
    { id: 'mine', label: 'M', showOn: 'mine', repos: ['acme/app'] },
    { id: 'review', label: 'R', showOn: 'review', repos: ['acme/app'] },
    { id: 'involved', label: 'I', showOn: 'involved', repos: ['acme/app'] },
    { id: 'all', label: 'A', showOn: 'all', repos: ['acme/app'] },
    { id: 'other', label: 'O', showOn: 'all', repos: ['acme/other'] }
  ]

  it('offers each action on the lists it names, for its own repositories', () => {
    expect(launchTargetOf(myPr('a'))).toBe('mine')
    expect(launchTargetOf(pr('a', { source: { kind: 'team', slug: 'core' } }))).toBe('review')
    expect(launchersFor(myPr('a'), entries).map((e) => e.id)).toEqual(['mine', 'all'])
    expect(launchersFor(pr('a', { repo: 'Acme/App' }), entries).map((e) => e.id)).toEqual(['review', 'all'])
    expect(launchersFor(pr('a', { source: { kind: 'involved' } }), entries).map((e) => e.id)).toEqual(['involved', 'all'])
    expect(launchersFor(pr('a', { repo: 'acme/other' }), entries).map((e) => e.id)).toEqual(['other'])
  })
})

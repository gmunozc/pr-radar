import { describe, expect, it } from 'vitest'
import { detectProject, listSkills, parseGithubRemote, parseSkillFrontmatter, type DetectDeps } from '../src/main/projects'

describe('parseGithubRemote', () => {
  it('reads GitHub ssh and https remotes', () => {
    expect(parseGithubRemote('git@github.com:orion-global/core.git')).toBe('orion-global/core')
    expect(parseGithubRemote('https://github.com/orion-global/focus-python.git\n')).toBe('orion-global/focus-python')
    expect(parseGithubRemote('https://x-access-token:abc@github.com/acme/app')).toBe('acme/app')
    expect(parseGithubRemote('ssh://git@github.com/acme/app.js.git')).toBe('acme/app.js')
  })

  it('ignores other hosts and odd URLs', () => {
    expect(parseGithubRemote('git@gitlab.com:acme/app.git')).toBeNull()
    expect(parseGithubRemote('https://github.com.evil.io/acme/app')).toBeNull()
    expect(parseGithubRemote('https://github.com/acme')).toBeNull()
    expect(parseGithubRemote('/local/path')).toBeNull()
  })
})

/** A fake git: `tops` maps a folder to its repository root, `origins` a root to its remote URL. */
function fakeGit(world: { tops: Record<string, string>; origins: Record<string, string>; gitmodules?: Record<string, string>; dirs?: string[] }): DetectDeps {
  return {
    isDir: (p) => (world.dirs ?? Object.keys(world.tops)).includes(p),
    run: async (file, args, { cwd }) => {
      expect(file).toBe('git')
      if (args[0] === 'rev-parse') {
        if (!(cwd in world.tops)) throw new Error('not a git repository')
        return `${world.tops[cwd]}\n`
      }
      if (args[0] === 'remote') {
        if (!(cwd in world.origins)) throw new Error('no such remote')
        return `${world.origins[cwd]}\n`
      }
      if (args[0] === 'config') {
        const listing = world.gitmodules?.[cwd]
        if (listing === undefined) throw new Error('no .gitmodules')
        return listing
      }
      throw new Error(`unexpected git ${args.join(' ')}`)
    }
  }
}

describe('detectProject', () => {
  const R = '/code/development'

  it('maps the root and its checked-out submodules, nested ones too, skipping empty ones', async () => {
    const deps = fakeGit({
      tops: {
        [R]: R,
        [`${R}/sub`]: R,
        [`${R}/core`]: `${R}/core`,
        [`${R}/core/proto`]: `${R}/core/proto`,
        [`${R}/cloud-altio`]: `${R}/cloud-altio`,
        [`${R}/odoo`]: R
      },
      origins: {
        [R]: 'git@github.com:orion-global/development.git',
        [`${R}/core`]: 'git@github.com:orion-global/core.git',
        [`${R}/core/proto`]: 'git@github.com:orion-global/proto.git',
        [`${R}/cloud-altio`]: 'git@github.com:orion-global/altio.git'
      },
      gitmodules: {
        [R]: 'submodule.core.path core\nsubmodule.cloud-altio.path cloud-altio\nsubmodule.odoo.path odoo\nsubmodule.up.path ../outside\n',
        [`${R}/core`]: 'submodule.proto.path proto\n'
      },
      dirs: [R, `${R}/sub`, `${R}/core`, `${R}/core/proto`, `${R}/cloud-altio`, `${R}/odoo`, '/code/outside']
    })
    // Picking a subfolder uses the repository it belongs to.
    expect(await detectProject(`${R}/sub`, deps)).toEqual({
      ok: true,
      root: R,
      name: 'development',
      repos: {
        'orion-global/development': R,
        'orion-global/core': `${R}/core`,
        'orion-global/proto': `${R}/core/proto`,
        'orion-global/altio': `${R}/cloud-altio`
      }
    })
  })

  it('works without submodules, and says why it cannot', async () => {
    expect(await detectProject('/a', fakeGit({ tops: { '/a': '/a' }, origins: { '/a': 'https://github.com/acme/a' } }))).toEqual({
      ok: true,
      root: '/a',
      name: 'a',
      repos: { 'acme/a': '/a' }
    })
    expect(await detectProject('/nope', fakeGit({ tops: {}, origins: {} }))).toEqual({ ok: false, code: 'not_git' })
    expect(await detectProject('/a', fakeGit({ tops: { '/a': '/a' }, origins: { '/a': 'git@gitlab.com:acme/a.git' } }))).toEqual({
      ok: false,
      code: 'no_github'
    })
  })
})

describe('parseSkillFrontmatter', () => {
  it('reads one-line, quoted and block values', () => {
    expect(parseSkillFrontmatter('---\nname: audit\ndescription: Run an audit.\nlicense: MIT\n---\n# Body\ndescription: not this')).toEqual({
      name: 'audit',
      description: 'Run an audit.'
    })
    expect(parseSkillFrontmatter('---\nname: "quoted"\ndescription: >-\n  Folded text\n  over lines.\n\n  More.\nlicense: MIT\n---')).toEqual({
      name: 'quoted',
      description: 'Folded text over lines. More.'
    })
    expect(parseSkillFrontmatter('---\ndescription: |\n  Literal\n---')).toEqual({ description: 'Literal' })
    expect(parseSkillFrontmatter('# No front matter')).toEqual({})
  })
})

describe('listSkills', () => {
  const files: Record<string, string> = {
    '/p/.claude/skills/audit/SKILL.md': '---\nname: audit\ndescription: Audits.\n---',
    '/p/.claude/skills/no-name/SKILL.md': '---\ndescription: Uses the folder name.\n---',
    '/p/.claude/skills/weird/SKILL.md': '---\nname: bad name!\n---',
    '/p/.claude/skills/long/SKILL.md': `---\nname: long\ndescription: ${'x'.repeat(400)}\n---`
  }
  const fs = {
    listDir: (dir: string) => {
      if (dir !== '/p/.claude/skills') throw new Error('ENOENT')
      return ['audit', 'no-name', 'weird', 'long', 'empty', '.trash', 'synced']
    },
    readFile: (path: string) => files[path] ?? null
  }

  it('lists skills sorted, named by front matter or folder', () => {
    const skills = listSkills('/p/.claude/skills', 'project', fs)
    expect(skills.map((s) => s.name)).toEqual(['audit', 'long', 'no-name', 'weird'])
    expect(skills[0]).toEqual({ name: 'audit', description: 'Audits.', scope: 'project' })
    expect(skills[1].description).toHaveLength(300)
    expect(listSkills('/missing', 'user', fs)).toEqual([])
  })
})

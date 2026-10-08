import { describe, expect, it } from 'vitest'
import { listMarkdown } from '../src/renderer/listMarkdown'
import { translator } from '../src/shared/i18n'
import { myPr, pr } from './fixtures'

const es = translator('es')
const en = translator('en')
const NOW = Date.parse('2026-01-01T03:00:00Z')

describe('listMarkdown', () => {
  it('writes one bullet per PR with the link, the author and the age, in the given language', () => {
    const prs = [pr('PR_1', { title: 'Add filters', isDraft: true }), pr('PR_2', { title: 'Fix build', author: null })]
    expect(listMarkdown(prs, es, 'es', NOW)).toBe(
      '- [acme/app#1 Add filters](https://github.com/acme/app/pull/PR_1) · @octo · Draft · hace 3 horas\n' +
        '- [acme/app#2 Fix build](https://github.com/acme/app/pull/PR_2) · hace 3 horas'
    )
    expect(listMarkdown(prs.slice(0, 1), en, 'en', NOW)).toContain('· @octo · Draft · 3 hours ago')
  })

  it('names the status of your own PRs instead of the author', () => {
    const mine = [myPr('MY_1', { title: 'Ship it', readyToMerge: true }), myPr('MY_2', { title: 'WIP', status: 'changes_requested' })]
    const lines = listMarkdown(mine, es, 'es', NOW).split('\n')
    expect(lines[0]).toContain('· Listo para merge ·')
    expect(lines[1]).toContain('· Cambios solicitados ·')
    expect(lines[0]).not.toContain('@')
  })

  it('escapes brackets and backslashes in titles so the link survives', () => {
    const out = listMarkdown([pr('PR_1', { title: 'Fix [auth] \\ parser' })], en, 'en', NOW)
    expect(out.startsWith('- [acme/app#1 Fix \\[auth\\] \\\\ parser](https://github.com/acme/app/pull/PR_1)')).toBe(true)
  })
})

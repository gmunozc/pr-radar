import { describe, expect, it } from 'vitest'
import type { Alerts } from '../src/main/engine'
import { applyMute } from '../src/main/mute'
import { myPr, pr } from './fixtures'

const alerts = (over: Partial<Alerts> = {}): Alerts => ({ reviewPlan: { kind: 'none' }, returned: [], mine: [], ...over })
const other = (id: string) => pr(id, { repo: 'other/repo' })

describe('applyMute', () => {
  it('drops review requests, reminders and updates about muted repositories', () => {
    const input = alerts({
      reviewPlan: { kind: 'individual', prs: [pr('a'), other('b')] },
      returned: [pr('c'), other('d')],
      mine: [
        { kind: 'my_pr_approved', pr: myPr('m1'), by: [] },
        { kind: 'my_pr_ready', pr: myPr('m2', { repo: 'other/repo' }) }
      ]
    })
    expect(applyMute(input, ['acme/app'])).toEqual({
      reviewPlan: { kind: 'individual', prs: [other('b')] },
      returned: [other('d')],
      mine: [{ kind: 'my_pr_ready', pr: myPr('m2', { repo: 'other/repo' }) }]
    })
  })

  it('turns an emptied plan into none, a shrunken group into individual alerts, and leaves summaries alone', () => {
    expect(applyMute(alerts({ reviewPlan: { kind: 'individual', prs: [pr('a')] } }), ['acme/app']).reviewPlan).toEqual({ kind: 'none' })
    const group = alerts({ reviewPlan: { kind: 'grouped', prs: [pr('a'), pr('b'), pr('c'), other('d'), other('e')] } })
    expect(applyMute(group, ['acme/app']).reviewPlan).toEqual({ kind: 'individual', prs: [other('d'), other('e')] })
    const summary = alerts({ reviewPlan: { kind: 'summary', count: 4 } })
    expect(applyMute(summary, ['acme/app']).reviewPlan).toEqual({ kind: 'summary', count: 4 })
  })

  it('keeps merges PR Radar did for you, and changes nothing without muted repositories', () => {
    const merged = alerts({ merged: [{ pr: myPr('m1'), method: 'SQUASH' }], mergeFailed: [{ pr: myPr('m2'), code: 'stale' }] })
    expect(applyMute(merged, ['acme/app'])).toMatchObject({ merged: merged.merged, mergeFailed: merged.mergeFailed })
    expect(applyMute(merged, [])).toBe(merged)
  })
})

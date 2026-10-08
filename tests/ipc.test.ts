import { describe, expect, it, vi } from 'vitest'

// ipc.ts imports electron for its handlers; only the pure helpers are tested here.
vi.mock('electron', () => ({ app: {}, ipcMain: {}, shell: {}, Notification: class {} }))

const { isAllowedExternalUrl, isKnownCheckUrl, isWebUrl, linkClipboard, parsePrAction } = await import('../src/main/ipc')
const { pr, myPr } = await import('./fixtures')

describe('isKnownCheckUrl', () => {
  it('only opens https URLs that GitHub reported for a check in the current state', () => {
    const check = { name: 'ci', state: 'failure' as const, url: 'https://circleci.com/gh/acme/app/1' }
    const state = { prs: [pr('a', { checks: [check] })], myPrs: [myPr('m')], involved: [] }
    expect(isKnownCheckUrl(state, 'https://circleci.com/gh/acme/app/1')).toBe(true)
    expect(isKnownCheckUrl(state, 'https://circleci.com/gh/acme/app/2')).toBe(false)
    expect(isKnownCheckUrl({ prs: [], myPrs: [], involved: [pr('i', { checks: [check] })] }, check.url)).toBe(true)
    expect(isKnownCheckUrl({ prs: [pr('a', { checks: [{ ...check, url: 'http://x/1' }] })], myPrs: [], involved: [] }, 'http://x/1')).toBe(false)
  })
})

describe('parsePrAction', () => {
  it('accepts well-formed actions and drops anything else', () => {
    expect(parsePrAction({ kind: 'update_branch' })).toEqual({ kind: 'update_branch' })
    expect(parsePrAction({ kind: 'arm_merge', method: 'MERGE' })).toEqual({ kind: 'arm_merge', method: 'MERGE' })
    expect(parsePrAction({ kind: 'disarm_merge' })).toEqual({ kind: 'disarm_merge' })
    expect(parsePrAction({ kind: 'arm_merge' })).toBeNull()
    expect(parsePrAction({ kind: 'merge', method: 'SQUASH' })).toEqual({ kind: 'merge', method: 'SQUASH' })
    expect(parsePrAction({ kind: 'enable_auto_merge', method: 'REBASE', extra: 1 })).toEqual({
      kind: 'enable_auto_merge',
      method: 'REBASE'
    })
    expect(parsePrAction({ kind: 'approve' })).toEqual({ kind: 'approve' })
    expect(parsePrAction({ kind: 'approve', body: 'LGTM' })).toEqual({ kind: 'approve', body: 'LGTM' })

    expect(parsePrAction({ kind: 'merge', method: 'FAST_FORWARD' })).toBeNull()
    expect(parsePrAction({ kind: 'merge' })).toBeNull()
    expect(parsePrAction({ kind: 'approve', body: 'x'.repeat(2001) })).toBeNull()
    expect(parsePrAction({ kind: 'approve', body: 7 })).toBeNull()
    expect(parsePrAction({ kind: 'delete_repo' })).toBeNull()
    expect(parsePrAction('merge')).toBeNull()
    expect(parsePrAction(null)).toBeNull()
  })
})

describe('isAllowedExternalUrl', () => {
  it('only allows https GitHub URLs', () => {
    expect(isAllowedExternalUrl('https://github.com/acme/app/pull/1')).toBe(true)
    expect(isAllowedExternalUrl('https://github.com/login/device')).toBe(true)
    expect(isAllowedExternalUrl('http://github.com/acme')).toBe(false)
    expect(isAllowedExternalUrl('https://github.com.evil.io/x')).toBe(false)
    expect(isAllowedExternalUrl('file:///etc/passwd')).toBe(false)
    expect(isAllowedExternalUrl('not a url')).toBe(false)
  })
})

describe('linkClipboard', () => {
  it('writes Markdown as plain text and an anchor as rich text, escaping HTML', () => {
    expect(linkClipboard('Fix <b> & "quotes"', 'https://github.com/acme/app/pull/12')).toEqual({
      text: '[Fix <b> & "quotes"](https://github.com/acme/app/pull/12)',
      html: '<a href="https://github.com/acme/app/pull/12">Fix &lt;b&gt; &amp; &quot;quotes&quot;</a>'
    })
  })
})

describe('isWebUrl', () => {
  it('accepts http(s) anywhere on the web and nothing else', () => {
    expect(isWebUrl('https://example.com/spec')).toBe(true)
    expect(isWebUrl('http://intranet/wiki')).toBe(true)
    expect(isWebUrl('file:///etc/passwd')).toBe(false)
    expect(isWebUrl('javascript:alert(1)')).toBe(false)
    expect(isWebUrl('not a url')).toBe(false)
  })
})

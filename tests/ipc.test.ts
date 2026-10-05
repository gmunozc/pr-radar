import { describe, expect, it, vi } from 'vitest'

// ipc.ts imports electron for its handlers; only the pure helpers are tested here.
vi.mock('electron', () => ({ app: {}, ipcMain: {}, shell: {}, Notification: class {} }))

const { isAllowedExternalUrl, parsePrAction } = await import('../src/main/ipc')

describe('parsePrAction', () => {
  it('accepts well-formed actions and drops anything else', () => {
    expect(parsePrAction({ kind: 'update_branch' })).toEqual({ kind: 'update_branch' })
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

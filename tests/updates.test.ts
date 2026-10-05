import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { Logger } from '../src/main/log'
import type { InstallState } from '../src/shared/types'
import {
  CHECK_INTERVAL_MS,
  fetchLatestRelease,
  isNewer,
  isReleaseUrl,
  parseChecksums,
  parseRelease,
  sha256File,
  UpdateChecker,
  UpdateInstaller,
  verifyChecksum,
  type ReleaseCheck,
  type UpdateCheckerState,
  type UpdateInfo,
  type UpdateInstallerDeps
} from '../src/main/updates'

const silent: Logger = { debug() {}, info() {}, warn() {}, error() {} }

const dmgUrl = (tag: string, arch: string) =>
  `https://github.com/gmunozc/pr-radar/releases/download/${tag}/PR-Radar-${tag.slice(1)}-${arch}.dmg`
const dmg = (tag: string, arch: string) => ({ name: `PR-Radar-${tag.slice(1)}-${arch}.dmg`, browser_download_url: dmgUrl(tag, arch) })

const release = (tag: string, over: Record<string, unknown> = {}) => ({
  tag_name: tag,
  html_url: `https://github.com/gmunozc/pr-radar/releases/tag/${tag}`,
  draft: false,
  prerelease: false,
  assets: [
    { name: 'SHA256SUMS.txt', browser_download_url: 'https://github.com/gmunozc/pr-radar/releases/download/x/SHA256SUMS.txt' },
    dmg(tag, 'arm64'),
    dmg(tag, 'x64')
  ],
  ...over
})

describe('isNewer', () => {
  it('compares versions numerically', () => {
    expect(isNewer('0.10.0', '0.9.9')).toBe(true)
    expect(isNewer('v1.0.0', '0.9.0')).toBe(true)
    expect(isNewer('0.6.0', '0.6.0')).toBe(false)
    expect(isNewer('0.5.9', '0.6.0')).toBe(false)
  })

  it('never treats malformed versions as newer', () => {
    expect(isNewer('1.0', '0.1.0')).toBe(false)
    expect(isNewer('1.0.0-beta.1', '0.1.0')).toBe(false)
    expect(isNewer('latest', '0.1.0')).toBe(false)
  })
})

describe('parseRelease', () => {
  it("picks the dmg for the Mac's architecture", () => {
    expect(parseRelease(release('v0.8.0'), 'arm64')).toEqual({
      version: '0.8.0',
      releaseUrl: 'https://github.com/gmunozc/pr-radar/releases/tag/v0.8.0',
      downloadUrl: dmgUrl('v0.8.0', 'arm64'),
      assetName: 'PR-Radar-0.8.0-arm64.dmg',
      checksumsUrl: 'https://github.com/gmunozc/pr-radar/releases/download/x/SHA256SUMS.txt'
    })
    expect(parseRelease(release('v0.8.0'), 'x64')?.downloadUrl).toBe(dmgUrl('v0.8.0', 'x64'))
  })

  it('falls back to a universal dmg, then to no direct link', () => {
    const universal = release('v0.7.0', { assets: [dmg('v0.7.0', 'universal')] })
    expect(parseRelease(universal, 'arm64')?.downloadUrl).toBe(dmgUrl('v0.7.0', 'universal'))
    expect(parseRelease(universal, 'x64')?.downloadUrl).toBe(dmgUrl('v0.7.0', 'universal'))
    expect(parseRelease(release('v0.8.0', { assets: [dmg('v0.8.0', 'x64')] }), 'arm64')?.downloadUrl).toBeNull()
    expect(parseRelease(release('v0.8.0', { assets: [] }), 'arm64')?.downloadUrl).toBeNull()
  })

  it('ignores drafts, prereleases and garbage', () => {
    expect(parseRelease(release('v0.7.0', { draft: true }), 'arm64')).toBeNull()
    expect(parseRelease(release('v0.7.0', { prerelease: true }), 'arm64')).toBeNull()
    expect(parseRelease({ message: 'Not Found' }, 'arm64')).toBeNull()
    expect(parseRelease(null, 'arm64')).toBeNull()
  })
})

describe('fetchLatestRelease', () => {
  it('sends the ETag and handles 304 and 404', async () => {
    const json = new Response(JSON.stringify(release('v0.7.0')), { status: 200, headers: { etag: 'W/"abc"' } })
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(json)
      .mockResolvedValueOnce(new Response(null, { status: 304 }))
      .mockResolvedValueOnce(new Response('{}', { status: 404 }))
    expect(await fetchLatestRelease('gmunozc/pr-radar', null, 'arm64', fetchFn)).toMatchObject({
      release: { version: '0.7.0' },
      etag: 'W/"abc"',
      notModified: false
    })
    expect(await fetchLatestRelease('gmunozc/pr-radar', 'W/"abc"', 'arm64', fetchFn)).toEqual({ release: null, etag: 'W/"abc"', notModified: true })
    expect(fetchFn.mock.calls[1][1].headers['If-None-Match']).toBe('W/"abc"')
    expect(await fetchLatestRelease('gmunozc/pr-radar', null, 'arm64', fetchFn)).toEqual({ release: null, etag: null, notModified: false })
  })
})

describe('UpdateChecker', () => {
  function setup(responses: Array<ReleaseCheck | Error>, initial: UpdateCheckerState = {}) {
    let state = initial
    let now = 1_000_000
    const queue = [...responses]
    const fetchLatest = vi.fn(async () => {
      const next = queue.shift()
      if (!next || next instanceof Error) throw next ?? new Error('no response')
      return next
    })
    const checker = new UpdateChecker({
      repo: 'gmunozc/pr-radar',
      currentVersion: '0.6.0',
      now: () => now,
      load: () => state,
      save: (s) => (state = s),
      fetchLatest,
      log: silent
    })
    return { checker, fetchLatest, advance: (ms: number) => (now += ms), get state() {
      return state
    } }
  }
  const found = (tag: string): ReleaseCheck => ({ release: parseRelease(release(tag), 'arm64'), etag: `"${tag}"`, notModified: false })

  it('announces a newer version once and keeps showing it', async () => {
    const t = setup([found('v0.7.0'), { release: null, etag: '"v0.7.0"', notModified: true }])
    expect((await t.checker.check())?.version).toBe('0.7.0')
    expect(t.checker.available?.version).toBe('0.7.0')
    t.advance(CHECK_INTERVAL_MS)
    expect(await t.checker.check()).toBeNull()
    expect(t.checker.available?.version).toBe('0.7.0')
  })

  it('checks at most every 6 hours unless forced', async () => {
    const t = setup([found('v0.6.0'), found('v0.6.0')])
    await t.checker.check()
    await t.checker.check()
    expect(t.fetchLatest).toHaveBeenCalledTimes(1)
    await t.checker.check(true)
    expect(t.fetchLatest).toHaveBeenCalledTimes(2)
  })

  it('stays quiet for the current version, skipped versions and errors', async () => {
    const t = setup([found('v0.6.0'), found('v0.8.0'), new Error('offline')])
    expect(await t.checker.check(true)).toBeNull()
    t.checker.skip('0.8.0')
    expect(await t.checker.check(true)).toBeNull()
    expect(t.checker.available).toBeNull()
    expect(await t.checker.check(true)).toBeNull()
    expect(t.state.lastCheckAt).toBeDefined()
  })
})

describe('isReleaseUrl', () => {
  it('only allows this repository releases on github.com', () => {
    expect(isReleaseUrl('https://github.com/gmunozc/pr-radar/releases/tag/v0.7.0', 'gmunozc/pr-radar')).toBe(true)
    expect(isReleaseUrl('https://github.com/gmunozc/pr-radar/releases/download/v0.7.0/x.dmg', 'gmunozc/pr-radar')).toBe(true)
    expect(isReleaseUrl('https://github.com/evil/pr-radar/releases/tag/v1', 'gmunozc/pr-radar')).toBe(false)
    expect(isReleaseUrl('http://github.com/gmunozc/pr-radar/releases/tag/v1', 'gmunozc/pr-radar')).toBe(false)
    expect(isReleaseUrl('https://github.com.evil.io/gmunozc/pr-radar/releases/', 'gmunozc/pr-radar')).toBe(false)
  })
})

describe('checksums', () => {
  const sums = parseChecksums(
    'AB'.repeat(32) + '  PR-Radar-0.8.0-arm64.dmg\r\n' + 'cd'.repeat(32) + ' *PR-Radar-0.8.0-x64.dmg\n\nnot a line\n'
  )

  it('parses shasum output in both formats and ignores noise', () => {
    expect(sums).toEqual({ 'PR-Radar-0.8.0-arm64.dmg': 'ab'.repeat(32), 'PR-Radar-0.8.0-x64.dmg': 'cd'.repeat(32) })
  })

  it('verifies a file against the list', () => {
    expect(verifyChecksum(sums, 'PR-Radar-0.8.0-arm64.dmg', 'AB'.repeat(32))).toBe('ok')
    expect(verifyChecksum(sums, 'PR-Radar-0.8.0-arm64.dmg', 'ff'.repeat(32))).toBe('mismatch')
    expect(verifyChecksum(sums, 'other.dmg', 'ab'.repeat(32))).toBe('missing')
  })

  it('hashes a file with SHA-256', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pr-radar-test-'))
    const file = join(dir, 'x.bin')
    writeFileSync(file, 'hello')
    expect(await sha256File(file)).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824')
  })
})

describe('UpdateInstaller', () => {
  const info: UpdateInfo = {
    version: '0.8.0',
    releaseUrl: 'https://github.com/gmunozc/pr-radar/releases/tag/v0.8.0',
    downloadUrl: dmgUrl('v0.8.0', 'arm64'),
    assetName: 'PR-Radar-0.8.0-arm64.dmg',
    checksumsUrl: 'https://github.com/gmunozc/pr-radar/releases/download/v0.8.0/SHA256SUMS.txt'
  }
  const HEX = 'ab'.repeat(32)

  function setup(over: Partial<UpdateInstallerDeps> = {}) {
    const states: InstallState[] = []
    const removed: string[] = []
    const opened: string[] = []
    const deps: UpdateInstallerDeps = {
      dir: '/downloads',
      download: vi.fn(async (_url, _dest, onProgress) => {
        onProgress(0.5)
        onProgress(1)
      }),
      fetchText: vi.fn(async () => `${HEX}  PR-Radar-0.8.0-arm64.dmg\n`),
      sha256: vi.fn(async () => HEX),
      openPath: vi.fn(async (path: string) => void opened.push(path)),
      removeFile: (path) => removed.push(path),
      joinPath: (dir, name) => `${dir}/${name}`,
      onChange: (s) => states.push(s),
      log: silent,
      ...over
    }
    return { installer: new UpdateInstaller(deps), deps, states, removed, opened }
  }

  it('downloads, verifies and opens the dmg, reporting progress', async () => {
    const t = setup()
    await t.installer.install(info)
    expect(t.states).toEqual([
      { phase: 'downloading', percent: null },
      { phase: 'downloading', percent: 0.5 },
      { phase: 'downloading', percent: 1 },
      { phase: 'verifying' },
      { phase: 'ready', path: '/downloads/PR-Radar-0.8.0-arm64.dmg' }
    ])
    expect(t.opened).toEqual(['/downloads/PR-Radar-0.8.0-arm64.dmg'])
    expect(t.deps.download).toHaveBeenCalledWith(info.downloadUrl, '/downloads/PR-Radar-0.8.0-arm64.dmg', expect.any(Function), expect.any(AbortSignal))
    expect(t.installer.state).toEqual({ phase: 'ready', path: '/downloads/PR-Radar-0.8.0-arm64.dmg' })
  })

  it('deletes a download that does not match the checksum', async () => {
    const t = setup({ sha256: async () => 'ff'.repeat(32) })
    await t.installer.install(info)
    expect(t.installer.state).toEqual({ phase: 'error', code: 'checksum' })
    expect(t.removed).toEqual(['/downloads/PR-Radar-0.8.0-arm64.dmg'])
    expect(t.opened).toEqual([])
  })

  it('refuses to install without checksums or without a dmg for this Mac', async () => {
    const noSums = setup()
    await noSums.installer.install({ ...info, checksumsUrl: null })
    expect(noSums.installer.state).toEqual({ phase: 'error', code: 'checksum' })
    expect(noSums.deps.download).not.toHaveBeenCalled()

    const unlisted = setup({ fetchText: async () => `${HEX}  something-else.dmg\n` })
    await unlisted.installer.install(info)
    expect(unlisted.installer.state).toEqual({ phase: 'error', code: 'checksum' })

    const noDmg = setup()
    await noDmg.installer.install({ ...info, downloadUrl: null, assetName: null })
    expect(noDmg.installer.state).toEqual({ phase: 'error', code: 'unavailable' })
  })

  it('reports network and file errors, and a cancelled download', async () => {
    const offline = setup({
      download: async () => {
        throw new TypeError('fetch failed')
      }
    })
    await offline.installer.install(info)
    expect(offline.installer.state).toEqual({ phase: 'error', code: 'network' })

    const disk = setup({
      download: async () => {
        throw Object.assign(new Error('no space'), { code: 'ENOSPC' })
      }
    })
    await disk.installer.install(info)
    expect(disk.installer.state).toEqual({ phase: 'error', code: 'io' })

    const slow = setup({
      download: (_url, _dest, _onProgress, signal) =>
        new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('download cancelled'))))
    })
    const pending = slow.installer.install(info)
    slow.installer.cancel()
    await pending
    expect(slow.installer.state).toEqual({ phase: 'error', code: 'cancelled' })
  })
})

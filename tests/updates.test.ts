import { describe, expect, it, vi } from 'vitest'
import type { Logger } from '../src/main/log'
import {
  CHECK_INTERVAL_MS,
  fetchLatestRelease,
  isNewer,
  isReleaseUrl,
  parseRelease,
  UpdateChecker,
  type ReleaseCheck,
  type UpdateCheckerState
} from '../src/main/updates'

const silent: Logger = { debug() {}, info() {}, warn() {}, error() {} }

const release = (tag: string, over: Record<string, unknown> = {}) => ({
  tag_name: tag,
  html_url: `https://github.com/gmunozc/pr-radar/releases/tag/${tag}`,
  draft: false,
  prerelease: false,
  assets: [
    { name: 'SHA256SUMS.txt', browser_download_url: 'https://github.com/gmunozc/pr-radar/releases/download/x/SHA256SUMS.txt' },
    {
      name: `PR-Radar-${tag.slice(1)}-universal.dmg`,
      browser_download_url: `https://github.com/gmunozc/pr-radar/releases/download/${tag}/PR-Radar-${tag.slice(1)}-universal.dmg`
    }
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
  it('picks the universal dmg', () => {
    expect(parseRelease(release('v0.7.0'))).toEqual({
      version: '0.7.0',
      releaseUrl: 'https://github.com/gmunozc/pr-radar/releases/tag/v0.7.0',
      downloadUrl: 'https://github.com/gmunozc/pr-radar/releases/download/v0.7.0/PR-Radar-0.7.0-universal.dmg'
    })
    expect(parseRelease(release('v0.7.0', { assets: [] }))?.downloadUrl).toBeNull()
  })

  it('ignores drafts, prereleases and garbage', () => {
    expect(parseRelease(release('v0.7.0', { draft: true }))).toBeNull()
    expect(parseRelease(release('v0.7.0', { prerelease: true }))).toBeNull()
    expect(parseRelease({ message: 'Not Found' })).toBeNull()
    expect(parseRelease(null)).toBeNull()
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
    expect(await fetchLatestRelease('gmunozc/pr-radar', null, fetchFn)).toMatchObject({
      release: { version: '0.7.0' },
      etag: 'W/"abc"',
      notModified: false
    })
    expect(await fetchLatestRelease('gmunozc/pr-radar', 'W/"abc"', fetchFn)).toEqual({ release: null, etag: 'W/"abc"', notModified: true })
    expect(fetchFn.mock.calls[1][1].headers['If-None-Match']).toBe('W/"abc"')
    expect(await fetchLatestRelease('gmunozc/pr-radar', null, fetchFn)).toEqual({ release: null, etag: null, notModified: false })
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
  const found = (tag: string): ReleaseCheck => ({ release: parseRelease(release(tag)), etag: `"${tag}"`, notModified: false })

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

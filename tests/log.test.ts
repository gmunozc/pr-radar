import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AppLogger, redact } from '../src/main/log'

describe('redact', () => {
  it('removes GitHub tokens in every common shape', () => {
    const text = [
      'token gho_FAKEaccessTOKENforTESTSonly0000000',
      'refresh ghr_FAKErefreshTOKENforTESTSonly00000000',
      'app ghu_abcdefghijklmnopqrstuvwxyz',
      'pat github_pat_11ABCDEFG0123456789_abcdef',
      'Authorization: Bearer abc.def-123',
      'body refresh_token=ghr_secretvalue&grant_type=refresh_token',
      '{"accessToken":"anything-here","refreshToken":"x"}'
    ].join('\n')
    const out = redact(text)
    expect(out).not.toMatch(/FAKEaccess|FAKErefresh|abcdefghijk|11ABCDEFG|abc\.def|secretvalue|anything-here/)
    expect(out).toContain('gho_***')
    expect(out).toContain('Bearer ***')
    expect(out).toContain('"accessToken":"***"')
  })

  it('leaves normal text alone', () => {
    expect(redact('poll ok: 16 PRs in acme/web#12')).toBe('poll ok: 16 PRs in acme/web#12')
  })
})

describe('AppLogger', () => {
  it('keeps recent entries in memory, filtered by level, and redacted', () => {
    const log = new AppLogger(3)
    log.info('a')
    log.warn('b gho_1234567890abcdef')
    log.error('c', new Error('boom'))
    log.info('d')
    expect(log.recent().map((e) => e.message)).toEqual(['b gho_***', 'c Error: boom', 'd'])
    expect(log.recent(10, 'warn').map((e) => e.level)).toEqual(['warn', 'error'])
  })

  it('writes to a file and rotates it by size', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pr-radar-log-'))
    const file = join(dir, 'logs', 'pr-radar.log')
    const log = new AppLogger()
    log.init({ file, maxBytes: 200, keep: 2 })
    for (let i = 0; i < 20; i++) log.info(`line ${i} ${'x'.repeat(40)}`)
    expect(readFileSync(file, 'utf8')).toContain('line 19')
    expect(existsSync(`${file}.1`)).toBe(true)
    expect(existsSync(`${file}.2`)).toBe(true)
    expect(existsSync(`${file}.3`)).toBe(false)
  })

  it('skips debug lines unless enabled', () => {
    const log = new AppLogger()
    log.debug('hidden')
    expect(log.recent()).toEqual([])
  })
})

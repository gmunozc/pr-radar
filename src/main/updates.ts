/**
 * "A new version is available" notice and the install flow. Without an Apple Developer ID the
 * app can't replace itself (Squirrel.Mac needs a signed app), so it downloads the dmg, checks it
 * against the release's SHA256SUMS.txt and opens it for the user to drag. Electron-free;
 * index.ts wires it up.
 */
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import type { InstallErrorCode, InstallState } from '../shared/types'
import type { Logger } from './log'

export interface UpdateInfo {
  version: string
  releaseUrl: string
  /** Direct link to the dmg for this Mac, when the release has one. */
  downloadUrl: string | null
  /** File name of that dmg, as listed in SHA256SUMS.txt. */
  assetName: string | null
  /** The release's SHA256SUMS.txt, used to verify the download. */
  checksumsUrl: string | null
}

export interface ReleaseCheck {
  /** null: no release, or not reachable (e.g. the repo is private). */
  release: UpdateInfo | null
  etag: string | null
  notModified: boolean
}

type FetchFn = typeof fetch

/** Numeric x.y.z comparison; ignores a leading "v" and treats malformed versions as not newer. */
export function isNewer(candidate: string, current: string): boolean {
  const parse = (v: string) => {
    const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(v.trim())
    return m ? m.slice(1).map(Number) : null
  }
  const a = parse(candidate)
  const b = parse(current)
  if (!a || !b) return false
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i]
  }
  return false
}

interface RawRelease {
  tag_name?: string
  html_url?: string
  draft?: boolean
  prerelease?: boolean
  assets?: Array<{ name?: string; browser_download_url?: string }>
}

/**
 * Releases ship one dmg per architecture (`arch` is arm64 or x64). A universal dmg, as in
 * releases up to 0.7, is the fallback.
 */
export function parseRelease(body: unknown, arch: string): UpdateInfo | null {
  const r = body as RawRelease | null
  if (!r || typeof r.tag_name !== 'string' || typeof r.html_url !== 'string' || r.draft || r.prerelease) return null
  const dmgFor = (suffix: string) => r.assets?.find((a) => typeof a.name === 'string' && a.name.endsWith(`-${suffix}.dmg`))
  const dmg = dmgFor(arch) ?? dmgFor('universal')
  const sums = r.assets?.find((a) => a.name === 'SHA256SUMS.txt')
  return {
    version: r.tag_name.replace(/^v/, ''),
    releaseUrl: r.html_url,
    downloadUrl: dmg?.browser_download_url ?? null,
    assetName: dmg?.name ?? null,
    checksumsUrl: sums?.browser_download_url ?? null
  }
}

/** Parses `shasum -a 256` output ("<hex>  <name>", also "<hex> *<name>"), tolerating CRLF. */
export function parseChecksums(text: string): Record<string, string> {
  const sums: Record<string, string> = {}
  for (const line of text.split(/\r?\n/)) {
    const m = /^([0-9a-f]{64})\s+\*?(.+)$/i.exec(line.trim())
    if (m) sums[m[2].trim()] = m[1].toLowerCase()
  }
  return sums
}

export function verifyChecksum(sums: Record<string, string>, name: string, hex: string): 'ok' | 'mismatch' | 'missing' {
  const expected = sums[name]
  if (!expected) return 'missing'
  return expected === hex.toLowerCase() ? 'ok' : 'mismatch'
}

export function sha256File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    createReadStream(path)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')))
  })
}

export interface UpdateInstallerDeps {
  /** Folder for downloads; emptied by the caller at startup. */
  dir: string
  download(url: string, dest: string, onProgress: (percent: number | null) => void, signal: AbortSignal): Promise<void>
  fetchText(url: string, signal: AbortSignal): Promise<string>
  sha256(path: string): Promise<string>
  /** Opens the dmg (macOS mounts it and shows the Finder window). */
  openPath(path: string): Promise<void>
  removeFile(path: string): void
  joinPath(dir: string, name: string): string
  onChange(state: InstallState): void
  log: Logger
}

/**
 * Downloads the release's dmg, verifies it against SHA256SUMS.txt and opens it. A download
 * that doesn't match is deleted. Without checksums nothing is installed.
 */
export class UpdateInstaller {
  private current: InstallState = { phase: 'idle' }
  private controller: AbortController | null = null

  constructor(private readonly deps: UpdateInstallerDeps) {}

  get state(): InstallState {
    return this.current
  }

  async install(info: UpdateInfo): Promise<void> {
    if (this.current.phase === 'downloading' || this.current.phase === 'verifying') return
    if (!info.downloadUrl || !info.assetName) return this.set({ phase: 'error', code: 'unavailable' })
    this.controller?.abort()
    const controller = new AbortController()
    this.controller = controller
    const dest = this.deps.joinPath(this.deps.dir, info.assetName)
    this.set({ phase: 'downloading', percent: null })
    try {
      if (!info.checksumsUrl) throw new ChecksumError('the release has no SHA256SUMS.txt')
      const sums = parseChecksums(await this.deps.fetchText(info.checksumsUrl, controller.signal))
      controller.signal.throwIfAborted()
      if (!sums[info.assetName]) throw new ChecksumError('the dmg is not listed in SHA256SUMS.txt')
      await this.deps.download(info.downloadUrl, dest, (percent) => this.set({ phase: 'downloading', percent }), controller.signal)
      controller.signal.throwIfAborted()
      this.set({ phase: 'verifying' })
      const hex = await this.deps.sha256(dest)
      if (verifyChecksum(sums, info.assetName, hex) !== 'ok') {
        this.deps.removeFile(dest)
        throw new ChecksumError(`SHA-256 mismatch for ${info.assetName}`)
      }
      this.deps.log.info('update downloaded and verified', { version: info.version, path: dest })
      this.set({ phase: 'ready', path: dest })
      await this.deps.openPath(dest)
    } catch (err) {
      if (this.controller !== controller) return
      const code = installErrorCode(err, controller.signal.aborted)
      if (code !== 'cancelled') this.deps.log.warn('update install failed', err)
      this.set({ phase: 'error', code })
    }
  }

  cancel(): void {
    this.controller?.abort()
  }

  /** Opens the dmg again (e.g. the user closed the Finder window). */
  async openInstaller(): Promise<void> {
    if (this.current.phase === 'ready') await this.deps.openPath(this.current.path)
  }

  private set(state: InstallState): void {
    this.current = state
    this.deps.onChange(state)
  }
}

class ChecksumError extends Error {}

function installErrorCode(err: unknown, aborted: boolean): InstallErrorCode {
  if (aborted) return 'cancelled'
  if (err instanceof ChecksumError) return 'checksum'
  const code = (err as { code?: string } | null)?.code
  if (typeof code === 'string' && /^E[A-Z]+$/.test(code) && code !== 'ECONNRESET' && code !== 'ETIMEDOUT' && code !== 'ENOTFOUND') return 'io'
  return 'network'
}

export async function fetchLatestRelease(
  repo: string,
  etag: string | null,
  arch: string,
  fetchFn: FetchFn = fetch
): Promise<ReleaseCheck> {
  const res = await fetchFn(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'pr-radar',
      ...(etag ? { 'If-None-Match': etag } : {})
    },
    signal: AbortSignal.timeout(20_000)
  })
  if (res.status === 304) return { release: null, etag, notModified: true }
  // 404: no published release yet, or the repository is private.
  if (res.status === 404) return { release: null, etag: null, notModified: false }
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`)
  return { release: parseRelease(await res.json(), arch), etag: res.headers.get('etag'), notModified: false }
}

export interface UpdateCheckerState {
  skippedVersion?: string
  notifiedVersion?: string
  lastCheckAt?: number
  etag?: string | null
  /** Last release seen, kept so a 304 can still report it. */
  latest?: UpdateInfo | null
}

export interface UpdateCheckerDeps {
  repo: string
  currentVersion: string
  now(): number
  load(): UpdateCheckerState
  save(state: UpdateCheckerState): void
  fetchLatest(repo: string, etag: string | null): Promise<ReleaseCheck>
  log: Logger
}

export const CHECK_INTERVAL_MS = 6 * 3_600_000

export class UpdateChecker {
  private state: UpdateCheckerState

  constructor(private readonly deps: UpdateCheckerDeps) {
    this.state = deps.load()
  }

  /** The update to show, unless it's not newer or the user skipped it. */
  get available(): UpdateInfo | null {
    const latest = this.state.latest
    if (!latest || !isNewer(latest.version, this.deps.currentVersion)) return null
    if (this.state.skippedVersion === latest.version) return null
    return latest
  }

  /** Whether a check is due (at most every 6 h unless forced). */
  due(): boolean {
    return !this.state.lastCheckAt || this.deps.now() - this.state.lastCheckAt >= CHECK_INTERVAL_MS
  }

  /** Checks GitHub; returns the update to announce if it hasn't been announced yet. */
  async check(force = false): Promise<UpdateInfo | null> {
    if (!force && !this.due()) return null
    try {
      const result = await this.deps.fetchLatest(this.deps.repo, this.state.etag ?? null)
      const latest = result.notModified ? (this.state.latest ?? null) : result.release
      this.update({ lastCheckAt: this.deps.now(), etag: result.etag, latest })
    } catch (err) {
      this.deps.log.warn('update check failed', err)
      this.update({ lastCheckAt: this.deps.now() })
      return null
    }
    const available = this.available
    if (!available || this.state.notifiedVersion === available.version) return null
    this.update({ notifiedVersion: available.version })
    this.deps.log.info('update available', { version: available.version })
    return available
  }

  skip(version: string): void {
    this.update({ skippedVersion: version })
  }

  private update(patch: Partial<UpdateCheckerState>): void {
    this.state = { ...this.state, ...patch }
    this.deps.save(this.state)
  }
}

/** Only open links into this repository's releases. */
export function isReleaseUrl(url: string, repo: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && u.hostname === 'github.com' && u.pathname.startsWith(`/${repo}/releases/`)
  } catch {
    return false
  }
}

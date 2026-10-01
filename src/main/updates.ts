/**
 * "A new version is available" notice. Without an Apple Developer ID the app can't update
 * itself (Squirrel.Mac needs a signed app), so it points to the GitHub release instead.
 * Electron-free; index.ts wires it up.
 */
import type { Logger } from './log'

export interface UpdateInfo {
  version: string
  releaseUrl: string
  /** Direct link to the macOS dmg, when the release has one. */
  downloadUrl: string | null
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

export function parseRelease(body: unknown): UpdateInfo | null {
  const r = body as RawRelease | null
  if (!r || typeof r.tag_name !== 'string' || typeof r.html_url !== 'string' || r.draft || r.prerelease) return null
  const dmg = r.assets?.find((a) => typeof a.name === 'string' && /-universal\.dmg$/.test(a.name))
  return {
    version: r.tag_name.replace(/^v/, ''),
    releaseUrl: r.html_url,
    downloadUrl: dmg?.browser_download_url ?? null
  }
}

export async function fetchLatestRelease(repo: string, etag: string | null, fetchFn: FetchFn = fetch): Promise<ReleaseCheck> {
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
  return { release: parseRelease(await res.json()), etag: res.headers.get('etag'), notModified: false }
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

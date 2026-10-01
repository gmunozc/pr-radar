import { appendFileSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { dirname } from 'node:path'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LogEntry {
  time: string
  level: LogLevel
  message: string
}

export interface Logger {
  debug(message: string, data?: unknown): void
  info(message: string, data?: unknown): void
  warn(message: string, data?: unknown): void
  error(message: string, data?: unknown): void
}

const PATTERNS: Array<[RegExp, string]> = [
  [/\b(gh[opsur]_)[A-Za-z0-9_]{8,}/g, '$1***'],
  [/\bgithub_pat_[A-Za-z0-9_]{8,}/g, 'github_pat_***'],
  [/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1***'],
  [/((?:access|refresh)_token["']?\s*[:=]\s*["']?)[^"'&\s,}]+/gi, '$1***'],
  [/("(?:accessToken|refreshToken)"\s*:\s*")[^"]*/g, '$1***']
]

/** Removes anything that looks like a GitHub token. Applied to every log line and to diagnostics. */
export function redact(text: string): string {
  return PATTERNS.reduce((out, [re, replacement]) => out.replace(re, replacement), text)
}

function stringify(data: unknown): string {
  if (data === undefined) return ''
  if (data instanceof Error) return ` ${data.name}: ${data.message}`
  try {
    return ` ${JSON.stringify(data)}`
  } catch {
    return ` ${String(data)}`
  }
}

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 }

export interface FileLoggerOptions {
  file: string
  /** Rotate when the file grows beyond this size. */
  maxBytes?: number
  /** Number of rotated files kept (pr-radar.log.1 … .N). */
  keep?: number
  minLevel?: LogLevel
  echo?: boolean
}

/**
 * Small synchronous logger: appends to a file with size-based rotation and keeps the
 * latest entries in memory for diagnostics. Works before `init` (memory + console only).
 */
export class AppLogger implements Logger {
  private options: Required<FileLoggerOptions> | null = null
  private readonly entries: LogEntry[] = []

  constructor(private readonly memorySize = 200) {}

  init(options: FileLoggerOptions): void {
    this.options = { maxBytes: 1024 * 1024, keep: 3, minLevel: 'info', echo: false, ...options }
    mkdirSync(dirname(options.file), { recursive: true })
  }

  get file(): string | null {
    return this.options?.file ?? null
  }

  debug(message: string, data?: unknown): void {
    this.write('debug', message, data)
  }
  info(message: string, data?: unknown): void {
    this.write('info', message, data)
  }
  warn(message: string, data?: unknown): void {
    this.write('warn', message, data)
  }
  error(message: string, data?: unknown): void {
    this.write('error', message, data)
  }

  /** Latest entries, oldest first, optionally only warnings and errors. */
  recent(count = 50, minLevel: LogLevel = 'debug'): LogEntry[] {
    return this.entries.filter((e) => LEVEL_ORDER[e.level] >= LEVEL_ORDER[minLevel]).slice(-count)
  }

  private write(level: LogLevel, message: string, data?: unknown): void {
    const minLevel = this.options?.minLevel ?? 'info'
    if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) return
    const entry: LogEntry = { time: new Date().toISOString(), level, message: redact(message + stringify(data)) }
    this.entries.push(entry)
    if (this.entries.length > this.memorySize) this.entries.splice(0, this.entries.length - this.memorySize)

    const line = `${entry.time} ${level.toUpperCase().padEnd(5)} ${entry.message}\n`
    if (!this.options || this.options.echo) {
      ;(level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)(line.trimEnd())
    }
    if (!this.options) return
    try {
      this.rotateIfNeeded(line.length)
      appendFileSync(this.options.file, line, { mode: 0o600 })
    } catch {
      // Logging must never break the app.
    }
  }

  private rotateIfNeeded(incoming: number): void {
    const { file, maxBytes, keep } = this.options!
    let size = 0
    try {
      size = statSync(file).size
    } catch {
      return
    }
    if (size + incoming <= maxBytes) return
    rmSync(`${file}.${keep}`, { force: true })
    for (let i = keep - 1; i >= 1; i--) {
      try {
        renameSync(`${file}.${i}`, `${file}.${i + 1}`)
      } catch {
        // Missing rotated file: nothing to shift.
      }
    }
    renameSync(file, `${file}.1`)
  }
}

/** App-wide logger; `index.ts` points it at userData/logs on startup. */
export const logger = new AppLogger()

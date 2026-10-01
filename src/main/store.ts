import { readFileSync, writeFileSync, renameSync, rmSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'

/** Minimal JSON file store with atomic writes. */
export class JsonFile<T> {
  constructor(
    private readonly path: string,
    private readonly fallback: () => T
  ) {}

  read(): T {
    try {
      return JSON.parse(readFileSync(this.path, 'utf8')) as T
    } catch {
      return this.fallback()
    }
  }

  write(value: T): void {
    mkdirSync(dirname(this.path), { recursive: true })
    const tmp = `${this.path}.tmp`
    writeFileSync(tmp, JSON.stringify(value, null, 2))
    renameSync(tmp, this.path)
  }

  remove(): void {
    rmSync(this.path, { force: true })
  }
}

export function storePath(userData: string, name: string): string {
  return join(userData, name)
}

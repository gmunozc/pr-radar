import { app, clipboard, safeStorage, shell } from 'electron'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AuthStatus } from '../shared/types'
import { DeviceFlowError, pollForToken, requestDeviceCode } from './deviceFlow'

const tokenFile = () => join(app.getPath('userData'), 'auth.bin')
const plainMarker = Buffer.from('PLAIN:')

export function loadToken(): string | null {
  const file = tokenFile()
  if (!existsSync(file)) return null
  try {
    const raw = readFileSync(file)
    if (raw.subarray(0, plainMarker.length).equals(plainMarker)) {
      return raw.subarray(plainMarker.length).toString('utf8')
    }
    return safeStorage.decryptString(raw)
  } catch (err) {
    console.error('[auth] could not read stored token', err)
    return null
  }
}

export function saveToken(token: string): void {
  if (safeStorage.isEncryptionAvailable()) {
    writeFileSync(tokenFile(), safeStorage.encryptString(token), { mode: 0o600 })
  } else {
    console.warn('[auth] OS encryption unavailable, storing token unencrypted')
    writeFileSync(tokenFile(), Buffer.concat([plainMarker, Buffer.from(token, 'utf8')]), { mode: 0o600 })
  }
}

export function clearToken(): void {
  rmSync(tokenFile(), { force: true })
}

export class DeviceLogin {
  private controller: AbortController | null = null

  constructor(private readonly onStatus: (status: AuthStatus) => void) {}

  get running(): boolean {
    return this.controller !== null
  }

  /** Runs the whole device flow; resolves with the token, or null if it failed or was cancelled. */
  async start(clientId: string): Promise<string | null> {
    this.cancel()
    const controller = new AbortController()
    this.controller = controller
    try {
      const code = await requestDeviceCode(clientId)
      clipboard.writeText(code.userCode)
      this.onStatus({
        phase: 'waiting',
        userCode: code.userCode,
        verificationUri: code.verificationUri,
        expiresAt: Date.now() + code.expiresIn * 1000
      })
      await shell.openExternal(code.verificationUri)
      const token = await pollForToken(clientId, code, { signal: controller.signal })
      saveToken(token)
      this.onStatus({ phase: 'success' })
      return token
    } catch (err) {
      if (err instanceof DeviceFlowError && err.code === 'cancelled') {
        this.onStatus({ phase: 'idle' })
      } else {
        this.onStatus({ phase: 'error', message: (err as Error).message })
      }
      return null
    } finally {
      if (this.controller === controller) this.controller = null
    }
  }

  cancel(): void {
    this.controller?.abort()
    this.controller = null
  }
}

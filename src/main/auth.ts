import { clipboard, safeStorage, shell } from 'electron'
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import type { AuthStatus } from '../shared/types'
import { DeviceFlowError, pollForToken, requestDeviceCode, type TokenSet } from './deviceFlow'
import type { Logger } from './log'
import { parseStoredAuth, serializeAuth, type AuthStore, type StoredAuth } from './session'

const plainMarker = Buffer.from('PLAIN:')

export interface FileAuthStore extends AuthStore {
  /** Set when auth.bin exists but could not be decrypted (e.g. Keychain access denied). */
  readonly readError: 'keychain_denied' | null
}

/**
 * auth.bin holds the session as JSON, encrypted with a key kept in the OS keychain
 * (safeStorage). Falls back to plain text where no OS encryption is available.
 */
export function createAuthStore(
  file: string,
  legacyClientId: () => string,
  log: Logger,
  options: { plain?: boolean } = {}
): FileAuthStore {
  let readError: 'keychain_denied' | null = null
  return {
    get readError() {
      return readError
    },
    load(): StoredAuth | null {
      readError = null
      if (!existsSync(file)) return null
      let plaintext: string
      try {
        const raw = readFileSync(file)
        plaintext = raw.subarray(0, plainMarker.length).equals(plainMarker)
          ? raw.subarray(plainMarker.length).toString('utf8')
          : safeStorage.decryptString(raw)
      } catch (err) {
        readError = 'keychain_denied'
        log.error('could not decrypt auth.bin', err)
        return null
      }
      const auth = parseStoredAuth(plaintext, legacyClientId())
      if (!auth) log.warn('auth.bin has unexpected contents, ignoring it')
      return auth
    },
    save(auth: StoredAuth): void {
      const json = serializeAuth(auth)
      let data: Buffer
      if (!options.plain && safeStorage.isEncryptionAvailable()) {
        data = safeStorage.encryptString(json)
      } else {
        if (!options.plain) log.warn('OS encryption unavailable, storing the session unencrypted')
        data = Buffer.concat([plainMarker, Buffer.from(json, 'utf8')])
      }
      // Atomic: a half-written file would lose the (rotating) refresh token.
      const tmp = `${file}.tmp`
      writeFileSync(tmp, data, { mode: 0o600 })
      renameSync(tmp, file)
    },
    clear(): void {
      rmSync(file, { force: true })
    }
  }
}

export class DeviceLogin {
  private controller: AbortController | null = null

  constructor(private readonly onStatus: (status: AuthStatus) => void) {}

  get running(): boolean {
    return this.controller !== null
  }

  /** Runs the whole device flow; resolves with the tokens, or null if it failed or was cancelled. */
  async start(clientId: string): Promise<TokenSet | null> {
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
      const tokens = await pollForToken(clientId, code, { signal: controller.signal })
      this.onStatus({ phase: 'success' })
      return tokens
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

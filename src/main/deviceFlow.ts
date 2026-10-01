/**
 * GitHub OAuth Device Flow, free of Electron APIs so it can be unit tested.
 * https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow
 */

export const DEVICE_CODE_URL = 'https://github.com/login/device/code'
export const ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token'
export const SCOPES = 'repo read:org'

export interface DeviceCode {
  deviceCode: string
  userCode: string
  verificationUri: string
  expiresIn: number
  interval: number
}

/**
 * Tokens from GitHub. When the OAuth/GitHub App has "Expire user access tokens" enabled,
 * the access token lasts 8 h and comes with a refresh token (~6 months).
 */
export interface TokenSet {
  accessToken: string
  /** Epoch ms, or null when the token does not expire. */
  expiresAt: number | null
  refreshToken: string | null
  refreshTokenExpiresAt: number | null
}

export class DeviceFlowError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'DeviceFlowError'
  }
}

type FetchFn = typeof fetch
type SleepFn = (ms: number, signal?: AbortSignal) => Promise<void>

const defaultSleep: SleepFn = (ms, signal) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(new DeviceFlowError('cancelled', 'Sign-in cancelled'))
      },
      { once: true }
    )
  })

async function postForm(fetchFn: FetchFn, url: string, params: Record<string, string>, signal?: AbortSignal) {
  let res: Response
  try {
    res = await fetchFn(url, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString(),
      signal
    })
  } catch (err) {
    if (signal?.aborted) throw new DeviceFlowError('cancelled', 'Sign-in cancelled')
    throw new DeviceFlowError('network', `Could not reach GitHub (${(err as Error).message})`)
  }
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok && !body.error) {
    throw new DeviceFlowError('http', `GitHub answered ${res.status}`)
  }
  return body
}

export async function requestDeviceCode(clientId: string, fetchFn: FetchFn = fetch): Promise<DeviceCode> {
  const body = await postForm(fetchFn, DEVICE_CODE_URL, { client_id: clientId, scope: SCOPES })
  if (body.error) {
    if (body.error === 'device_flow_disabled') {
      throw new DeviceFlowError('device_flow_disabled', 'The OAuth App does not have "Enable Device Flow" turned on')
    }
    // GitHub answers 404 "Not Found" for client IDs that don't exist.
    if (body.error === 'Not Found' || body.error === 'incorrect_client_credentials') {
      throw new DeviceFlowError('invalid_client', 'No OAuth App exists with that client ID')
    }
    throw new DeviceFlowError(String(body.error), String(body.error_description ?? body.error))
  }
  return {
    deviceCode: String(body.device_code),
    userCode: String(body.user_code),
    verificationUri: String(body.verification_uri),
    expiresIn: Number(body.expires_in),
    interval: Number(body.interval) || 5
  }
}

export function parseTokenResponse(body: Record<string, unknown>, now: number): TokenSet | null {
  if (typeof body.access_token !== 'string' || body.access_token === '') return null
  const seconds = (v: unknown) => (typeof v === 'number' || typeof v === 'string') && Number(v) > 0 ? Number(v) : null
  const expiresIn = seconds(body.expires_in)
  const refreshExpiresIn = seconds(body.refresh_token_expires_in)
  const refreshToken = typeof body.refresh_token === 'string' && body.refresh_token !== '' ? body.refresh_token : null
  return {
    accessToken: body.access_token,
    expiresAt: expiresIn === null ? null : now + expiresIn * 1000,
    refreshToken,
    refreshTokenExpiresAt: refreshToken && refreshExpiresIn !== null ? now + refreshExpiresIn * 1000 : null
  }
}

export async function pollForToken(
  clientId: string,
  code: DeviceCode,
  opts: { fetchFn?: FetchFn; sleep?: SleepFn; signal?: AbortSignal; now?: () => number } = {}
): Promise<TokenSet> {
  const fetchFn = opts.fetchFn ?? fetch
  const sleep = opts.sleep ?? defaultSleep
  const now = opts.now ?? Date.now
  const deadline = now() + code.expiresIn * 1000
  let intervalSec = code.interval

  while (now() < deadline) {
    await sleep(intervalSec * 1000, opts.signal)
    const body = await postForm(
      fetchFn,
      ACCESS_TOKEN_URL,
      {
        client_id: clientId,
        device_code: code.deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
      },
      opts.signal
    )
    const tokens = parseTokenResponse(body, now())
    if (tokens) return tokens

    switch (body.error) {
      case 'authorization_pending':
        continue
      case 'slow_down':
        intervalSec = Number(body.interval) || intervalSec + 5
        continue
      case 'expired_token':
        throw new DeviceFlowError('expired_token', 'The device code expired')
      case 'access_denied':
        throw new DeviceFlowError('access_denied', 'Authorization denied on GitHub')
      default:
        throw new DeviceFlowError(
          String(body.error ?? 'unknown'),
          String(body.error_description ?? body.error ?? 'Unknown GitHub error')
        )
    }
  }
  throw new DeviceFlowError('expired_token', 'The device code expired')
}

/**
 * Exchanges a refresh token for a new token pair. No client secret: GitHub does not
 * require it for tokens obtained through the device flow.
 */
export async function refreshAccessToken(
  clientId: string,
  refreshToken: string,
  opts: { fetchFn?: FetchFn; now?: () => number } = {}
): Promise<TokenSet> {
  const now = opts.now ?? Date.now
  const body = await postForm(opts.fetchFn ?? fetch, ACCESS_TOKEN_URL, {
    client_id: clientId,
    grant_type: 'refresh_token',
    refresh_token: refreshToken
  })
  const tokens = parseTokenResponse(body, now())
  if (tokens) return tokens

  const error = String(body.error ?? 'unknown')
  const description = String(body.error_description ?? error)
  if (error === 'bad_refresh_token') throw new DeviceFlowError('bad_refresh_token', description)
  // The app would need its client secret to refresh (or the client ID is wrong).
  if (['incorrect_client_credentials', 'unauthorized_client', 'invalid_client', 'Not Found'].includes(error)) {
    throw new DeviceFlowError('refresh_unsupported', description)
  }
  throw new DeviceFlowError(error, description)
}

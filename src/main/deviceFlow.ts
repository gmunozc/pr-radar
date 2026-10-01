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
        reject(new DeviceFlowError('cancelled', 'Inicio de sesión cancelado'))
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
    if (signal?.aborted) throw new DeviceFlowError('cancelled', 'Inicio de sesión cancelado')
    throw new DeviceFlowError('network', `No se pudo contactar con GitHub (${(err as Error).message})`)
  }
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok && !body.error) {
    throw new DeviceFlowError('http', `GitHub respondió ${res.status}`)
  }
  return body
}

export async function requestDeviceCode(clientId: string, fetchFn: FetchFn = fetch): Promise<DeviceCode> {
  const body = await postForm(fetchFn, DEVICE_CODE_URL, { client_id: clientId, scope: SCOPES })
  if (body.error) {
    if (body.error === 'device_flow_disabled') {
      throw new DeviceFlowError('device_flow_disabled', 'La OAuth App no tiene activado "Enable Device Flow".')
    }
    // GitHub answers 404 "Not Found" for client IDs that don't exist.
    if (body.error === 'Not Found' || body.error === 'incorrect_client_credentials') {
      throw new DeviceFlowError('invalid_client', 'Client ID no válido: no existe ninguna OAuth App con ese ID.')
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

export async function pollForToken(
  clientId: string,
  code: DeviceCode,
  opts: { fetchFn?: FetchFn; sleep?: SleepFn; signal?: AbortSignal; now?: () => number } = {}
): Promise<string> {
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
    if (typeof body.access_token === 'string') return body.access_token

    switch (body.error) {
      case 'authorization_pending':
        continue
      case 'slow_down':
        intervalSec = Number(body.interval) || intervalSec + 5
        continue
      case 'expired_token':
        throw new DeviceFlowError('expired_token', 'El código expiró. Vuelve a intentarlo.')
      case 'access_denied':
        throw new DeviceFlowError('access_denied', 'Autorización denegada en GitHub.')
      default:
        throw new DeviceFlowError(
          String(body.error ?? 'unknown'),
          String(body.error_description ?? body.error ?? 'Error desconocido de GitHub')
        )
    }
  }
  throw new DeviceFlowError('expired_token', 'El código expiró. Vuelve a intentarlo.')
}

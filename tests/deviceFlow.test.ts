import { describe, expect, it, vi } from 'vitest'
import { DeviceFlowError, pollForToken, requestDeviceCode, type DeviceCode } from '../src/main/deviceFlow'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const code: DeviceCode = {
  deviceCode: 'dev-123',
  userCode: 'ABCD-1234',
  verificationUri: 'https://github.com/login/device',
  expiresIn: 900,
  interval: 5
}

describe('requestDeviceCode', () => {
  it('requests a code with the expected scopes', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      json({
        device_code: 'dev-123',
        user_code: 'ABCD-1234',
        verification_uri: 'https://github.com/login/device',
        expires_in: 900,
        interval: 5
      })
    )
    const result = await requestDeviceCode('client-1', fetchFn)
    expect(result).toEqual(code)
    const body = new URLSearchParams(fetchFn.mock.calls[0][1].body)
    expect(body.get('client_id')).toBe('client-1')
    expect(body.get('scope')).toBe('repo read:org')
  })

  it('explains a disabled device flow', async () => {
    const fetchFn = vi.fn().mockResolvedValue(json({ error: 'device_flow_disabled' }, 400))
    await expect(requestDeviceCode('client-1', fetchFn)).rejects.toMatchObject({
      code: 'device_flow_disabled',
      message: expect.stringContaining('Enable Device Flow')
    })
  })

  it('explains an unknown client ID', async () => {
    const fetchFn = vi.fn().mockResolvedValue(json({ error: 'Not Found' }, 404))
    await expect(requestDeviceCode('bogus', fetchFn)).rejects.toMatchObject({
      code: 'invalid_client',
      message: expect.stringContaining('Client ID no válido')
    })
  })
})

describe('pollForToken', () => {
  it('waits through pending and slow_down responses until a token arrives', async () => {
    const sleeps: number[] = []
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(json({ error: 'authorization_pending' }))
      .mockResolvedValueOnce(json({ error: 'slow_down', interval: 10 }))
      .mockResolvedValueOnce(json({ access_token: 'gho_token', token_type: 'bearer' }))

    const token = await pollForToken('client-1', code, {
      fetchFn,
      sleep: async (ms) => void sleeps.push(ms)
    })

    expect(token).toBe('gho_token')
    expect(sleeps).toEqual([5000, 5000, 10000])
    const body = new URLSearchParams(fetchFn.mock.calls[0][1].body)
    expect(body.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:device_code')
    expect(body.get('device_code')).toBe('dev-123')
  })

  it('adds 5 seconds on slow_down without an explicit interval', async () => {
    const sleeps: number[] = []
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(json({ error: 'slow_down' }))
      .mockResolvedValueOnce(json({ access_token: 'gho_token' }))
    await pollForToken('client-1', code, { fetchFn, sleep: async (ms) => void sleeps.push(ms) })
    expect(sleeps).toEqual([5000, 10000])
  })

  it('fails on expired_token and access_denied', async () => {
    const sleep = async () => {}
    await expect(
      pollForToken('c', code, { fetchFn: vi.fn().mockResolvedValue(json({ error: 'expired_token' })), sleep })
    ).rejects.toMatchObject({ code: 'expired_token' })
    await expect(
      pollForToken('c', code, { fetchFn: vi.fn().mockResolvedValue(json({ error: 'access_denied' })), sleep })
    ).rejects.toMatchObject({ code: 'access_denied' })
  })

  it('stops when the code expires locally', async () => {
    let t = 0
    const fetchFn = vi.fn().mockImplementation(async () => json({ error: 'authorization_pending' }))
    const err = await pollForToken('c', { ...code, expiresIn: 12 }, {
      fetchFn,
      now: () => t,
      sleep: async (ms) => void (t += ms)
    }).catch((e) => e)
    expect(err).toBeInstanceOf(DeviceFlowError)
    expect(err.code).toBe('expired_token')
    expect(fetchFn).toHaveBeenCalledTimes(3)
  })

  it('can be cancelled with an AbortSignal', async () => {
    const controller = new AbortController()
    const promise = pollForToken('c', { ...code, interval: 60 }, {
      fetchFn: vi.fn(),
      signal: controller.signal
    })
    controller.abort()
    await expect(promise).rejects.toMatchObject({ code: 'cancelled' })
  })
})

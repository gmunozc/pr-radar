import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Poller } from '../src/main/poller'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

const flush = () => vi.advanceTimersByTimeAsync(0)

describe('Poller', () => {
  it('runs immediately, then every interval', async () => {
    const task = vi.fn().mockResolvedValue(undefined)
    const poller = new Poller(task, () => 30)
    poller.start()
    await flush()
    expect(task).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(29_000)
    expect(task).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(task).toHaveBeenCalledTimes(2)
    poller.stop()
  })

  it('never overlaps runs and coalesces requests made during a run', async () => {
    let finish!: () => void
    const task = vi.fn(() => new Promise<void>((r) => (finish = r)))
    const poller = new Poller(task, () => 30)
    poller.start()
    await flush()
    void poller.runNow()
    void poller.runNow()
    expect(task).toHaveBeenCalledTimes(1)
    finish()
    await flush()
    expect(task).toHaveBeenCalledTimes(2)
    poller.stop()
  })

  it('enforces the minimum interval and honours retryAt', async () => {
    const task = vi.fn().mockResolvedValueOnce({ retryAt: Date.now() + 120_000 }).mockResolvedValue(undefined)
    const poller = new Poller(task, () => 1)
    poller.start()
    await flush()
    await vi.advanceTimersByTimeAsync(119_000)
    expect(task).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(task).toHaveBeenCalledTimes(2)
    // Interval of 1 s is clamped to the 15 s minimum.
    await vi.advanceTimersByTimeAsync(14_000)
    expect(task).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(task).toHaveBeenCalledTimes(3)
    poller.stop()
  })

  it('does nothing after stop', async () => {
    const task = vi.fn().mockResolvedValue(undefined)
    const poller = new Poller(task, () => 30)
    poller.start()
    await flush()
    poller.stop()
    await vi.advanceTimersByTimeAsync(120_000)
    await poller.runNow()
    expect(task).toHaveBeenCalledTimes(1)
    expect(poller.isActive).toBe(false)
  })
})

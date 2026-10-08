import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProbeResult } from '../src/main/engine'
import { Poller, probeIntervalFor, type ProbeOptions } from '../src/main/poller'

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

describe('Poller change probes', () => {
  const probeOf = (run: () => Promise<ProbeResult>, over: Partial<ProbeOptions> = {}): ProbeOptions => ({
    intervalSec: () => 5,
    run,
    ...over
  })
  const same = async (): Promise<ProbeResult> => ({ outcome: 'same' })

  it('probes between runs, runs the task at once on a change, and stretches the full interval', async () => {
    const task = vi.fn().mockResolvedValue(undefined)
    const run = vi.fn(same)
    const poller = new Poller(task, () => 30, probeOf(run))
    poller.start()
    await flush()
    expect(task).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(run).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(run).toHaveBeenCalledTimes(2)
    // The user's 30 s is only a safety net now: no full run before 2 minutes.
    await vi.advanceTimersByTimeAsync(100_000)
    expect(task).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(task).toHaveBeenCalledTimes(2)
    run.mockResolvedValueOnce({ outcome: 'changed' })
    await vi.advanceTimersByTimeAsync(5_000)
    expect(task).toHaveBeenCalledTimes(3)
    poller.stop()
  })

  it('stops probing after a failure until a full run succeeds, and waits as asked when rate limited', async () => {
    const task = vi.fn().mockResolvedValue(undefined)
    const run = vi.fn(same).mockResolvedValueOnce({ outcome: 'failed' })
    const poller = new Poller(task, () => 30, probeOf(run))
    poller.start()
    await flush()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(run).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(run).toHaveBeenCalledTimes(1)
    // t = 120 s: the full run succeeds and probes resume.
    await vi.advanceTimersByTimeAsync(55_000)
    expect(task).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(run).toHaveBeenCalledTimes(2)
    run.mockResolvedValueOnce({ outcome: 'failed', retryAt: Date.now() + 40_000 })
    await vi.advanceTimersByTimeAsync(5_000)
    expect(run).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(25_000)
    expect(run).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(run).toHaveBeenCalledTimes(4)
    poller.stop()
  })

  it('waits while the user is away, and does not probe at all when turned off', async () => {
    const task = vi.fn().mockResolvedValue(undefined)
    const run = vi.fn(same)
    let away = true
    const poller = new Poller(task, () => 30, probeOf(run, { paused: () => away }))
    poller.start()
    await flush()
    await vi.advanceTimersByTimeAsync(20_000)
    expect(run).not.toHaveBeenCalled()
    away = false
    await vi.advanceTimersByTimeAsync(5_000)
    expect(run).toHaveBeenCalledTimes(1)
    poller.stop()

    run.mockClear()
    task.mockClear()
    const off = new Poller(task, () => 30, probeOf(run, { intervalSec: () => 0 }))
    off.start()
    await flush()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(run).not.toHaveBeenCalled()
    expect(task).toHaveBeenCalledTimes(2)
    off.stop()
  })

  it('re-arms the timers when the settings change', async () => {
    const task = vi.fn().mockResolvedValue(undefined)
    const run = vi.fn(same)
    let every = 0
    const poller = new Poller(task, () => 30, probeOf(run, { intervalSec: () => every }))
    poller.start()
    await flush()
    every = 5
    poller.refresh()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(run).toHaveBeenCalledTimes(1)
    every = 0
    poller.refresh()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(run).toHaveBeenCalledTimes(1)
    expect(task).toHaveBeenCalledTimes(2)
    poller.stop()
  })
})

describe('probeIntervalFor', () => {
  it('slows probes down on battery and keeps them off when fast mode is off', () => {
    expect(probeIntervalFor(5, false)).toBe(5)
    expect(probeIntervalFor(5, true)).toBe(10)
    expect(probeIntervalFor(10, true)).toBe(10)
    expect(probeIntervalFor(0, true)).toBe(0)
  })
})

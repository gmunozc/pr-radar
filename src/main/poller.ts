import { FULL_POLL_WITH_FAST_SEC, MIN_POLL_INTERVAL_SEC } from '../shared/types'
import type { ProbeResult } from './engine'
import { logger } from './log'

/** Probes never run closer together than this, whatever the settings say. */
export const MIN_PROBE_INTERVAL_SEC = 3
/** On battery, probes slow down to this cadence (seconds) however fast the settings ask for. */
export const PROBE_INTERVAL_ON_BATTERY_SEC = 10

/** Seconds between probes for the settings' cadence and the power source; 0 keeps probes off. */
export function probeIntervalFor(fastPoll: number, onBattery: boolean): number {
  if (fastPoll <= 0) return 0
  return onBattery ? Math.max(fastPoll, PROBE_INTERVAL_ON_BATTERY_SEC) : fastPoll
}

/** The fast mode: cheap change probes between full runs. */
export interface ProbeOptions {
  /** Seconds between probes; 0 turns them off. Read before each probe, so settings apply at once. */
  intervalSec: () => number
  /** The cheap check; `changed` makes the full task run right away. */
  run: () => Promise<ProbeResult>
  /** While true, probes wait (the user has been away for a while); full runs continue. */
  paused?: () => boolean
}

/**
 * Runs `task` repeatedly with a fixed delay between the end of one run and the start of the
 * next, so requests never overlap. A task that returns an object failed (with `retryAt` when
 * GitHub asked to wait); one that returns nothing succeeded.
 *
 * With `probe`, a cheap check runs every few seconds in between and a change triggers the task
 * at once; the task's own cadence then stretches to FULL_POLL_WITH_FAST_SEC as a safety net.
 */
export class Poller {
  private timer: NodeJS.Timeout | null = null
  private probeTimer: NodeJS.Timeout | null = null
  private running = false
  private probing = false
  private stopped = true
  private pendingRun = false
  /** A probe failed: no more probes until a full run succeeds (they would fail the same way). */
  private probesSuspended = false

  constructor(
    private readonly task: () => Promise<{ retryAt?: number } | void>,
    private readonly intervalSec: () => number,
    private readonly probe?: ProbeOptions
  ) {}

  start(): void {
    this.stopped = false
    void this.runNow()
  }

  stop(): void {
    this.stopped = true
    this.clearTimers()
  }

  get isActive(): boolean {
    return !this.stopped
  }

  /** Settings changed: re-arm the timers with the new cadences. */
  refresh(): void {
    if (this.stopped || this.running) return
    this.clearTimers()
    this.schedule()
  }

  /** Triggers an immediate run and restarts the countdown. */
  async runNow(): Promise<void> {
    if (this.stopped) return
    if (this.running) {
      this.pendingRun = true
      return
    }
    this.clearTimers()
    this.running = true
    let retryAt: number | undefined
    let ok = false
    try {
      const result = await this.task()
      ok = result === undefined
      retryAt = result?.retryAt
    } catch (err) {
      logger.error('poll task failed', err)
    } finally {
      this.running = false
    }
    if (this.stopped) return
    if (this.pendingRun) {
      this.pendingRun = false
      void this.runNow()
      return
    }
    if (ok) this.probesSuspended = false
    this.schedule(retryAt)
  }

  private probesOn(): boolean {
    return !!this.probe && this.probe.intervalSec() > 0
  }

  private schedule(retryAt?: number): void {
    const fast = this.probesOn()
    const base = Math.max(MIN_POLL_INTERVAL_SEC, this.intervalSec(), fast ? FULL_POLL_WITH_FAST_SEC : 0) * 1000
    const delay = retryAt ? Math.max(base, retryAt - Date.now()) : base
    this.timer = setTimeout(() => void this.runNow(), delay)
    if (fast && !this.probesSuspended) this.scheduleProbe(retryAt)
  }

  private scheduleProbe(notBefore?: number): void {
    if (!this.probe) return
    const base = Math.max(MIN_PROBE_INTERVAL_SEC, this.probe.intervalSec()) * 1000
    const delay = notBefore ? Math.max(base, notBefore - Date.now()) : base
    this.probeTimer = setTimeout(() => void this.probeNow(), delay)
  }

  private async probeNow(): Promise<void> {
    this.probeTimer = null
    if (this.stopped || this.running || this.probing || !this.probe || !this.probesOn()) return
    if (this.probe.paused?.()) {
      this.scheduleProbe()
      return
    }
    this.probing = true
    let result: ProbeResult
    try {
      result = await this.probe.run()
    } catch (err) {
      logger.warn('probe failed', err)
      result = { outcome: 'failed' }
    } finally {
      this.probing = false
    }
    // A full run that started meanwhile schedules the next probe itself.
    if (this.stopped || this.running) return
    if (result.outcome === 'changed') {
      void this.runNow()
    } else if (result.outcome === 'failed' && !result.retryAt) {
      this.probesSuspended = true
    } else {
      this.scheduleProbe(result.retryAt)
    }
  }

  private clearTimers(): void {
    if (this.timer) clearTimeout(this.timer)
    if (this.probeTimer) clearTimeout(this.probeTimer)
    this.timer = null
    this.probeTimer = null
  }
}

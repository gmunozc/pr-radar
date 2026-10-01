import { MIN_POLL_INTERVAL_SEC } from '../shared/types'

/**
 * Runs `task` repeatedly with a fixed delay between the end of one run and the
 * start of the next, so requests never overlap.
 */
export class Poller {
  private timer: NodeJS.Timeout | null = null
  private running = false
  private stopped = true
  private pendingRun = false

  constructor(
    private readonly task: () => Promise<{ retryAt?: number } | void>,
    private readonly intervalSec: () => number
  ) {}

  start(): void {
    this.stopped = false
    void this.runNow()
  }

  stop(): void {
    this.stopped = true
    this.clearTimer()
  }

  get isActive(): boolean {
    return !this.stopped
  }

  /** Triggers an immediate run and restarts the countdown. */
  async runNow(): Promise<void> {
    if (this.stopped) return
    if (this.running) {
      this.pendingRun = true
      return
    }
    this.clearTimer()
    this.running = true
    let retryAt: number | undefined
    try {
      retryAt = (await this.task())?.retryAt
    } catch (err) {
      console.error('[poller] task failed', err)
    } finally {
      this.running = false
    }
    if (this.stopped) return
    if (this.pendingRun) {
      this.pendingRun = false
      void this.runNow()
      return
    }
    this.schedule(retryAt)
  }

  private schedule(retryAt?: number): void {
    const base = Math.max(MIN_POLL_INTERVAL_SEC, this.intervalSec()) * 1000
    const delay = retryAt ? Math.max(base, retryAt - Date.now()) : base
    this.timer = setTimeout(() => void this.runNow(), delay)
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }
}

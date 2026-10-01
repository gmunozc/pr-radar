/** Development-only helpers: simulate GitHub failures from the tray menu. */
import type { MenuItemConstructorOptions } from 'electron'
import { GithubError } from './github'

export type FaultMode = 'none' | 'offline' | 'unauthorized_once' | 'rate_limited_once'

export class FaultInjector {
  mode: FaultMode = 'none'

  /** Wraps a GitHub call so it fails the way `mode` says before reaching the network. */
  wrap<A extends unknown[], R>(fn: (...args: A) => Promise<R>): (...args: A) => Promise<R> {
    return async (...args: A) => {
      switch (this.mode) {
        case 'offline':
          throw new GithubError('network', 'Simulated: no connection')
        case 'unauthorized_once':
          this.mode = 'none'
          throw new GithubError('unauthorized', 'Simulated: 401')
        case 'rate_limited_once':
          this.mode = 'none'
          throw new GithubError('rate_limited', 'Simulated: rate limit', Date.now() + 60_000)
        default:
          return fn(...args)
      }
    }
  }
}

export interface DebugActions {
  faults: FaultInjector
  pollNow(): void
  renewToken(): Promise<void>
  copyDiagnostics(): void
}

export function debugMenu(a: DebugActions): MenuItemConstructorOptions[] {
  const simulate = (mode: FaultMode) => () => {
    a.faults.mode = mode
    a.pollNow()
  }
  return [
    { type: 'separator' },
    {
      label: 'Debug',
      submenu: [
        { label: 'Simulate 401 (once)', click: simulate('unauthorized_once') },
        { label: 'Simulate rate limit (once)', click: simulate('rate_limited_once') },
        {
          label: 'Simulate offline',
          type: 'checkbox',
          checked: a.faults.mode === 'offline',
          click: (item) => simulate(item.checked ? 'offline' : 'none')()
        },
        { type: 'separator' },
        { label: 'Renew token now', click: () => void a.renewToken().then(a.pollNow) },
        { label: 'Copy diagnostics', click: a.copyDiagnostics }
      ]
    }
  ]
}

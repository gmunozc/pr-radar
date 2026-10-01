import type { PrRadarApi } from '../shared/types'

declare global {
  interface Window {
    prRadar: PrRadarApi
  }
}

export {}

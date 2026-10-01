import { describe, expect, it } from 'vitest'
import { placePanel, type DisplayArea } from '../src/main/position'

// The layout reported on the developer's Mac: a 1080p monitor to the left of the built-in display.
const primary: DisplayArea = {
  id: 1,
  bounds: { x: 0, y: 0, width: 2056, height: 1329 },
  workArea: { x: 0, y: 39, width: 2056, height: 1290 }
}
const secondary: DisplayArea = {
  id: 3,
  bounds: { x: -1920, y: 0, width: 1920, height: 1080 },
  workArea: { x: -1920, y: 30, width: 1920, height: 1050 }
}
const displays = [primary, secondary]
const size = { width: 380, height: 540 }

describe('placePanel', () => {
  it('opens under the icon on the primary display', () => {
    const pos = placePanel({
      cursor: { x: 1715, y: 15 },
      displays,
      trayBounds: { x: 1690, y: 0, width: 50, height: 39 },
      size,
      platform: 'darwin'
    })
    expect(pos).toEqual({ x: 1525, y: 45, displayId: 1 })
  })

  it('opens on the secondary display when its menu bar icon is clicked', () => {
    const pos = placePanel({
      cursor: { x: -300, y: 12 },
      displays,
      trayBounds: { x: -325, y: 0, width: 50, height: 30 },
      size,
      platform: 'darwin'
    })
    expect(pos).toEqual({ x: -490, y: 36, displayId: 3 })
  })

  it('follows the cursor when the tray reports bounds on another display', () => {
    const pos = placePanel({
      cursor: { x: -300, y: 12 },
      displays,
      trayBounds: { x: 1690, y: 0, width: 50, height: 39 },
      size,
      platform: 'darwin'
    })
    expect(pos).toEqual({ x: -490, y: 36, displayId: 3 })
  })

  it('keeps the panel inside the display near its edge', () => {
    const pos = placePanel({
      cursor: { x: -20, y: 10 },
      displays,
      trayBounds: { x: -40, y: 0, width: 40, height: 30 },
      size,
      platform: 'darwin'
    })
    expect(pos.x).toBe(-386)
    expect(pos.displayId).toBe(3)
  })

  it('opens above a bottom taskbar on Windows', () => {
    const win: DisplayArea = {
      id: 1,
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      workArea: { x: 0, y: 0, width: 1920, height: 1040 }
    }
    const pos = placePanel({
      cursor: { x: 1700, y: 1060 },
      displays: [win],
      trayBounds: { x: 1690, y: 1040, width: 24, height: 40 },
      size,
      platform: 'win32'
    })
    expect(pos).toEqual({ x: 1512, y: 494, displayId: 1 })
  })

  it('uses the cursor when the tray has no bounds (Linux)', () => {
    const linux: DisplayArea = {
      id: 1,
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      workArea: { x: 0, y: 28, width: 1920, height: 1052 }
    }
    const pos = placePanel({ cursor: { x: 1800, y: 10 }, displays: [linux], size, platform: 'linux' })
    expect(pos).toEqual({ x: 1534, y: 34, displayId: 1 })
  })
})

/** Pure placement logic for the tray panel, kept free of Electron APIs so it can be tested. */

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface Point {
  x: number
  y: number
}

export interface DisplayArea {
  id: number
  bounds: Rect
  workArea: Rect
}

export interface PlacementInput {
  /** Where the cursor is when the tray icon is clicked. */
  cursor: Point
  displays: DisplayArea[]
  /** Bounds reported by the tray; may be missing (Linux) or on another display. */
  trayBounds?: Rect
  size: { width: number; height: number }
  platform: string
}

export const GAP = 6

const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max)

const contains = (r: Rect, p: Point) => p.x >= r.x && p.x < r.x + r.width && p.y >= r.y && p.y < r.y + r.height

function distanceTo(r: Rect, p: Point): number {
  const dx = Math.max(r.x - p.x, 0, p.x - (r.x + r.width))
  const dy = Math.max(r.y - p.y, 0, p.y - (r.y + r.height))
  return Math.hypot(dx, dy)
}

export function displayNearest(displays: DisplayArea[], p: Point): DisplayArea {
  return displays.reduce((best, d) => (distanceTo(d.bounds, p) < distanceTo(best.bounds, p) ? d : best))
}

/**
 * Places the panel next to the tray icon on the display that was clicked.
 *
 * With several monitors every menu bar shows the icon, but the tray may report
 * bounds on a different display than the one clicked. The cursor is always on
 * the icon at click time, so its display wins; tray bounds are only used when
 * they fall on that same display.
 */
export function placePanel(input: PlacementInput): Point & { displayId: number } {
  const { cursor, displays, trayBounds, size, platform } = input
  const display = displayNearest(displays, cursor)
  const { workArea, bounds } = display

  const trayCenter = trayBounds && { x: trayBounds.x + trayBounds.width / 2, y: trayBounds.y + trayBounds.height / 2 }
  const tray =
    trayBounds && trayCenter && trayBounds.width > 0 && trayBounds.height > 0 && contains(bounds, trayCenter)
      ? trayBounds
      : undefined

  const anchorX = tray ? tray.x + tray.width / 2 : cursor.x
  const x = clamp(Math.round(anchorX - size.width / 2), workArea.x + GAP, workArea.x + workArea.width - size.width - GAP)

  // Menu bar / top panel → open below it; taskbar at the bottom → open above it.
  const barAtTop = tray
    ? tray.y < workArea.y + workArea.height / 2
    : platform === 'darwin' || workArea.y > bounds.y || workArea.y + workArea.height === bounds.y + bounds.height
  let y: number
  if (barAtTop) {
    y = (tray ? Math.max(tray.y + tray.height, workArea.y) : workArea.y) + GAP
  } else {
    y = (tray ? Math.min(tray.y, workArea.y + workArea.height) : workArea.y + workArea.height) - size.height - GAP
  }
  y = clamp(Math.round(y), workArea.y + GAP, workArea.y + workArea.height - size.height - GAP)

  return { x, y, displayId: display.id }
}

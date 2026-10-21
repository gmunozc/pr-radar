/**
 * Pure decisions behind the tray panel's opening and closing, kept free of Electron so they can be
 * tested. `window.ts` gathers the facts (its own open flag, focus, the display, whether macOS says
 * the window is on screen) and does what these functions answer.
 */

/** Whether macOS reports the window as on screen; "unknown" until its first `show`/`hide` event. */
export type Displayed = 'yes' | 'no' | 'unknown'
export type HideReason = 'user' | 'blur' | 'offscreen' | 'none'
export type ClickSource = 'tray' | 'shortcut'
export type ClickDecision = 'show' | 'hide' | 'refocus' | 'ignore'

/** A tray click this soon after a blur hid the panel belongs to the same gesture. */
export const IGNORE_AFTER_BLUR_MS = 250
/** A blur this soon after showing is a window that never got keyboard focus, not the user leaving. */
export const SHOW_GRACE_MS = 300
/** How long after showing the panel is checked for being on screen and focused. */
export const VERIFY_MS = 300

export interface ClickInput {
  source: ClickSource
  /** The panel was shown and not hidden since: our own flag, since `isVisible()` also says "ordered in". */
  open: boolean
  /** The cursor is on the display the panel was last shown on. */
  sameDisplay: boolean
  displayed: Displayed
  msSinceHide: number
  hiddenBy: HideReason
  /** The panel was already brought back once since it was last opened by a click. */
  reshownOnce: boolean
  /** A native dialog is open over the panel. */
  keepOpen: boolean
}

/**
 * What a tray click or the shortcut does. An open panel closes, unless the user can't be seeing
 * it (another display, or macOS says it is off screen, e.g. left on another Space): then the click
 * brings it here instead of hiding something invisible, once.
 */
export function decideClick(i: ClickInput): ClickDecision {
  if (i.open) {
    if (i.keepOpen) return 'ignore'
    const lost = !i.sameDisplay || i.displayed === 'no'
    return lost && !i.reshownOnce ? 'refocus' : 'hide'
  }
  if (i.source === 'tray' && i.hiddenBy === 'blur' && i.msSinceHide < IGNORE_AFTER_BLUR_MS && i.sameDisplay) return 'ignore'
  return 'show'
}

export interface BlurInput {
  msSinceShow: number
  /** Blurs already answered with a refocus since the panel was shown. */
  blursInGrace: number
  /** The window is still the key window: the loss of focus was spurious. */
  focused: boolean
  devToolsOpen: boolean
  keepOpen: boolean
}

/** What losing focus does: hide, except right after showing, where the panel gets one more try. */
export function decideBlur(b: BlurInput): 'hide' | 'refocus' | 'keep' {
  if (b.devToolsOpen || b.keepOpen) return 'keep'
  if (b.msSinceShow >= SHOW_GRACE_MS) return 'hide'
  if (b.focused) return 'keep'
  return b.blursInGrace === 0 ? 'refocus' : 'keep'
}

export interface OffScreenInput {
  open: boolean
  /** macOS had reported the panel on screen before taking it off. */
  wasDisplayed: boolean
  keepOpen: boolean
  devToolsOpen: boolean
}

/**
 * What to do when macOS takes the panel off the screen. A panel the user was looking at goes off
 * screen when a Space switch starts (measured: ~50 ms after the gesture, while the switch itself
 * ends a second later with the blur), when Mission Control opens or when the display sleeps:
 * close it then, instead of letting it pop up again on the next Space for the blur to hide. A
 * panel that never got on screen is left to the check after showing.
 */
export function decideOffScreen(o: OffScreenInput): 'hide' | 'keep' {
  if (!o.open || !o.wasDisplayed || o.keepOpen || o.devToolsOpen) return 'keep'
  return 'hide'
}

/**
 * What a check shortly after showing found: fine, off screen, or on screen without focus. macOS
 * reports a window that reached the screen within a few ms (measured: ~45 ms), so no event by the
 * check (`unknown`) also means off screen: a key window nobody sees, left on a Space the user is
 * not on.
 */
export function showVerdict(v: { displayed: Displayed; focused: boolean }): 'ok' | 'not_displayed' | 'unfocused' {
  if (v.displayed !== 'yes') return 'not_displayed'
  return v.focused ? 'ok' : 'unfocused'
}

import { describe, expect, it } from 'vitest'
import {
  decideBlur,
  decideClick,
  decideOffScreen,
  showVerdict,
  SHOW_GRACE_MS,
  type BlurInput,
  type ClickInput,
  type OffScreenInput
} from '../src/main/panelDecision'

const click = (over: Partial<ClickInput> = {}): ClickInput => ({
  source: 'tray',
  open: false,
  sameDisplay: true,
  displayed: 'yes',
  msSinceHide: 5000,
  hiddenBy: 'user',
  reshownOnce: false,
  keepOpen: false,
  ...over
})

describe('decideClick', () => {
  it('opens a closed panel', () => {
    expect(decideClick(click())).toBe('show')
    expect(decideClick(click({ source: 'shortcut', hiddenBy: 'none', msSinceHide: 10 }))).toBe('show')
  })

  it('closes an open panel the user can see', () => {
    expect(decideClick(click({ open: true }))).toBe('hide')
    expect(decideClick(click({ open: true, displayed: 'unknown' }))).toBe('hide')
    expect(decideClick(click({ open: true, source: 'shortcut' }))).toBe('hide')
  })

  it('brings back an open panel that is on another display or off screen, once', () => {
    expect(decideClick(click({ open: true, sameDisplay: false }))).toBe('refocus')
    expect(decideClick(click({ open: true, displayed: 'no' }))).toBe('refocus')
    expect(decideClick(click({ open: true, displayed: 'no', reshownOnce: true }))).toBe('hide')
    expect(decideClick(click({ open: true, sameDisplay: false, source: 'shortcut' }))).toBe('refocus')
  })

  it('leaves a panel alone while a native dialog is open over it', () => {
    expect(decideClick(click({ open: true, keepOpen: true }))).toBe('ignore')
    expect(decideClick(click({ open: true, keepOpen: true, displayed: 'no' }))).toBe('ignore')
  })

  it('drops a tray click that belongs to the blur that just hid the panel, on the same display', () => {
    expect(decideClick(click({ hiddenBy: 'blur', msSinceHide: 100 }))).toBe('ignore')
    expect(decideClick(click({ hiddenBy: 'blur', msSinceHide: 400 }))).toBe('show')
    expect(decideClick(click({ hiddenBy: 'blur', msSinceHide: 100, sameDisplay: false }))).toBe('show')
  })

  it('only applies that rule to blurs and to the tray', () => {
    expect(decideClick(click({ hiddenBy: 'user', msSinceHide: 100 }))).toBe('show')
    expect(decideClick(click({ hiddenBy: 'none', msSinceHide: 100 }))).toBe('show')
    expect(decideClick(click({ hiddenBy: 'blur', msSinceHide: 100, source: 'shortcut' }))).toBe('show')
  })
})

const blur = (over: Partial<BlurInput> = {}): BlurInput => ({
  msSinceShow: 5000,
  blursInGrace: 0,
  focused: false,
  devToolsOpen: false,
  keepOpen: false,
  ...over
})

describe('decideBlur', () => {
  it('hides the panel when the user leaves it', () => {
    expect(decideBlur(blur())).toBe('hide')
    expect(decideBlur(blur({ msSinceShow: SHOW_GRACE_MS, focused: true }))).toBe('hide')
  })

  it('keeps it while DevTools or a native dialog are open', () => {
    expect(decideBlur(blur({ devToolsOpen: true }))).toBe('keep')
    expect(decideBlur(blur({ keepOpen: true, msSinceShow: 10 }))).toBe('keep')
  })

  it('gives a panel that loses focus right after showing one more try, then leaves it open', () => {
    expect(decideBlur(blur({ msSinceShow: 50 }))).toBe('refocus')
    expect(decideBlur(blur({ msSinceShow: 80, blursInGrace: 1 }))).toBe('keep')
  })

  it('ignores a blur right after showing when the window is still the key window', () => {
    expect(decideBlur(blur({ msSinceShow: 50, focused: true }))).toBe('keep')
  })
})

const offScreen = (over: Partial<OffScreenInput> = {}): OffScreenInput => ({
  open: true,
  wasDisplayed: true,
  keepOpen: false,
  devToolsOpen: false,
  ...over
})

describe('decideOffScreen', () => {
  it('closes a panel the user was looking at when macOS takes it off the screen (a Space switch starting)', () => {
    expect(decideOffScreen(offScreen())).toBe('hide')
  })

  it('leaves alone a panel that is closed, never got on screen, or holds a dialog or DevTools', () => {
    expect(decideOffScreen(offScreen({ open: false }))).toBe('keep')
    expect(decideOffScreen(offScreen({ wasDisplayed: false }))).toBe('keep')
    expect(decideOffScreen(offScreen({ keepOpen: true }))).toBe('keep')
    expect(decideOffScreen(offScreen({ devToolsOpen: true }))).toBe('keep')
  })
})

describe('showVerdict', () => {
  it('is fine when the panel is on screen and focused', () => {
    expect(showVerdict({ displayed: 'yes', focused: true })).toBe('ok')
  })

  it('reports a panel macOS says is off screen, whatever its focus', () => {
    expect(showVerdict({ displayed: 'no', focused: true })).toBe('not_displayed')
    expect(showVerdict({ displayed: 'no', focused: false })).toBe('not_displayed')
  })

  it('treats a panel macOS said nothing about as off screen: a shown window reports itself within ms', () => {
    expect(showVerdict({ displayed: 'unknown', focused: true })).toBe('not_displayed')
    expect(showVerdict({ displayed: 'unknown', focused: false })).toBe('not_displayed')
  })

  it('reports a panel on screen without focus', () => {
    expect(showVerdict({ displayed: 'yes', focused: false })).toBe('unfocused')
  })
})

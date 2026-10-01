/**
 * Calendar rules for quiet hours, snoozing and the daily digest. Pure and based on local time
 * (Date getters), so it follows the user's timezone and daylight-saving changes.
 */

export interface ScheduleSettings {
  /** Only notify during working hours. */
  quietHours: boolean
  /** "HH:MM", local time. */
  workStart: string
  workEnd: string
  /** Days of the week with working hours, 0 = Sunday … 6 = Saturday. */
  workDays: number[]
  digest: boolean
  digestTime: string
}

export type SnoozeOption = 'hour' | 'tomorrow'

const HOUR = 3_600_000
/** A digest missed (e.g. the Mac was asleep) is still sent within this window. */
export const DIGEST_WINDOW_MS = 4 * HOUR
/** If quiet hours end this close to the digest, both go out as one notification. */
export const MERGE_WITH_DIGEST_MS = HOUR

export function parseTime(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

const minutesOfDay = (d: Date) => d.getHours() * 60 + d.getMinutes()

/** `date` at the given "HH:MM" on the same local day. */
export function atTime(date: Date, hhmm: string): Date {
  const minutes = parseTime(hhmm)
  const d = new Date(date)
  d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0)
  return d
}

const addDays = (date: Date, days: number) => {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

/** Local calendar day, e.g. "2026-10-01". */
export function dayKey(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** Within working hours. A window that ends before it starts (22:00–06:00) wraps past midnight. */
export function isWorkingTime(date: Date, s: ScheduleSettings): boolean {
  const start = parseTime(s.workStart)
  const end = parseTime(s.workEnd)
  const now = minutesOfDay(date)
  if (start === end) return s.workDays.includes(date.getDay())
  if (start < end) return s.workDays.includes(date.getDay()) && now >= start && now < end
  // Overnight window: the part after midnight belongs to the previous day's shift.
  if (now >= start) return s.workDays.includes(date.getDay())
  if (now < end) return s.workDays.includes(addDays(date, -1).getDay())
  return false
}

export function isQuiet(date: Date, s: ScheduleSettings): boolean {
  return s.quietHours && !isWorkingTime(date, s)
}

/** When the current quiet period ends (start of the next working window), or null if not quiet. */
export function quietEndsAt(date: Date, s: ScheduleSettings): Date | null {
  if (!isQuiet(date, s) || s.workDays.length === 0) return null
  for (let i = 0; i <= 7; i++) {
    const candidate = atTime(addDays(date, i), s.workStart)
    if (candidate > date && s.workDays.includes(candidate.getDay())) return candidate
  }
  return null
}

/** The next working day (after today) at the start of working hours. */
export function nextWorkdayStart(date: Date, s: ScheduleSettings): Date {
  const days = s.workDays.length ? s.workDays : [1, 2, 3, 4, 5]
  for (let i = 1; i <= 7; i++) {
    const candidate = atTime(addDays(date, i), s.workStart)
    if (days.includes(candidate.getDay())) return candidate
  }
  return atTime(addDays(date, 1), s.workStart)
}

export function snoozeUntil(date: Date, option: SnoozeOption, s: ScheduleSettings): Date {
  return option === 'hour' ? new Date(date.getTime() + HOUR) : nextWorkdayStart(date, s)
}

/** The digest is due today, its time has passed (by less than the window) and it wasn't sent yet. */
export function digestDue(date: Date, s: ScheduleSettings, lastDigestDay: string | null): boolean {
  if (!s.digest || !s.workDays.includes(date.getDay()) || lastDigestDay === dayKey(date)) return false
  const due = atTime(date, s.digestTime)
  return date >= due && date.getTime() - due.getTime() <= DIGEST_WINDOW_MS
}

/** Whether today's digest (not sent yet) falls close enough to `when` to be merged with it. */
export function digestNear(when: Date, s: ScheduleSettings, lastDigestDay: string | null): boolean {
  if (!s.digest || !s.workDays.includes(when.getDay()) || lastDigestDay === dayKey(when)) return false
  const due = atTime(when, s.digestTime)
  return Math.abs(due.getTime() - when.getTime()) <= MERGE_WITH_DIGEST_MS || (due <= when && when.getTime() - due.getTime() <= DIGEST_WINDOW_MS)
}

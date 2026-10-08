import { describe, expect, it } from 'vitest'
import {
  dayKey,
  dailyDue,
  digestDue,
  digestNear,
  isQuiet,
  isWorkingTime,
  nextWorkdayStart,
  quietEndsAt,
  snoozeUntil,
  type ScheduleSettings
} from '../src/main/schedule'

// 2026-10-05 is a Monday. Tests run with TZ=UTC (see vitest.config.ts).
const at = (day: number, hhmm: string) => new Date(`2026-10-${String(day).padStart(2, '0')}T${hhmm}:00`)
const MON = 5
const FRI = 9
const SAT = 10

const s: ScheduleSettings = {
  quietHours: true,
  workStart: '09:00',
  workEnd: '19:00',
  workDays: [1, 2, 3, 4, 5],
  digest: true,
  digestTime: '09:30'
}

describe('working hours and quiet hours', () => {
  it('knows working time on working days', () => {
    expect(isWorkingTime(at(MON, '09:00'), s)).toBe(true)
    expect(isWorkingTime(at(MON, '18:59'), s)).toBe(true)
    expect(isWorkingTime(at(MON, '19:00'), s)).toBe(false)
    expect(isWorkingTime(at(MON, '08:59'), s)).toBe(false)
    expect(isWorkingTime(at(SAT, '12:00'), s)).toBe(false)
  })

  it('supports windows that cross midnight', () => {
    const night = { ...s, workStart: '22:00', workEnd: '06:00' }
    expect(isWorkingTime(at(MON, '23:00'), night)).toBe(true)
    // 02:00 on Saturday belongs to Friday night's shift.
    expect(isWorkingTime(at(SAT, '02:00'), night)).toBe(true)
    expect(isWorkingTime(at(SAT, '23:00'), night)).toBe(false)
    expect(isWorkingTime(at(MON, '12:00'), night)).toBe(false)
  })

  it('is never quiet when the option is off', () => {
    expect(isQuiet(at(SAT, '03:00'), { ...s, quietHours: false })).toBe(false)
    expect(isQuiet(at(SAT, '03:00'), s)).toBe(true)
  })

  it('knows when quiet hours end', () => {
    expect(quietEndsAt(at(FRI, '20:00'), s)).toEqual(at(12, '09:00'))
    expect(quietEndsAt(at(MON, '07:00'), s)).toEqual(at(MON, '09:00'))
    expect(quietEndsAt(at(MON, '10:00'), s)).toBeNull()
  })
})

describe('snooze', () => {
  it('snoozes for an hour', () => {
    expect(snoozeUntil(at(MON, '10:15'), 'hour', s)).toEqual(at(MON, '11:15'))
  })

  it('snoozes until the next working morning, skipping the weekend', () => {
    expect(snoozeUntil(at(MON, '10:15'), 'tomorrow', s)).toEqual(at(6, '09:00'))
    expect(snoozeUntil(at(FRI, '17:00'), 'tomorrow', s)).toEqual(at(12, '09:00'))
    expect(snoozeUntil(at(SAT, '11:00'), 'tomorrow', s)).toEqual(at(12, '09:00'))
    expect(nextWorkdayStart(at(MON, '01:00'), { ...s, workDays: [3] })).toEqual(at(7, '09:00'))
  })
})

describe('daily digest', () => {
  it('is due once its time has passed on a working day', () => {
    expect(digestDue(at(MON, '09:29'), s, null)).toBe(false)
    expect(digestDue(at(MON, '09:30'), s, null)).toBe(true)
    expect(digestDue(at(MON, '13:30'), s, null)).toBe(true)
  })

  it('is skipped after the 4 h window, on days off, when sent, or when disabled', () => {
    expect(digestDue(at(MON, '13:31'), s, null)).toBe(false)
    expect(digestDue(at(SAT, '09:45'), s, null)).toBe(false)
    expect(digestDue(at(MON, '09:45'), s, dayKey(at(MON, '08:00')))).toBe(false)
    expect(digestDue(at(MON, '09:45'), { ...s, digest: false }, null)).toBe(false)
  })

  it('merges with alerts held back when quiet hours end close to it', () => {
    expect(digestNear(at(MON, '09:00'), s, null)).toBe(true)
    expect(digestNear(at(MON, '09:00'), { ...s, digestTime: '15:00' }, null)).toBe(false)
    expect(digestNear(at(MON, '09:00'), s, dayKey(at(MON, '07:00')))).toBe(false)
  })

  it('uses local calendar days', () => {
    expect(dayKey(at(MON, '23:59'))).toBe('2026-10-05')
  })
})

describe('dailyDue', () => {
  it('opens the daily slot even with the digest off, while digestDue still needs it on', () => {
    const s = { quietHours: false, workStart: '09:00', workEnd: '18:00', workDays: [1, 2, 3, 4, 5], digest: false, digestTime: '09:30' }
    expect(dailyDue(at(MON, '09:30'), s, null)).toBe(true)
    expect(digestDue(at(MON, '09:30'), s, null)).toBe(false)
    expect(dailyDue(at(MON, '09:30'), s, dayKey(at(MON, '08:00')))).toBe(false)
    expect(dailyDue(at(SAT, '09:30'), s, null)).toBe(false)
  })
})

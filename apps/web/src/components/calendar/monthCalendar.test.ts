import { describe, expect, it } from 'vitest';
import {
  buildMonthCalendar,
  personalEventsOnDate,
  shiftCalendarMonth,
  filterPersonalEvents,
  buildPersonalEventsCalendar,
  type PersonalImportRecord,
} from '@campus/shared';

const event = (patch: Partial<PersonalImportRecord> = {}): PersonalImportRecord => ({
  id: 'synthetic',
  kind: 'events',
  title: '合成活動',
  schoolId: 'pu',
  academicYear: '',
  semester: '',
  date: '2024-02-28',
  endDate: '2024-03-02',
  allDay: true,
  batchId: 'test',
  importedAt: '2024-01-01T00:00:00Z',
  source: { type: 'paste', line: 1, rawText: '' },
  ...patch,
});

describe('月份日期分桶', () => {
  it('正確處理跨年、閏年、非閏年及週日欄位', () => {
    expect(shiftCalendarMonth('2024-12', 1)).toBe('2025-01');
    expect(shiftCalendarMonth('2025-01', -1)).toBe('2024-12');
    const leap = buildMonthCalendar([], '2024-02');
    expect(leap.findIndex((day) => day?.date === '2024-02-01')).toBe(4);
    expect(leap.filter(Boolean)).toHaveLength(29);
    expect(buildMonthCalendar([], '2023-02').filter(Boolean)).toHaveLength(28);
    expect(buildMonthCalendar([], '2026-11')[0]?.date).toBe('2026-11-01');
    expect(buildMonthCalendar([], '2024-13')).toEqual([]);
    expect(leap.length % 7).toBe(0);
  });
  it('全天跨月每日可見，結束日排除且不改原始紀錄', () => {
    const row = Object.freeze(event());
    const feb = buildMonthCalendar([row], '2024-02');
    expect(feb.find((day) => day?.date === '2024-02-29')?.events).toEqual([row]);
    expect(personalEventsOnDate([row], '2024-03-01')[0]).toBe(row);
    expect(personalEventsOnDate([row], '2024-03-02')).toEqual([]);
    expect(row.date).toBe('2024-02-28');
    expect(row.endDate).toBe('2024-03-02');
    expect(personalEventsOnDate([event({ endDate: undefined })], '2024-02-28')).toHaveLength(1);
    expect(personalEventsOnDate([event({ endDate: undefined })], '2024-02-29')).toEqual([]);
  });
  it('定時跨日延伸至結束日，午夜結束不佔用隔日', () => {
    const row = event({ allDay: false, startTime: '23:00', endTime: '01:00' });
    expect(personalEventsOnDate([row], '2024-03-02')).toEqual([row]);
    expect(personalEventsOnDate([{ ...row, endTime: '00:00' }], '2024-03-02')).toEqual([]);
    expect(personalEventsOnDate([event({ kind: 'timetable' })], '2024-02-28')).toEqual([]);
  });
  it('月份匯出包含跨月事件，保留完整起訖並排除其他月份', () => {
    const rows = [event(), event({ id: 'other', date: '2024-04-01', endDate: undefined })];
    const result = buildPersonalEventsCalendar(filterPersonalEvents(rows, '2024-03'));
    expect(result.eventCount).toBe(1);
    expect(result.content).toContain('DTSTART;VALUE=DATE:20240228');
    expect(result.content).toContain('DTEND;VALUE=DATE:20240302');
  });
});

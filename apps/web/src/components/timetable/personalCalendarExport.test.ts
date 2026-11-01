import { describe, expect, it } from 'vitest';
import type { PersonalImportRecord, ClassException } from '@campus/shared';
import { classMeetingKey, withClassExceptions } from '@campus/shared';
import {
  previewPersonalCalendar,
  serializePersonalCalendar,
} from '@campus/shared/src/timetable/personalCalendarExport';
const row: PersonalImportRecord = {
  id: 'one',
  batchId: 'a',
  importedAt: '',
  kind: 'timetable',
  schoolId: 'pu',
  academicYear: '115',
  semester: '1',
  title: '中文,課;程\\測試\n第二行',
  dayOfWeek: 1,
  startTime: '09:00',
  endTime: '10:00',
  location: '教室',
  source: { type: 'paste', line: 1, rawText: '' },
};
const options = { schoolId: 'pu', termKey: '115|1', start: '2026-11-02', end: '2026-11-08' };
describe('個人課表快照純函式', () => {
  it('keeps UIDs across reimports and ranges, writes escaped Unicode with UTC instants for Taipei', () => {
    const a = previewPersonalCalendar([row], options);
    const b = previewPersonalCalendar([{ ...row, id: 'new', batchId: 'b', importedAt: 'new' }], {
      ...options,
      end: '2026-11-15',
    });
    expect(a.events[0].uid).toBe(b.events[0].uid);
    const ics = serializePersonalCalendar(a).replace(/\r\n /g, '');
    expect(ics).toContain('DTSTART:20261102T010000Z');
    expect(ics).toContain('SUMMARY:中文\\,課\\;程\\\\測試\\n第二行');
    expect(ics).toContain('X-WR-TIMEZONE:Asia/Taipei');
    expect(
      serializePersonalCalendar(a)
        .split('\r\n')
        .every((line) => new TextEncoder().encode(line).length <= 75),
    ).toBe(true);
  });
  it('omits cancellations, changes rooms and includes cross-day makeup only once', () => {
    const change = (
      kind: ClassException['kind'],
      originalDate: string,
      extra = {},
    ): ClassException => ({
      id: originalDate,
      kind,
      courseKey: classMeetingKey(row),
      original: row,
      originalDate,
      createdAt: '',
      ...extra,
    });
    const records = withClassExceptions(
      [row],
      [
        change('cancel', '2026-11-02'),
        change('room', '2026-11-09', { location: '新教室' }),
        change('move', '2026-11-16', {
          date: '2026-11-07',
          endDate: '2026-11-08',
          startTime: '23:00',
          endTime: '01:00',
        }),
      ],
    );
    const result = previewPersonalCalendar(records, { ...options, end: '2026-11-16' });
    expect(result.events).toHaveLength(2);
    expect(result.events[0].endAt - result.events[0].startAt).toBe(7200000);
    expect(result.events[1].row.location).toBe('新教室');
    expect(result.events[0].uid).toBe(
      previewPersonalCalendar([row], { ...options, start: '2026-11-16', end: '2026-11-16' })
        .events[0].uid,
    );
    expect(
      previewPersonalCalendar(records, { ...options, start: '2026-11-08' }).events,
    ).toHaveLength(0);
  });
  it('lists unknown times, rejects invalid ranges and never falls back to another term', () => {
    expect(previewPersonalCalendar([{ ...row, endTime: undefined }], options).skipped).toHaveLength(
      1,
    );
    expect(previewPersonalCalendar([row], { ...options, termKey: '114|1' }).events).toHaveLength(0);
    expect(() => previewPersonalCalendar([row], { ...options, end: '2026-12-28' })).toThrow('八週');
    expect(() => previewPersonalCalendar([row], { ...options, start: '2026-02-30' })).toThrow(
      '有效',
    );
    expect(previewPersonalCalendar([row], { ...options, end: '2026-12-27' }).events).toHaveLength(
      8,
    );
  });
});

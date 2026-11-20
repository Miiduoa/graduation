import { createHash } from 'node:crypto';
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

for (const dates of [['2026-11-02'], ['2026-11-02', '2026-11-16']]) {
  it(`preserves every occurrence and untouched UIDs when ${dates.length} makeup meetings collide`, () => {
    const range = { ...options, end: '2026-11-30' };
    const before = previewPersonalCalendar([row], range);
    const changes: ClassException[] = dates.map((originalDate) => ({
      id: originalDate,
      kind: 'move',
      courseKey: classMeetingKey(row),
      original: row,
      originalDate,
      createdAt: '',
      date: '2026-11-09',
      startTime: '09:00',
      endTime: '10:00',
    }));
    const after = previewPersonalCalendar(withClassExceptions([row], changes), range);
    expect(after.events).toHaveLength(5);
    expect(new Set(after.events.map((event) => event.uid))).toEqual(
      new Set(before.events.map((event) => event.uid)),
    );
    expect(
      after.events.filter((event) => event.startAt === Date.parse('2026-11-09T09:00:00+08:00')),
    ).toHaveLength(dates.length + 1);
    for (const event of before.events.filter((event) => !dates.includes(event.originalDate))) {
      expect(after.events.find((other) => other.originalDate === event.originalDate)).toMatchObject(
        { uid: event.uid, startAt: event.startAt },
      );
    }
  });
}
it('uses a stable SHA-256 digest rather than reversible teacher and class encoding', () => {
  const privateRow = { ...row, teacher: '測試教師', className: '測試班' };
  const event = previewPersonalCalendar([privateRow], options).events[0];
  const digest = createHash('sha256')
    .update(JSON.stringify([classMeetingKey(privateRow), '2026-11-02']))
    .digest('hex');
  expect(event.uid).toBe(`personal-${digest}@nuni.tw`);
  expect(previewPersonalCalendar([{ ...privateRow, id: 'reimport' }], options).events[0].uid).toBe(
    event.uid,
  );
  const decoded = Buffer.from(digest, 'hex').toString('utf8');
  for (const value of [privateRow.teacher, privateRow.className]) {
    expect(event.uid).not.toContain(value);
    expect(decoded).not.toContain(value);
    expect(serializePersonalCalendar(previewPersonalCalendar([privateRow], options))).not.toContain(
      value,
    );
  }
});

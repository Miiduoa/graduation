import { todayClassesFromSchedule } from './todayScreen';
import { describe, expect, it } from 'vitest';
import {
  buildPersonalToday,
  assertClassExceptions,
  classMeetingKey,
  classReminderPlan,
  saveClassException,
  withClassExceptions,
  type ClassException,
  type PersonalImportRecord,
} from '@campus/shared';
import {
  planPortalReimport,
  resolvePortalReimport,
} from '@campus/shared/src/imports/portalReimport';

const row: PersonalImportRecord = {
  id: 'first-import',
  batchId: 'batch',
  importedAt: '2026-11-01T00:00:00Z',
  kind: 'timetable',
  schoolId: 'pu',
  academicYear: '115',
  semester: '1',
  title: '合成課程',
  dayOfWeek: 1,
  startPeriod: 2,
  endPeriod: 4,
  location: '原教室',
  source: { type: 'file', name: 'sample.csv', line: 2, rawText: '合成課程,一,2-4,原教室' },
};
const exception = (patch: Partial<ClassException> = {}): ClassException => ({
  id: 'change',
  courseKey: classMeetingKey(row),
  originalDate: '2026-11-02',
  kind: 'cancel',
  createdAt: '2026-11-01T01:00:00Z',
  original: row,
  ...patch,
});
const resolve = (changes: ClassException[], date = '2026-11-02', records = [row]) =>
  buildPersonalToday(withClassExceptions(records, changes), {
    schoolId: 'pu',
    now: new Date(`${date}T09:00:00+08:00`),
  });

describe('dated class exceptions', () => {
  it('cancels one date without changing the weekly source or next week', () => {
    expect(resolve([exception()]).today).toHaveLength(0);
    expect(resolve([exception()], '2026-11-09').today).toHaveLength(1);
    expect(row.source.rawText).toBe('合成課程,一,2-4,原教室');
  });
  it('changes only the selected room and detects overlap with a makeup class', () => {
    expect(resolve([exception({ kind: 'room', location: '新教室' })]).today[0].row.location).toBe(
      '新教室',
    );
    expect(
      resolve([exception({ kind: 'room', location: '新教室' })], '2026-11-09').today[0].row
        .location,
    ).toBe('原教室');
    const changes = [
      exception({
        kind: 'move',
        date: '2026-11-03',
        startTime: '18:30',
        endTime: '21:30',
        location: '夜間教室',
      }),
    ];
    expect(resolve(changes).today).toHaveLength(0);
    const another = {
      ...row,
      id: 'another',
      title: '另一課',
      dayOfWeek: 2,
      startTime: '20:00',
      endTime: '22:00',
    };
    const result = resolve(changes, '2026-11-03', [row, another]);
    expect(result.today.map((entry) => entry.conflict)).toEqual([true, true]);
    expect(result.today[0]).toMatchObject({
      startTime: '18:30',
      endTime: '21:30',
      row: { location: '夜間教室' },
    });
  });
  it('preserves spanning periods, validates dates and handles an overnight makeup on both days', () => {
    expect(resolve([]).today[0]).toMatchObject({ startTime: '09:10', endTime: '12:00' });
    expect(() => saveClassException([], exception({ originalDate: '2026-02-30' }))).toThrow();
    expect(() => saveClassException([], exception({ originalDate: '2026-11-03' }))).toThrow();
    const move = exception({
      kind: 'move',
      date: '2026-11-03',
      endDate: '2026-11-04',
      startTime: '23:30',
      endTime: '01:00',
    });
    const changes = saveClassException([], move);
    for (const day of ['2026-11-03', '2026-11-04']) {
      expect(resolve(changes, day).today[0]).toMatchObject({
        startAt: Date.parse('2026-11-03T23:30:00+08:00'),
        endAt: Date.parse('2026-11-04T01:00:00+08:00'),
      });
    }
    expect(resolve(changes, '2026-11-05').today).toHaveLength(0);
    expect(() => saveClassException([], { ...move, endDate: '2026-11-03' })).toThrow();
  });
  it('retains exceptions and source history when import identifiers or rooms change', () => {
    const change = exception();
    const imported = {
      ...row,
      id: 'new-import',
      batchId: 'new-batch',
      location: '校方新教室',
      source: { ...row.source, rawText: '新來源' },
    };
    const plan = planPortalReimport([row], [imported], 'pu');
    const result = resolvePortalReimport(plan, { [imported.id]: 'replace' });
    expect(result.replacements).toHaveLength(1);
    const replaced = { ...row, ...result.replacements[0].next };
    expect(resolve([change], '2026-11-02', [replaced]).today).toHaveLength(0);
    expect(resolve([change], '2026-11-02', [imported]).today).toHaveLength(0);
    expect(change.original.source.rawText).toBe(row.source.rawText);
    expect(
      withClassExceptions([{ ...imported, startPeriod: 5 }], [change])[0].classExceptions,
    ).toEqual([]);
    expect(change.original.startPeriod).toBe(2);
  });
  it('does not revive a manual duplicate when the imported meeting is cancelled', () => {
    const imported = { ...row, courseCode: 'S101' };
    const stop = exception({ original: imported, courseKey: classMeetingKey(imported) });
    expect(
      resolve([stop], '2026-11-02', [imported, { ...row, id: 'manual:course' }]).today,
    ).toEqual([]);
  });
  it('uses the same instants and room for timetable, today and reminders', () => {
    const change = exception({
      kind: 'move',
      date: '2026-11-03',
      endDate: '2026-11-04',
      startTime: '23:30',
      endTime: '01:00',
      location: '補課教室',
    });
    const records = withClassExceptions([row], [change]);
    const now = new Date('2026-11-03T08:00:00+08:00');
    const timetable = buildPersonalToday(records, { schoolId: 'pu', now });
    const today = buildPersonalToday(records, { schoolId: 'pu', now });
    const reminders = classReminderPlan(today.today, now.getTime());
    expect(timetable.today).toEqual(today.today);
    expect(todayClassesFromSchedule(today.today, now)[0]).toMatchObject({
      startAt: today.today[0].startAt, endAt: today.today[0].endAt, location: '補課教室',
    });
    const afterMidnight = buildPersonalToday(records, { schoolId: 'pu', now: new Date('2026-11-04T00:30:00+08:00') });
    expect(afterMidnight.today[0].status).toBe('ongoing');
    expect(todayClassesFromSchedule(afterMidnight.today, now)[0].startAt).toBe(today.today[0].startAt);
    expect(reminders[0]).toMatchObject({
      startAt: today.today[0].startAt,
      endAt: today.today[0].endAt,
      location: '補課教室',
      remindAt: today.today[0].startAt - 600000,
    });
    expect(classReminderPlan(resolve([exception()]).today, now.getTime())).toEqual([]);
  });
});


describe('equivalent meeting representations and bounded storage', () => {
  const clock = { ...row, id: 'import:clock', startPeriod: undefined, endPeriod: undefined, startTime: '09:10', endTime: '12:00', courseCode: 'C101' };
  const manual = { ...row, id: 'manual:period' };
  it.each(['cancel', 'room', 'move'] as const)('applies %s to both period and clock rows', (kind) => {
    const change = exception({ original: clock, courseKey: classMeetingKey(clock), kind,
      ...(kind === 'room' ? { location: '新教室' } : {}),
      ...(kind === 'move' ? { date: '2026-11-03', startTime: '18:00', endTime: '20:00', location: '補課室' } : {}) });
    const changes = saveClassException([], change);
    const originalDay = resolve(changes, '2026-11-02', [manual, clock]);
    expect(originalDay.today).toHaveLength(kind === 'room' ? 1 : 0);
    if (kind === 'room') expect(originalDay.today[0].row.location).toBe('新教室');
    expect(classReminderPlan(originalDay.today, Date.parse('2026-11-02T08:00:00+08:00'))).toHaveLength(kind === 'room' ? 1 : 0);
    if (kind === 'move') expect(resolve(changes, '2026-11-03', [manual, clock]).today).toHaveLength(1);
    expect(resolve([], '2026-11-02', [manual, clock]).today).toHaveLength(1);
  });
  it('marks the overnight class on its start date, even when overlap is only tomorrow', () => {
    const change = exception({ kind: 'move', date: '2026-11-03', endDate: '2026-11-04', startTime: '23:30', endTime: '01:00' });
    const other = { ...row, id: 'wednesday', title: '凌晨課', dayOfWeek: 3, startTime: '00:30', endTime: '01:30' };
    const records = withClassExceptions([row, other], [change]);
    const now = new Date('2026-11-03T08:00:00+08:00');
    const plan = buildPersonalToday(records, { schoolId: 'pu', now });
    expect(plan.today).toHaveLength(1);
    expect(plan.today[0].conflict).toBe(true);
    expect(classReminderPlan(plan.today, now.getTime())[0].conflict).toBe(true);
    expect(resolve([change], '2026-11-04', [row, other]).today.every((item) => item.conflict)).toBe(true);
    expect(resolve([change], '2026-11-03', [row, { ...other, startTime: '01:00' }]).today[0].conflict).toBe(false);
  });
  it('drops large source snapshots and rejects excessive UTF-8 storage', () => {
    const original = { ...row, source: { ...row.source, name: '假姓名.csv', rawText: 'x'.repeat(100000) } };
    let changes: ClassException[] = [];
    for (let i = 0; i < 12; i++) changes = saveClassException(changes, exception({ id: String(i), original,
      originalDate: new Date(Date.parse('2026-11-02T12:00:00Z') + i * 7 * 86400000).toISOString().slice(0, 10) }));
    expect(JSON.stringify(changes).length).toBeLessThan(20000);
    expect(JSON.stringify(changes)).not.toContain('假姓名');
    expect(() => assertClassExceptions(changes)).not.toThrow();
    expect(() => saveClassException(changes, exception({ kind: 'room', location: '長'.repeat(100000) }))).toThrow('資料過大');
    expect(original.source.rawText).toHaveLength(100000);
  });
});


it('replaces an existing adjustment when saved through its equivalent manual row', () => {
  const imported = { ...row, id: 'import:clock', courseCode: 'C101', startPeriod: undefined, endPeriod: undefined, startTime: '09:10', endTime: '12:00' };
  const manual = { ...row, id: 'manual:period' };
  const stopped = saveClassException([], exception({ original: imported, courseKey: classMeetingKey(imported) }));
  const changed = saveClassException(stopped, exception({ id: 'room', kind: 'room', location: '新教室', original: manual, courseKey: classMeetingKey(manual) }));
  expect(changed).toHaveLength(1);
  expect(resolve(changed, '2026-11-02', [manual, imported]).today).toHaveLength(1);
  expect(resolve(changed, '2026-11-02', [manual, imported]).today[0].row.location).toBe('新教室');
});

it('reads the earlier period-based key after importing the same meeting as clock times', () => {
  const oldKey = JSON.stringify(['pu', '115', '1', row.title, '', '', 1, 2, 4]);
  const imported = { ...row, startPeriod: undefined, endPeriod: undefined, startTime: '09:10', endTime: '12:00' };
  expect(resolve([exception({ courseKey: oldKey })], '2026-11-02', [imported]).today).toHaveLength(0);
});

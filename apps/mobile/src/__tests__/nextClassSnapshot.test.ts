import { buildNextClassSnapshot, nextClassState } from '../widgets/nextClassSnapshot';
import { createSnapshotWriter } from '../widgets/nextClassBridge';
import type { PersonalImportRecord } from '@campus/shared';
jest.mock('expo', () => ({ requireOptionalNativeModule: () => null }));
const now = new Date('2026-10-19T00:50:00Z');
const row: PersonalImportRecord = {
  id: 'course/a',
  batchId: 'sample',
  importedAt: now.toISOString(),
  kind: 'timetable',
  schoolId: 'pu',
  academicYear: '115',
  semester: '1',
  title: '合成課程',
  dayOfWeek: 1,
  startTime: '09:00',
  endTime: '10:00',
  location: '測試 101',
  source: { type: 'paste', line: 1, rawText: '' },
};
test('real rows produce before, during, after class and expiry states with encoded course links', () => {
  const snapshot = buildNextClassSnapshot([row], 'pu', now);
  expect(snapshot.classes).toHaveLength(1);
  expect(snapshot.classes[0]).toMatchObject({ title: '合成課程', location: '測試 101' });
  expect(snapshot.classes[0].url).toContain('courseId=course%2Fa');
  expect(nextClassState(snapshot, now.getTime()).status).toBe('upcoming');
  expect(nextClassState(snapshot, Date.parse('2026-10-19T01:00:00Z')).status).toBe('ongoing');
  expect(nextClassState(snapshot, Date.parse('2026-10-19T02:00:00Z')).status).toBe('empty');
  expect(nextClassState(snapshot, snapshot.expiresAt).status).toBe('stale');
  expect(nextClassState(snapshot, snapshot.updatedAt - 1).status).toBe('stale');
  expect(nextClassState(null, now.getTime()).status).toBe('unavailable');
});
test('weekend and midnight retain the next actual class, independent of device timezone', () => {
  const snapshot = buildNextClassSnapshot([row], 'pu', new Date('2026-10-23T16:01:00Z'));
  expect(snapshot.classes[0].startAt).toBe(Date.parse('2026-10-26T01:00:00Z'));
  expect(nextClassState(snapshot, Date.parse('2026-10-25T16:00:00Z')).status).toBe('upcoming');
});
test('school, latest term, missing times and manual/import duplicate handling match the app', () => {
  const records = [
    row,
    { ...row, id: 'old', academicYear: '114' },
    { ...row, id: 'other', schoolId: 'other' },
    { ...row, id: 'manual:a' },
    { ...row, id: 'missing', startTime: undefined, endTime: undefined },
  ];
  const snapshot = buildNextClassSnapshot(records, 'pu', now);
  expect(snapshot.classes.map((course) => course.id)).toEqual(['course/a']);
  expect(snapshot.incomplete).toBe(true);
  expect(nextClassState(snapshot, Date.parse('2026-10-19T02:00:00Z')).status).toBe('incomplete');
});
test('empty snapshots contain no invented courses and edits replace names and rooms', () => {
  expect(buildNextClassSnapshot([], 'pu', now).classes).toEqual([]);
  expect(
    buildNextClassSnapshot([{ ...row, title: '已修正', location: '測試 202' }], 'pu', now)
      .classes[0],
  ).toMatchObject({ title: '已修正', location: '測試 202' });
});
test('logout clears after an in-flight native write, and rejects late previous-account results', async () => {
  let finish!: () => void;
  const bridge = {
    setSnapshot: jest
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValue(undefined),
  };
  const writer = createSnapshotWriter(bridge);
  const snapshot = buildNextClassSnapshot([row], 'pu', now);
  const oldRevision = writer.begin();
  const write = writer.write(snapshot, oldRevision);
  await Promise.resolve();
  await Promise.resolve();
  const clear = writer.clear();
  finish();
  await write;
  await clear;
  await writer.write(snapshot, oldRevision);
  expect(bridge.setSnapshot.mock.calls.map(([value]) => value)).toEqual([
    JSON.stringify(snapshot),
    null,
  ]);
  const next = writer.begin();
  await writer.write(buildNextClassSnapshot([], 'pu', now), next);
  expect(JSON.parse(bridge.setSnapshot.mock.calls[2][0]).classes).toEqual([]);
});

test('a noon refresh expires before the uncovered eighth Taipei calendar day', () => {
  const snapshot = buildNextClassSnapshot([row], 'pu', new Date('2026-10-19T04:00:00Z'));
  expect(snapshot.expiresAt).toBe(Date.parse('2026-10-25T16:00:00Z'));
  expect(nextClassState(snapshot, Date.parse('2026-10-26T00:30:00Z')).status).toBe('stale');
  expect(nextClassState(snapshot, snapshot.expiresAt - 1).status).toBe('empty');
  expect(nextClassState(snapshot, snapshot.expiresAt).status).toBe('stale');
});


test('overnight exceptions match actual instants, reminders and next-day conflicts without duplicates', () => {
  const { classMeetingKey, withClassExceptions, buildPersonalToday, classReminderPlan } = require('@campus/shared');
  const original = { ...row, dayOfWeek: 1 };
  const change = { id: 'overnight', original, courseKey: classMeetingKey(original), originalDate: '2026-11-02',
    kind: 'move', date: '2026-11-03', endDate: '2026-11-04', startTime: '23:30', endTime: '01:00', location: '補課教室', createdAt: '' };
  const other = { ...row, id: 'night', title: '凌晨課', dayOfWeek: 3, startTime: '00:30', endTime: '01:30' };
  const records = withClassExceptions([original, other], [change]);
  const time = new Date('2026-11-03T08:00:00+08:00');
  const today = buildPersonalToday(records, { schoolId: 'pu', now: time });
  const widget = buildNextClassSnapshot(records, 'pu', time);
  expect(widget.classes.filter((entry) => entry.startAt === today.today[0].startAt)).toHaveLength(1);
  expect(widget.classes[0]).toMatchObject({ startAt: today.today[0].startAt, endAt: today.today[0].endAt, location: '補課教室', conflict: true });
  expect(classReminderPlan(today.today, time.getTime())[0]).toMatchObject({ startAt: widget.classes[0].startAt, endAt: widget.classes[0].endAt, location: '補課教室', remindAt: widget.classes[0].startAt - 600000 });
});

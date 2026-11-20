import { liveClassContent } from '../widgets/nextClassLiveActivity';
import { createSnapshotWriter } from '../widgets/nextClassBridge';
import type { NextClassSnapshot } from '../widgets/nextClassSnapshot';
import { buildNextClassSnapshot } from '../widgets/nextClassSnapshot';
import { classMeetingKey, withClassExceptions, type PersonalImportRecord, type ClassException } from '@campus/shared';
jest.mock('expo', () => ({ requireOptionalNativeModule: () => null }));
const now = 1800000000000;
const course = {
  id: 'synthetic',
  title: '測試課程',
  location: '測試館 201',
  startAt: now + 60000,
  endAt: now + 3600000,
  url: 'campus://personal-timetable?courseId=synthetic&schoolId=pu',
  conflict: false,
};
const snapshot: NextClassSnapshot = {
  version: 1,
  updatedAt: now - 1000,
  expiresAt: now + 86400000,
  incomplete: false,
  classes: [course],
};
afterEach(() => jest.useRealTimers());
test('即時動態遵守單次停課、補課與換教室，下一週仍保留原課程', () => {
  const time = new Date('2026-10-19T08:50:00+08:00');
  const row: PersonalImportRecord = {
    id: 'course', batchId: '', importedAt: '', kind: 'timetable', schoolId: 'pu',
    academicYear: '115', semester: '1', title: '測試課程', dayOfWeek: 1,
    startTime: '09:00', endTime: '10:00', location: '原教室',
    source: { type: 'paste', line: 1, rawText: '' },
  };
  const change: ClassException = {
    id: 'change', courseKey: classMeetingKey(row), original: row,
    originalDate: '2026-10-19', kind: 'cancel', createdAt: '',
  };
  const snapshot = (exception: ClassException, date = time) =>
    buildNextClassSnapshot(withClassExceptions([row], [exception]), 'pu', date);
  expect(liveClassContent(snapshot(change), time.getTime())).toBeNull();
  const room = liveClassContent(snapshot({ ...change, kind: 'room', location: '新教室' }), time.getTime());
  expect(room).toMatchObject({ location: '新教室', startAt: Date.parse('2026-10-19T01:00:00Z') });
  expect(room?.mapURL).toContain(encodeURIComponent('新教室'));
  const moved: ClassException = {
    ...change, kind: 'move', date: '2026-10-20', startTime: '11:00', endTime: '12:00', location: '補課教室',
  };
  expect(liveClassContent(snapshot(moved), time.getTime())).toBeNull();
  const makeup = Date.parse('2026-10-20T10:50:00+08:00');
  expect(liveClassContent(snapshot(moved), makeup)).toMatchObject({
    location: '補課教室', startAt: Date.parse('2026-10-20T03:00:00Z'),
    endAt: Date.parse('2026-10-20T04:00:00Z'),
  });
  const following = new Date('2026-10-26T08:50:00+08:00');
  for (const exception of [change, { ...change, kind: 'room' as const, location: '新教室' }, moved]) {
    expect(liveClassContent(snapshot(exception, following), following.getTime())).toMatchObject({ location: '原教室' });
  }
});
test('uses the confirmed snapshot for countdown, course and school-scoped room search', () => {
  const { id: _id, ...expected } = course;
  expect(liveClassContent(snapshot, now)).toEqual({
    ...expected,
    key: `synthetic:${course.startAt}`,
    mapURL: 'campus://map?query=%E6%B8%AC%E8%A9%A6%E9%A4%A8+201&schoolId=pu',
  });
  expect(liveClassContent(snapshot, course.startAt)).not.toBeNull();
  expect(liveClassContent(snapshot, course.endAt)).toBeNull();
});
test('does not start far ahead, from expired snapshots, before confirmation or without a class', () => {
  expect(liveClassContent(snapshot, now - 3600000)).toBeNull();
  expect(liveClassContent(snapshot, snapshot.expiresAt)).toBeNull();
  expect(liveClassContent(snapshot, snapshot.updatedAt - 1)).toBeNull();
  expect(liveClassContent({ ...snapshot, classes: [] }, now)).toBeNull();
  expect(liveClassContent(null, now)).toBeNull();
});
test('serialized writes start, update a changed room, end after class, and clear on logout', async () => {
  jest.useFakeTimers().setSystemTime(now);
  const bridge = {
    setSnapshot: jest.fn().mockResolvedValue(undefined),
    setLiveActivity: jest.fn().mockResolvedValue(undefined),
  };
  const writer = createSnapshotWriter(bridge);
  await writer.write(snapshot, writer.begin());
  expect(bridge.setLiveActivity).toHaveBeenLastCalledWith(
    expect.objectContaining({ location: '測試館 201' }),
  );
  await writer.write(
    { ...snapshot, classes: [{ ...course, location: '測試館 305' }] },
    writer.begin(),
  );
  expect(bridge.setLiveActivity).toHaveBeenLastCalledWith(
    expect.objectContaining({ location: '測試館 305' }),
  );
  jest.setSystemTime(course.endAt);
  await writer.refreshActivity();
  expect(bridge.setLiveActivity).toHaveBeenLastCalledWith(null);
  const old = writer.begin();
  await writer.clear();
  await writer.write(snapshot, old);
  await writer.refreshActivity();
  expect(bridge.setSnapshot).toHaveBeenLastCalledWith(null);
  expect(bridge.setLiveActivity).toHaveBeenLastCalledWith(null);
});
test('unsupported native installs still write widgets without calling an activity method', async () => {
  const bridge = { setSnapshot: jest.fn().mockResolvedValue(undefined) };
  const writer = createSnapshotWriter(bridge);
  await writer.write(snapshot, writer.begin());
  expect(bridge.setSnapshot).toHaveBeenCalledTimes(1);
});

test('logout still clears the activity when the widget storage write fails', async () => {
  const bridge = {
    setSnapshot: jest.fn().mockRejectedValue(new Error('synthetic storage failure')),
    setLiveActivity: jest.fn().mockResolvedValue(undefined),
  };
  const writer = createSnapshotWriter(bridge);
  await expect(writer.clear()).rejects.toThrow('synthetic storage failure');
  expect(bridge.setLiveActivity).toHaveBeenLastCalledWith(null);
});

test('starts at the one-hour boundary and picks the next confirmed class after the previous end', () => {
  const early = { ...snapshot, updatedAt: now - 7200000 };
  expect(liveClassContent(early, course.startAt - 3600001)).toBeNull();
  expect(liveClassContent(early, course.startAt - 3600000)).not.toBeNull();
  const following = {
    ...course,
    id: 'following',
    startAt: course.endAt + 600000,
    endAt: course.endAt + 3600000,
  };
  const next = liveClassContent({ ...snapshot, classes: [course, following] }, course.endAt);
  expect(next?.key).toBe(`following:${following.startAt}`);
});

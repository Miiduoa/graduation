import { liveClassContent } from '../widgets/nextClassLiveActivity';
import { createSnapshotWriter } from '../widgets/nextClassBridge';
import type { NextClassSnapshot } from '../widgets/nextClassSnapshot';
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

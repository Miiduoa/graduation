import { httpsCallable } from 'firebase/functions';
import { runOfflineCampusTool } from '../../services/offlineCampusTools';
import {
  refreshCampusSenseSnapshot,
  validCampusSenseSnapshot,
  CAMPUS_SENSE_MAX_AGE_MS,
  type CampusSenseSnapshot,
} from '../../services/campusSenseSnapshot';

let mockUid: string | null = 'A';
let mockMode = false;
const mockCallable = jest.fn();

jest.mock('firebase/functions', () => ({
  httpsCallable: jest.fn(() => mockCallable),
}));
jest.mock('../../firebase', () => ({
  getAuthInstance: () => ({ currentUser: mockUid ? { uid: mockUid } : null }),
  getFunctionsInstance: () => ({}),
  isFirebaseMockMode: () => mockMode,
}));

const scope = { uid: 'A', schoolId: 'pu' };
const envelope = () => ({
  schoolId: 'pu',
  checkedAt: new Date().toISOString(),
  schedule: { status: 'unavailable', count: null },
  assignments: {
    status: 'available', count: 2,
    items: [
      { title: '資料庫期末報告', groupName: '資料庫', dueAt: '2026-11-01T09:00:00Z' },
      { title: '週二練習', groupName: '程式設計', dueAt: null },
    ],
  },
  announcements: {
    status: 'available',
    items: [{ title: '圖書館公告', publishedAt: '2026-10-26T09:00:00Z' }],
  },
});

beforeEach(() => {
  jest.clearAllMocks();
  mockUid = 'A';
  mockMode = false;
  mockCallable.mockResolvedValue({ data: envelope() });
});

test('refreshes only a signed-in authorized account and requested school', async () => {
  const result = await refreshCampusSenseSnapshot({ scope, isCurrent: () => true });
  expect(result).toMatchObject({
    userId: 'A', schoolId: 'pu',
    schedule: { status: 'unavailable', count: null },
    assignments: { status: 'available', count: 2 },
  });
  expect(httpsCallable).toHaveBeenCalledWith({}, 'getCampusAssistantSnapshot');
  expect(mockCallable).toHaveBeenCalledWith({ schoolId: 'pu' });
  expect(validCampusSenseSnapshot(result, scope)).not.toBeNull();
});

test.each(['guest', 'other-account', 'mock-mode', 'navigated-away'])(
  'never requests a private snapshot on %s', async (reason) => {
    if (reason === 'guest') mockUid = null;
    if (reason === 'other-account') mockUid = 'B';
    if (reason === 'mock-mode') mockMode = true;
    await expect(refreshCampusSenseSnapshot({
      scope, isCurrent: () => reason !== 'navigated-away',
    })).rejects.toThrow('session-changed');
    expect(mockCallable).not.toHaveBeenCalled();
  },
);

test('discards a delayed response after switching account', async () => {
  let resolve!: (value: unknown) => void;
  mockCallable.mockReturnValueOnce(new Promise((next) => { resolve = next; }));
  const request = refreshCampusSenseSnapshot({ scope, isCurrent: () => true });
  mockUid = 'B';
  resolve({ data: envelope() });
  await expect(request).rejects.toThrow('session-changed');
});

test('rejects stale and mismatched summaries rather than accepting false live status', async () => {
  mockCallable.mockResolvedValueOnce({
    data: { ...envelope(), checkedAt: new Date(Date.now() - CAMPUS_SENSE_MAX_AGE_MS - 1000).toISOString() },
  });
  await expect(refreshCampusSenseSnapshot({ scope, isCurrent: () => true }))
    .rejects.toThrow('expired-sense-response');

  mockCallable.mockResolvedValueOnce({ data: { ...envelope(), schoolId: 'other-school' } });
  await expect(refreshCampusSenseSnapshot({ scope, isCurrent: () => true }))
    .rejects.toThrow('invalid-sense-response');

  const result = await refreshCampusSenseSnapshot({ scope, isCurrent: () => true });
  expect(validCampusSenseSnapshot(result, { uid: 'other', schoolId: 'pu' })).toBeNull();
  expect(validCampusSenseSnapshot(result, { uid: 'A', schoolId: 'other-school' })).toBeNull();
  expect(validCampusSenseSnapshot(result, scope, Date.now() + CAMPUS_SENSE_MAX_AGE_MS + 1000))
    .toBeNull();
});

test('unavailable sources cannot be turned into verified zero counts', async () => {
  mockCallable.mockResolvedValueOnce({
    data: {
      ...envelope(),
      assignments: { status: 'unavailable', count: 0, items: [{ title: '未授權作業' }] },
      announcements: { status: 'unavailable', items: [{ title: '未授權公告' }] },
    },
  });
  const result = await refreshCampusSenseSnapshot({ scope, isCurrent: () => true });
  expect(result.assignments).toEqual({ status: 'unavailable', count: null, items: [] });
  expect(result.announcements).toEqual({ status: 'unavailable', items: [] });
});

test('malformed authenticated responses are rejected rather than hallucinated', async () => {
  mockCallable.mockResolvedValueOnce({
    data: { ...envelope(), assignments: { status: 'available', count: 2, items: [{ title: null }] } },
  });
  await expect(refreshCampusSenseSnapshot({ scope, isCurrent: () => true }))
    .rejects.toThrow('invalid-sense-response');
});

test('normalizes announcement destinations without requiring old servers to supply a source', async () => {
  const base = envelope();
  const notice = base.announcements.items[0];
  const source = { kind: 'legacy-announcement', id: 'notice_1' };
  mockCallable.mockResolvedValueOnce({ data: { ...base, announcements: { status: 'available',
    items: [notice, { ...notice, source: { ...source, url: 'discard' } }],
  } } });
  const result = await refreshCampusSenseSnapshot({ scope, isCurrent: () => true });
  expect(result.announcements.items).toEqual([notice, { ...notice, source }]);
});

test.each([
  { kind: 'school-announcement', id: '../wrong' },
  { kind: 'legacy-announcement', id: '%2F' },
  { kind: 'another-collection', id: 'ok' },
])('rejects an untrusted announcement destination', async (source) => {
  const base = envelope();
  mockCallable.mockResolvedValueOnce({ data: { ...base, announcements: { status: 'available',
    items: [{ ...base.announcements.items[0], source }],
  } } });
  await expect(refreshCampusSenseSnapshot({ scope, isCurrent: () => true })).rejects.toThrow('invalid-sense-response');
});

// The scope/freshness check and row-date parser at merge-base 1a1f36863.
function mergeBaseValid(snapshot: CampusSenseSnapshot, now: number): CampusSenseSnapshot | null {
  if (!scope.uid || !scope.schoolId || !snapshot ||
      snapshot.userId !== scope.uid || snapshot.schoolId !== scope.schoolId) return null;
  const savedAt = Date.parse(snapshot.checkedAt);
  if (!Number.isFinite(savedAt) || savedAt > now + 30_000 || now - savedAt > CAMPUS_SENSE_MAX_AGE_MS) return null;
  return snapshot;
}

function mergeBaseDate(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new Error('invalid-sense-response');
  }
  return value;
}

const dates = [
  ['ISO Z', '2026-11-02T01:00:00Z', true],
  ['offset crossing a UTC day', '2026-11-02T00:30:00+08:00', true],
  ['no timezone', '2026-11-02T09:00:00', false],
  ['legacy text', 'November 2, 2026 09:00:00 GMT', false],
  ['positive extended year', '+010000-01-01T00:00:00.000Z', true],
  ['negative extended year', '-000001-01-01T00:00:00.000Z', true],
  ['extended leap day', '+010000-02-29T00:00:00.000Z', true],
  ['date-only year under 100', '0000-02-29', false],
  ['space-padded legacy date', ' November 2, 2026 09:00:00 GMT ', false],
  ['milliseconds', '2026-11-02T09:00:00.120+08:00', true],
  ['serialized numeric timestamp', new Date(1793581200123).toISOString(), true],
  ['leap day', '2028-02-29T08:15:00Z', true],
  ['offset beyond 14 hours', '2026-10-28T00:30:00+15:00', true],
  ['non-leap day', '2026-02-29T08:00:00Z', true],
  ['February 30', '2026-02-30T08:00:00Z', true],
  ['legacy February 30', 'February 30, 2026 08:00:00 GMT', false],
  ['legacy April 31', '4/31/2026', false],
  ['midnight rollover', '2026-11-02T24:00:00Z', true],
  ['April 31', '2026-04-31T09:00:00Z', true],
  ['extended rollover', '-000001-02-29T08:00:00-08:00', true],
  ['invalid offset', '2026-10-28T00:30:00+24:00', false],
  ['invalid text', 'not-a-date', false],
  ['empty string', '', false],
  ['non-string', {}, false],
  ['numeric timestamp', 1793581200123, false],
  ['null', null, false],
] as const;

describe.each(dates)('%s row date', (_label, date, confirmedOffline) => {
  describe.each(['date', 'number', 'missing'] as const)('%s field', (field) => {
    test.each(['plain', 'some=null', 'map=null', 'read-only length', 'iterator=null'] as const)(
      '%s arrays preserve snapshot reuse and offline reads', async (arrayShape) => {
        const payload = envelope();
        const now = Date.parse(payload.checkedAt);
        const applyDate = (row: object, key: string) => {
          if (field === 'missing') Reflect.deleteProperty(row, key);
          else Reflect.set(row, key, field === 'number' ? 42 : date);
        };
        applyDate(payload.assignments.items[1], 'dueAt');
        payload.announcements.items.push({ title: '其他公告', publishedAt: payload.checkedAt });
        applyDate(payload.announcements.items[0], 'publishedAt');
        const modify = (items: unknown[]) => {
          if (arrayShape === 'read-only length') Object.defineProperty(items, 'length', { writable: false });
          if (arrayShape === 'some=null') Object.defineProperty(items, 'some', { value: null });
          if (arrayShape === 'map=null') Object.defineProperty(items, 'map', { value: null });
          if (arrayShape === 'iterator=null') Object.defineProperty(items, Symbol.iterator, { value: null });
        };
        const restored = { ...payload, userId: scope.uid } as CampusSenseSnapshot;
        modify(payload.assignments.items);
        modify(payload.announcements.items);

        expect(validCampusSenseSnapshot(restored, scope, now)).toBe(mergeBaseValid(restored, now));
        const context = {
          ownerUid: scope.uid, schoolId: scope.schoolId, schoolName: '靜宜大學', checkedAt: payload.checkedAt,
          timetable: { source: 'saved-device-copy' as const, courses: [], updatedAt: payload.checkedAt },
        };
        expect(runOfflineCampusTool('有哪些待交作業？', context, restored, scope.uid)
          ?.assignmentRead?.items.map(({ title }) => title).sort()).toEqual(['資料庫期末報告', '週二練習'].sort());
        expect(runOfflineCampusTool('校園公告', context, restored, scope.uid)
          ?.announcementRead?.items.map(({ title }) => title)).toContain('其他公告');
        expect(runOfflineCampusTool('今天要先做什麼？', context, restored, scope.uid)?.content)
          .toContain('手機課表副本在這個期間沒有排課');
        const undatedQuestion = '沒有截止日期的作業有哪些？';
        const undated = runOfflineCampusTool(undatedQuestion, context, restored, scope.uid);
        expect(undated?.assignmentRead?.items.map(({ title }) => title))
          .toEqual(field === 'date' && confirmedOffline ? [] : ['週二練習']);
      },
    );
  });
});

describe.each(['dueAt', 'publishedAt'] as const)('%s on refresh', (field) => {
  test.each([...dates, ['missing', undefined, false] as const])(
    '%s matches the merge-base date parser', async (_label, date) => {
      const payload = envelope();
      const row = field === 'dueAt' ? payload.assignments.items[1] : payload.announcements.items[0];
      if (date === undefined) Reflect.deleteProperty(row, field);
      else Reflect.set(row, field, date);

      // Snapshot the expected result before passing the payload to refresh.
      let expectedDate: string | null;
      try {
        expectedDate = mergeBaseDate(date);
      } catch (error) {
        expect(error).toEqual(new Error('invalid-sense-response'));
        mockCallable.mockResolvedValueOnce({ data: payload });
        await expect(refreshCampusSenseSnapshot({ scope, isCurrent: () => true }))
          .rejects.toThrow('invalid-sense-response');
        return;
      }

      const expected = {
        ...payload,
        userId: scope.uid,
        assignments: {
          ...payload.assignments,
          items: field === 'dueAt'
            ? [payload.assignments.items[0], { ...payload.assignments.items[1], dueAt: expectedDate }]
            : payload.assignments.items,
          coverage: { complete: true, pages: 1, reason: 'complete' },
        },
        announcements: {
          ...payload.announcements,
          items: field === 'publishedAt'
            ? [{ ...payload.announcements.items[0], publishedAt: expectedDate }]
            : payload.announcements.items,
        },
      };
      mockCallable.mockResolvedValueOnce({ data: payload });
      const fresh = await refreshCampusSenseSnapshot({ scope, isCurrent: () => true });
      expect(fresh).toStrictEqual(expected);
      expect(validCampusSenseSnapshot(fresh, scope, Date.parse(payload.checkedAt))).toBe(fresh);
    },
  );
});

test.each(['some', 'map', 'slice', Symbol.iterator] as const)(
  'refresh reads source rows when %s is shadowed', async (method) => {
    const payload = envelope();
    for (const items of [payload.assignments.items, payload.announcements.items]) {
      Object.defineProperty(items, method, { value: null });
    }
    mockCallable.mockResolvedValueOnce({ data: payload });
    const fresh = await refreshCampusSenseSnapshot({ scope, isCurrent: () => true });
    expect(fresh.assignments.items).toEqual(payload.assignments.items);
    expect(fresh.announcements.items).toEqual(payload.announcements.items);
  },
);

test('keeps the merge-base freshness check for a restored legacy synchronization time', () => {
  const snapshot = { ...envelope(), userId: scope.uid, checkedAt: '2026-02-30T08:00:00Z' } as CampusSenseSnapshot;
  const now = Date.parse('2026-03-02T08:00:00Z');
  expect(mergeBaseValid(snapshot, now)).toBe(snapshot);
  expect(validCampusSenseSnapshot(snapshot, scope, now)).toBe(snapshot);
});

test.each(dates)('%s synchronization time follows merge-base freshness', async (_label, date) => {
  const parsed = typeof date === 'string' ? Date.parse(date) : NaN;
  const now = Number.isFinite(parsed) ? parsed : Date.now();
  const clock = jest.spyOn(Date, 'now').mockReturnValue(now);
  try {
    const payload = { ...envelope(), checkedAt: date };
    const baseline = { ...payload, userId: scope.uid } as CampusSenseSnapshot;
    mockCallable.mockResolvedValueOnce({ data: payload });

    const refresh = refreshCampusSenseSnapshot({ scope, isCurrent: () => true });
    if (typeof date === 'string' && mergeBaseValid(baseline, now)) {
      expect((await refresh).checkedAt).toBe(baseline.checkedAt);
    } else {
      await expect(refresh).rejects.toThrow(typeof date === 'string' ? 'expired-sense-response' : 'invalid-sense-response');
    }
  } finally {
    clock.mockRestore();
  }
});

test('an extended-year deadline is dated and an extended-year future announcement is excluded', async () => {
  const payload = envelope();
  const date = '+010000-01-01T00:00:00.000Z';
  const futureAssignment = { ...payload.assignments.items[1], dueAt: date };
  payload.assignments.items[1] = futureAssignment;
  payload.announcements.items = [
    { title: '未來公告', publishedAt: date },
    { title: '已發布公告', publishedAt: payload.checkedAt },
  ];
  mockCallable.mockResolvedValueOnce({ data: payload });

  const fresh = await refreshCampusSenseSnapshot({ scope, isCurrent: () => true });
  const context = { ownerUid: scope.uid, schoolId: scope.schoolId, schoolName: '靜宜大學', checkedAt: payload.checkedAt };
  const query = (question: string) => runOfflineCampusTool(question, context, fresh, scope.uid);
  expect(query('沒有截止日期的作業有哪些？')?.assignmentRead?.items).toEqual([]);
  expect(query('尚未逾期的作業有哪些？')?.assignmentRead?.items).toContainEqual(futureAssignment);
  expect(query('校園公告')?.announcementRead?.items).toEqual([payload.announcements.items[1]]);
});

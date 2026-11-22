import { httpsCallable } from 'firebase/functions';
import {
  refreshCampusSenseSnapshot,
  validCampusSenseSnapshot,
  CAMPUS_SENSE_MAX_AGE_MS,
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


test.each([
  ['February 30', '2026-02-30T08:00:00Z', 'assignment'],
  ['February 29 in a non-leap year', '2026-02-29T08:00:00Z', 'assignment'],
  ['out-of-range timezone offset', '2026-10-28T00:30:00+15:00', 'assignment'],
  ['April 31', '2026-04-31T09:00:00Z', 'announcement'],
] as const)('rejects %s in an authorized %s source rather than shifting its deadline', async (_, timestamp, kind) => {
  const payload = envelope();
  if (kind === 'assignment') payload.assignments.items[0].dueAt = timestamp;
  else payload.announcements.items[0].publishedAt = timestamp;
  mockCallable.mockResolvedValueOnce({ data: payload });
  await expect(refreshCampusSenseSnapshot({ scope, isCurrent: () => true }))
    .rejects.toThrow('invalid-sense-response');
  expect(mockCallable).toHaveBeenCalledTimes(1);
});

test('preserves genuine leap-day and timezone-offset dates in the authorized source', async () => {
  const payload = envelope();
  payload.assignments.items[0].dueAt = '2028-02-29T08:15:00Z';
  payload.announcements.items[0].publishedAt = '2026-10-28T00:30:00+08:00';
  mockCallable.mockResolvedValueOnce({ data: payload });
  const result = await refreshCampusSenseSnapshot({ scope, isCurrent: () => true });
  expect(result.assignments.items[0].dueAt).toBe('2028-02-29T08:15:00Z');
  expect(result.announcements.items[0].publishedAt).toBe('2026-10-28T00:30:00+08:00');
});

test('rejects a restored impossible checkedAt even when Date.parse would roll it into the current minute', async () => {
  const snapshot = await refreshCampusSenseSnapshot({ scope, isCurrent: () => true });
  const rollover = '2026-02-30T08:00:00Z';
  const pretendNow = Date.parse('2026-03-02T08:00:00Z');
  expect(validCampusSenseSnapshot({ ...snapshot, checkedAt: rollover }, scope, pretendNow)).toBeNull();
});

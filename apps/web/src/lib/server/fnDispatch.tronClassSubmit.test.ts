// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
import { dispatchFnRequest, type FnRuntime } from './fnDispatch';
import { createMemoryGroupStore } from './memoryGroupStore';
import { resetUidRateLimitForTests } from './uidRateLimit';
import type { LmsReadonlySource } from './tronClassLmsSource';

const UID = 'pu-410000001';
const LMS_ID = 'b'.repeat(32);
const EXPIRES = () => new Date(Date.now() + 60_000);
const DUE = () => new Date(Date.now() + 86_400_000).toISOString();
const INPUT = { courseId: 10001, homeworkId: 20001, content: '修課心得', confirmed: true };

function setup() {
  const store = createMemoryGroupStore([
    ['users/' + UID, { schoolId: 'pu' }],
    ['schools/pu/members/' + UID, { status: 'active' }],
    ['_puSessions/current', {
      ownerUid: UID, cookies: { portal: 'private' }, expiresAt: EXPIRES(), tronClassSessionId: LMS_ID,
    }],
    ['_puTronClassSessions/' + LMS_ID, {
      ownerUid: UID, studentId: '410000001', cookies: { session: 'secret' }, userId: 10, expiresAt: EXPIRES(),
    }],
  ]);
  const source: LmsReadonlySource = {
    fetchCourses: vi.fn().mockResolvedValue([{ id: 10001, name: '資訊安全' }]),
    fetchHomeworkPage: vi.fn().mockImplementation(async () => ({
      ok: true, value: { homework_activities: [
        { id: 20001, title: '文字心得', submitted: false, deadline: DUE(), submission_type: 'text' },
      ], total: 1 },
    })),
    fetchActivities: vi.fn(),
    fetchCourseAnnouncements: vi.fn(),
    fetchSiteAnnouncements: vi.fn(),
    fetchHomeworkSubmissions: vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([{
      id: 99, student_id: 10, status: 'submitted', submitted_at: new Date().toISOString(),
    }]),
    submitHomeworkText: vi.fn().mockResolvedValue({
      accepted: true, receiptId: '99', submittedAt: new Date().toISOString(),
    }),
  };
  const verifyIdToken = vi.fn().mockResolvedValue({ uid: UID, schoolId: 'pu' });
  const runtime: FnRuntime = {
    db: store.db as unknown as FnRuntime['db'], verifyIdToken, lmsReadonlySource: source,
  };
  const request = async (data: unknown = INPUT, token = true) =>
    dispatchFnRequest('submitMyTronClassHomework',
      new Request('https://nuni.tw/api/fn/submitMyTronClassHomework', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer token' } : {}) },
        body: JSON.stringify({ data }),
      }), runtime);
  return { store, source, request, verifyIdToken };
}

beforeEach(() => resetUidRateLimitForTests());

it('accepts a confirmed text submission and verifies the school receipt', async () => {
  const { source, request, verifyIdToken, store } = setup();
  const response = await request();
  expect(response.status).toBe(200);
  expect((await response.json()).result).toMatchObject({ status: 'verified', receiptId: '99' });
  expect(source.fetchCourses).toHaveBeenCalledWith({ session: 'secret' }, { userId: 10, status: 'ongoing' });
  expect(source.submitHomeworkText).toHaveBeenCalledOnce();
  expect(source.submitHomeworkText).toHaveBeenCalledWith({ session: 'secret' }, 10001, 20001, '修課心得');
  expect(verifyIdToken).toHaveBeenCalledWith('token', true);
  expect([...store.docs.values()].some((doc) => doc.state === 'verified')).toBe(true);
});

it.each([
  { ...INPUT, confirmed: false },
  { ...INPUT, courseId: '10001' },
  { ...INPUT, homeworkId: -1 },
  { ...INPUT, content: '' },
  { ...INPUT, content: 'x'.repeat(12001) },
  { ...INPUT, ownerUid: UID },
])('refuses invalid or unconfirmed writes', async (value) => {
  const { request, source } = setup();
  const result = await request(value);
  expect(result.status).toBe(400);
  expect(source.submitHomeworkText).not.toHaveBeenCalled();
});

it('blocks unauthenticated and wrong-school access without writing to school', async () => {
  const { request, source, verifyIdToken } = setup();
  expect((await request(INPUT, false)).status).toBe(401);
  vi.mocked(verifyIdToken).mockResolvedValueOnce({ uid: UID, schoolId: 'ntu' });
  expect((await request()).status).toBe(403);
  expect(source.submitHomeworkText).not.toHaveBeenCalled();
});

it('does not submit for an unowned course or a missing homework', async () => {
  const { request, source } = setup();
  vi.mocked(source.fetchCourses).mockResolvedValueOnce([{ id: 999 }]);
  expect((await request()).status).toBe(403);
  vi.mocked(source.fetchHomeworkPage).mockResolvedValueOnce({
    ok: true, value: { homework_activities: [], total: 0 },
  });
  expect((await request()).status).toBe(404);
  expect(source.submitHomeworkText).not.toHaveBeenCalled();
});

it('refuses duplicate work and file-only assignments', async () => {
  const { request, source } = setup();
  vi.mocked(source.fetchHomeworkPage).mockResolvedValueOnce({
    ok: true, value: { homework_activities: [{ id: 20001, submitted: true }], total: 1 },
  });
  expect((await request()).status).toBe(409);
  vi.mocked(source.fetchHomeworkPage).mockResolvedValueOnce({
    ok: true, value: { homework_activities: [{ id: 20001, submitted: false,
      deadline: DUE(), submission_type: 'file' }], total: 1 },
  });
  expect((await request()).status).toBe(400);
  expect(source.submitHomeworkText).not.toHaveBeenCalled();
});

it('does not double-post the same assignment even if the client calls twice', async () => {
  const { request, source } = setup();
  expect((await request()).status).toBe(200);
  expect((await request()).status).toBe(409);
  expect(source.submitHomeworkText).toHaveBeenCalledTimes(1);
});

it('keeps an uncertain school write locked instead of retrying automatically', async () => {
  const { request, source, store } = setup();
  vi.mocked(source.submitHomeworkText!).mockRejectedValueOnce(new Error('timeout'));
  const result = await request();
  expect(result.status).toBe(503);
  expect((await result.json()).error.message).toMatch(/核對/);
  expect((await request()).status).toBe(409);
  expect(source.submitHomeworkText).toHaveBeenCalledTimes(1);
  expect([...store.docs.values()].some((doc) => doc.state === 'pending')).toBe(true);
});

it('keeps a 2xx response unverified until school reports a matching receipt', async () => {
  const { request, source } = setup();
  vi.mocked(source.fetchHomeworkSubmissions!).mockReset().mockResolvedValue([]);
  const response = await request();
  expect(response.status).toBe(200);
  expect((await response.json()).result.status).toBe('pending');
});

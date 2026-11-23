// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NuniError } from '@campus/shared/src/nuni';
import { createTronClassRawSubmissionHistoryReader } from './tronClassRawSubmissionHistory';
import type { LmsReadonlySource } from './tronClassLmsSource';
import type { TronClassSubmissionBinding } from './tronClassSubmissionSource';

const NOW = Date.parse('2026-11-18T04:00:00.000Z');
const OWNER = 'platform:pa_raw_history_fixture';
const SCOPE = { courseId: 101, homeworkId: 202 };
const ACTIVITY = { id: 202, course_id: 101, type: 'homework', title: '合成作業', published: true, submit_by_group: false };
const SUBMISSION = {
  id: 501, created_by: { id: 303 }, created_at: '2026-11-18T03:00:00Z',
  is_latest_version: true, is_draft: false, is_redo: false, submit_by_instructor: false,
  comment: '保留原始 &lt;內容&gt;<br>第二行', uploads: [{ id: 601, name: '作業.txt', size: 12, key: 'private-key' }],
};
function setup() {
  let binding: TronClassSubmissionBinding = {
    schoolId: 'pu', userId: 303, account: 'synthetic-account', userName: null,
    revision: 'a'.repeat(32), cookies: { session: 'current-server-cookie' }, expiresAt: new Date(NOW + 3600_000).toISOString(),
  };
  const bindings = {
    requireBinding: vi.fn(async (owner: string) => {
      if (owner !== OWNER) throw new NuniError(401, 'TRONCLASS_NOT_CONNECTED');
      return structuredClone(binding);
    }),
    assertCurrent: vi.fn(async (owner: string, revision: string) => {
      if (owner !== OWNER || revision !== binding.revision) throw new NuniError(409, 'TRONCLASS_BINDING_CHANGED');
    }),
  };
  const source: LmsReadonlySource = {
    fetchCourses: vi.fn(async (_cookies, options) => options.status === 'ongoing' ? [{ id: 101, name: '課程' }] : []),
    fetchHomeworkPage: vi.fn(async () => ({ ok: true as const, value: { homework_activities: [ACTIVITY], total: 1 } })),
    fetchActivities: vi.fn(async () => ({ ok: true as const, value: [] })),
    fetchCourseAnnouncements: vi.fn(async () => ({ ok: true as const, value: [] })),
    fetchSiteAnnouncements: vi.fn(async () => ({ ok: true as const, value: [] })),
    fetchHomeworkActivity: vi.fn(async () => ({ ok: true as const, value: ACTIVITY })),
    fetchStudentSubmissionList: vi.fn(async () => ({ ok: true as const, value: { list: [SUBMISSION] } })),
  };
  const expected = { schoolId: binding.schoolId, userId: binding.userId, revision: binding.revision };
  return { bindings, source, expected, reader: createTronClassRawSubmissionHistoryReader({ bindings, source, now: () => NOW }),
    changeBinding(change: Partial<TronClassSubmissionBinding>) { binding = { ...binding, ...change }; } };
}
afterEach(() => vi.useRealTimers());

describe('private authenticated raw school history', () => {
  it('reads only the currently bound student, retaining exact escaped text for internal comparison', async () => {
    const s = setup();
    const raw = await s.reader(OWNER, s.expected, SCOPE);
    expect(raw).toEqual({ list: [SUBMISSION] });
    expect(raw).not.toBe(SUBMISSION);
    expect(s.source.fetchStudentSubmissionList).toHaveBeenCalledExactlyOnceWith({ session: 'current-server-cookie' }, 202, 303,
      { signal: expect.any(AbortSignal), timeoutMs: 8000 });
    expect(s.source.fetchCourses).toHaveBeenCalledTimes(4); // both course lists, before and after the school read
    expect(s.bindings.assertCurrent).toHaveBeenCalledTimes(3);
  });

  it.each([
    { userId: 404 }, { revision: 'b'.repeat(32) }, { schoolId: 'other' },
  ])('rejects stale or foreign expected identity before reading: %j', async change => {
    const s = setup();
    await expect(s.reader(OWNER, { ...s.expected, ...change } as typeof s.expected, SCOPE)).rejects.toBeInstanceOf(NuniError);
    expect(s.source.fetchStudentSubmissionList).not.toHaveBeenCalled();
  });

  it('does not read a student history outside the current course membership', async () => {
    const s = setup();
    await expect(s.reader(OWNER, s.expected, { ...SCOPE, courseId: 999 })).rejects.toMatchObject({ code: 'TRONCLASS_COURSE_ACCESS_DENIED' });
    expect(s.source.fetchStudentSubmissionList).not.toHaveBeenCalled();
  });

  it.each([{ submit_by_group: true }, { submit_by_group: undefined }, { course_id: 999 }, { type: 'exam' }])(
    'rejects an ambiguous activity before reading history: %j', async change => {
      const s = setup();
      vi.mocked(s.source.fetchHomeworkActivity!).mockResolvedValue({ ok: true, value: { ...ACTIVITY, ...change } });
      await expect(s.reader(OWNER, s.expected, SCOPE)).rejects.toMatchObject({ code: 'TRONCLASS_HISTORY_UNAVAILABLE' });
      expect(s.source.fetchStudentSubmissionList).not.toHaveBeenCalled();
    },
  );

  it.each([
    { list: [SUBMISSION], total: 2 }, { list: [SUBMISSION], next_cursor: 'more' },
    { list: [SUBMISSION, SUBMISSION] }, { list: [{ ...SUBMISSION, created_by: { id: 999 } }] },
  ])('rejects incomplete or foreign data without returning a partial record: %j', async raw => {
    const s = setup();
    vi.mocked(s.source.fetchStudentSubmissionList!).mockResolvedValue({ ok: true, value: raw });
    await expect(s.reader(OWNER, s.expected, SCOPE)).rejects.toMatchObject({ code: 'TRONCLASS_HISTORY_UNAVAILABLE' });
  });

  it.each([401, 403, 404, 410])('does not replay content after activity access changes to %i during reading', async status => {
    const s = setup();
    vi.mocked(s.source.fetchStudentSubmissionList!).mockImplementation(async () => {
      vi.mocked(s.source.fetchHomeworkActivity!).mockResolvedValue({ ok: false, status });
      return { ok: true, value: { list: [SUBMISSION] } };
    });
    await expect(s.reader(OWNER, s.expected, SCOPE)).rejects.toMatchObject({
      code: status === 401 ? 'TRONCLASS_RECONNECT_REQUIRED' : status === 403 ? 'TRONCLASS_COURSE_ACCESS_DENIED' : 'TRONCLASS_HOMEWORK_NOT_FOUND',
    });
  });

  it('checks hidden state again after the history response', async () => {
    const s = setup();
    vi.mocked(s.source.fetchStudentSubmissionList!).mockImplementation(async () => {
      vi.mocked(s.source.fetchHomeworkActivity!).mockResolvedValue({ ok: true, value: { ...ACTIVITY, hidden: true } });
      return { ok: true, value: { list: [SUBMISSION] } };
    });
    await expect(s.reader(OWNER, s.expected, SCOPE)).rejects.toMatchObject({ code: 'TRONCLASS_HOMEWORK_NOT_FOUND' });
  });

  it.each([{ revision: 'b'.repeat(32) }, { userId: 404 }, { expiresAt: new Date(NOW).toISOString() }])(
    'discards history if the current binding changes before return: %j', async change => {
      const s = setup();
      vi.mocked(s.source.fetchStudentSubmissionList!).mockImplementation(async () => {
        s.changeBinding(change);
        return { ok: true, value: { list: [SUBMISSION] } };
      });
      await expect(s.reader(OWNER, s.expected, SCOPE)).rejects.toBeInstanceOf(NuniError);
    },
  );

  it('sanitizes upstream messages and does not treat a list 404 as an empty list', async () => {
    const s = setup();
    vi.mocked(s.source.fetchStudentSubmissionList!).mockRejectedValue(new Error('private-cookie and response body'));
    await expect(s.reader(OWNER, s.expected, SCOPE)).rejects.toThrow('TRONCLASS_HISTORY_UNAVAILABLE');
    vi.mocked(s.source.fetchStudentSubmissionList!).mockResolvedValue({ ok: false, status: 404 });
    await expect(s.reader(OWNER, s.expected, SCOPE)).rejects.toMatchObject({ code: 'TRONCLASS_HISTORY_UNAVAILABLE' });
  });

  it('bounds a hung school read and rejects an already cancelled request before school I/O', async () => {
    vi.useFakeTimers();
    const s = setup();
    vi.mocked(s.source.fetchStudentSubmissionList!).mockImplementation(() => new Promise(() => {}));
    const read = createTronClassRawSubmissionHistoryReader({ bindings: s.bindings, source: s.source, now: () => NOW, timeoutMs: 100 });
    const pending = expect(read(OWNER, s.expected, SCOPE)).rejects.toMatchObject({ code: 'TRONCLASS_READ_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(101);
    await pending;
    const controller = new AbortController();
    controller.abort();
    vi.mocked(s.source.fetchCourses).mockClear();
    await expect(read(OWNER, s.expected, SCOPE, controller.signal)).rejects.toMatchObject({ code: 'TRONCLASS_READ_TIMEOUT' });
    expect(s.source.fetchCourses).not.toHaveBeenCalled();
  });

  it('does not start more pages or details after a late response outlives the outer deadline', async () => {
    vi.useFakeTimers();
    const s = setup();
    let finish!: (value: unknown) => void;
    vi.mocked(s.source.fetchCourses).mockImplementation((_cookies, options) => options.status === 'ongoing'
      ? new Promise(resolve => { finish = resolve; }) : Promise.resolve([]));
    const read = createTronClassRawSubmissionHistoryReader({ bindings: s.bindings, source: s.source, now: () => NOW, timeoutMs: 100 });
    const pending = expect(read(OWNER, s.expected, SCOPE)).rejects.toMatchObject({ code: 'TRONCLASS_READ_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(101);
    await pending;
    finish([{ id: 101, name: '課程' }]);
    await vi.runAllTimersAsync();
    expect(s.source.fetchHomeworkPage).not.toHaveBeenCalled();
    expect(s.source.fetchHomeworkActivity).not.toHaveBeenCalled();
    expect(s.source.fetchStudentSubmissionList).not.toHaveBeenCalled();
  });

  it('passes the same cancellation signal to courses, pages, details and the actual history source', async () => {
    const s = setup();
    await s.reader(OWNER, s.expected, SCOPE);
    const options = vi.mocked(s.source.fetchCourses).mock.calls[0][2]!;
    expect(options).toEqual({ signal: expect.any(AbortSignal), timeoutMs: 8000 });
    expect(options.signal!.aborted).toBe(false);
    expect(vi.mocked(s.source.fetchCourses).mock.calls.every(call => call[2] === options)).toBe(true);
    expect(vi.mocked(s.source.fetchHomeworkPage).mock.calls.every(call => call[4] === options)).toBe(true);
    expect(vi.mocked(s.source.fetchHomeworkActivity!).mock.calls.every(call => call[2] === options)).toBe(true);
    expect(vi.mocked(s.source.fetchStudentSubmissionList!).mock.calls[0][3]).toBe(options);
  });

  it.each(['deadline', 'caller'] as const)('actively cancels the history transport on %s, then starts no further GET', async cause => {
    vi.useFakeTimers();
    const s = setup();
    let aborted = false;
    let started!: () => void;
    const didStart = new Promise<void>(resolve => { started = resolve; });
    vi.mocked(s.source.fetchStudentSubmissionList!).mockImplementation((_cookies, _activity, _student, options) => {
      expect(options?.timeoutMs).toBe(100);
      started();
      return new Promise((_resolve, reject) => {
        options!.signal!.addEventListener('abort', () => {
          aborted = true;
          reject(new Error('private transport message'));
        }, { once: true });
      });
    });
    const controller = new AbortController();
    const reader = createTronClassRawSubmissionHistoryReader({ bindings: s.bindings, source: s.source, now: () => NOW, timeoutMs: 100 });
    const pending = expect(reader(OWNER, s.expected, SCOPE, controller.signal)).rejects.toMatchObject({ code: 'TRONCLASS_READ_TIMEOUT' });
    await didStart;
    const courseReads = vi.mocked(s.source.fetchCourses).mock.calls.length;
    const activityReads = vi.mocked(s.source.fetchHomeworkActivity!).mock.calls.length;
    if (cause === 'deadline') await vi.advanceTimersByTimeAsync(101);
    else controller.abort();
    await pending;
    expect(aborted).toBe(true);
    expect(s.source.fetchCourses).toHaveBeenCalledTimes(courseReads);
    expect(s.source.fetchHomeworkActivity).toHaveBeenCalledTimes(activityReads);
  });
});

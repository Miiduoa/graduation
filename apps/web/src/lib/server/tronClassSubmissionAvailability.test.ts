// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { NuniError } from '@campus/shared/src/nuni';
import { isTronClassSubmissionAvailability } from '@campus/shared/src/tronClassSubmissionAvailability';
import type { LmsReadonlySource, LmsReadResult } from './tronClassLmsSource';
import type { TronClassSubmissionBinding } from './tronClassSubmissionSource';
import { createTronClassSubmissionAvailabilityReader, normalizeTronClassSubmissionAvailability } from './tronClassSubmissionAvailability';

const NOW = Date.parse('2027-02-16T03:00:00.000Z');
const OWNER = 'platform:pa_availability_fixture';
const REVISION = 'a'.repeat(32);
const SCOPE = { courseId: 101, homeworkId: 202 };
const IDENTITY = { userId: 303, revision: REVISION };
const COURSE_PAGE = '<input type="hidden" id="courseId" value="101"><input type="hidden" id="enrollment-is-student" value="True">';
// Synthetic contract cases derived from public client field accesses. These
// populated special-record payloads are not live student captures. The exact
// empty envelope has been independently observed; all IDs below remain synthetic.
const ACTIVITY = {
  id: 202, course_id: 101, type: 'homework', published: true, submit_by_group: false,
  is_started: true, is_in_progress: true, is_closed: false, is_resubmit_open: true,
  user_submit_count: 0, non_submit_times: false, submit_times: 3, data: { mode: 'normal' },
};
const SUBMISSION = {
  id: 401, activity_id: 202, created_by: { id: 303 }, created_at: '2027-02-15T01:00:00Z',
  is_latest_version: true, is_draft: false, is_redo: false, marked_submitted: true, submit_by_instructor: false,
  group: null, group_id: null, mode: 'normal', comment: 'synthetic private body', uploads: [],
};
const MAKE_UP = { has_submitted: false, make_up_is_closed: false, last_updated_time: '2027-02-16T01:00:00Z' };
const RESUBMIT = { has_submitted: false, resubmit_is_closed: false, last_updated_time: '2027-02-16T02:00:00Z' };

function project(change: {
  activity?: Record<string, unknown>; history?: unknown; makeUp?: unknown; resubmit?: unknown;
} = {}) {
  return normalizeTronClassSubmissionAvailability({
    activity: { ...ACTIVITY, ...change.activity }, history: change.history ?? { list: [] },
    makeUp: change.makeUp === undefined ? { make_up_record: null } : change.makeUp,
    resubmit: change.resubmit === undefined ? { resubmit_record: null } : change.resubmit,
  }, IDENTITY, SCOPE, NOW);
}

function setup() {
  let binding: TronClassSubmissionBinding = {
    schoolId: 'pu', ...IDENTITY, account: 'synthetic-account', userName: null,
    cookies: { session: 'synthetic-server-cookie' }, expiresAt: new Date(NOW + 3600_000).toISOString(),
  };
  let activity: Record<string, unknown> = { ...ACTIVITY };
  let history: unknown = { list: [] };
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
    fetchCourses: vi.fn(async (_cookies, query) => query.status === 'ongoing' ? [{ id: 101, name: '合成課程', role: 'student' }] : []),
    fetchHomeworkPage: vi.fn(async () => ({ ok: true as const, value: {
      homework_activities: [{ id: 202, title: '合成作業', published: true, submitted: false }], total: 1,
    } })),
    fetchActivities: vi.fn(async () => ({ ok: true as const, value: [] })),
    fetchCourseAnnouncements: vi.fn(async () => ({ ok: true as const, value: [] })),
    fetchSiteAnnouncements: vi.fn(async () => ({ ok: true as const, value: [] })),
    fetchHomeworkActivity: vi.fn(async () => ({ ok: true as const, value: structuredClone(activity) })),
    fetchCoursePage: vi.fn(async () => ({ ok: true as const, value: COURSE_PAGE })),
    fetchStudentSubmissionList: vi.fn(async () => ({ ok: true as const, value: structuredClone(history) })),
    fetchStudentMakeUpRecord: vi.fn(async () => ({ ok: true as const, value: { make_up_record: null } })),
    fetchStudentResubmitRecord: vi.fn(async () => ({ ok: true as const, value: { resubmit_record: null } })),
  };
  return {
    bindings, source,
    reader: createTronClassSubmissionAvailabilityReader({ bindings, source, now: () => NOW }),
    changeBinding(change: Partial<TronClassSubmissionBinding>) { binding = { ...binding, ...change }; },
    changeActivity(change: Record<string, unknown>) { activity = { ...activity, ...change }; },
    setHistory(value: unknown) { history = value; },
  };
}
afterEach(() => vi.useRealTimers());

describe('read-only personal submission windows', () => {
  it('distinguishes first submission from ordinary repeat attempts without a special record', () => {
    const first = project();
    expect(first).toMatchObject({
      state: 'available', ordinary: { state: 'open', kind: 'first', remainingAttempts: 3 },
      makeUp: { state: 'none' }, resubmit: { state: 'none' }, draft: { state: 'none', count: 0, submissionId: null },
    });
    const repeat = project({ activity: { user_submit_count: 1 }, history: { list: [SUBMISSION] } });
    expect(repeat.ordinary).toEqual({ state: 'open', kind: 'repeat', remainingAttempts: 2 });
    for (const result of [first, repeat]) {
      expect(isTronClassSubmissionAvailability(result, SCOPE, REVISION)).toBe(true);
      expect(result).not.toHaveProperty('canSubmit');
      expect(result).not.toHaveProperty('contractVerified');
    }
  });

  it('shows exhausted ordinary attempts separately from unused personal make-up and resubmit records', () => {
    const result = project({
      activity: { user_submit_count: 1, submit_times: 1 }, history: { list: [SUBMISSION] },
      makeUp: { make_up_record: MAKE_UP }, resubmit: { resubmit_record: RESUBMIT },
    });
    expect(result.ordinary).toEqual({ state: 'attempts-exhausted', kind: 'repeat', remainingAttempts: 0 });
    expect(result.makeUp).toEqual({ state: 'open', updatedAt: '2027-02-16T01:00:00.000Z' });
    expect(result.resubmit).toEqual({ state: 'open', updatedAt: '2027-02-16T02:00:00.000Z' });
    expect(isTronClassSubmissionAvailability(result, SCOPE, REVISION)).toBe(true);
  });

  it('maps exact empty JSON envelopes to no personal records without granting a writer capability', () => {
    const result = project({ makeUp: {}, resubmit: {} });
    expect(result.makeUp).toEqual({ state: 'none', updatedAt: null });
    expect(result.resubmit).toEqual({ state: 'none', updatedAt: null });
    expect(result.ordinary).toEqual(project().ordinary);
    expect(result).not.toHaveProperty('canSubmit');
    expect(result).not.toHaveProperty('contractVerified');
    expect(isTronClassSubmissionAvailability(result, SCOPE, REVISION)).toBe(true);
    expect(project({ makeUp: Object.create(null), resubmit: Object.create(null) })).toMatchObject({
      makeUp: { state: 'none' }, resubmit: { state: 'none' },
    });
  });

  it.each([
    null, [], '', { error: 'synthetic-error' }, { unknown: null },
    { make_up_record: {}, resubmit_record: {} },
    new Date(NOW), new Map(), Object.create({ inherited: true }),
    Object.defineProperty({}, 'hidden', { value: true }), { [Symbol('synthetic')]: true },
  ].map(raw => [raw]))('does not extend empty-envelope semantics to malformed or non-JSON values: %j', raw => {
    const result = project({ makeUp: raw, resubmit: raw });
    expect(result.makeUp.state).toBe('unknown');
    expect(result.resubmit.state).toBe('unknown');
  });

  it.each([
    [{ is_started: false, is_in_progress: false }, 'not-started'],
    [{ is_closed: true, is_in_progress: false }, 'closed'],
    [{ is_started: undefined }, 'unknown'],
    [{ is_closed: undefined }, 'unknown'],
    [{ is_in_progress: 'true' }, 'unknown'],
    [{ user_submit_count: 1 }, 'unknown'],
    [{ submit_times: '3x' }, 'unknown'],
    [{ non_submit_times: true, submit_times: 3 }, 'unknown'],
    [{ data: { non_submit_times: true } }, 'unknown'],
  ])('retains source window uncertainty or an explicit closure: %j', (activity, state) => {
    expect(project({ activity }).ordinary.state).toBe(state);
  });

  it('accepts explicit unlimited and exact decimal limits but not missing attempt counts', () => {
    expect(project({ activity: { non_submit_times: true, submit_times: null } }).ordinary)
      .toEqual({ state: 'open', kind: 'first', remainingAttempts: null });
    expect(project({ activity: { submit_times: '3' } }).ordinary.remainingAttempts).toBe(3);
    expect(project({ activity: { user_submit_count: undefined } }).ordinary.state).toBe('unknown');
  });

  it.each([
    [{ has_submitted: true }, 'used'],
    [{ has_submitted: false, make_up_is_closed: true }, 'closed'],
    [{ has_submitted: false, make_up_is_closed: false }, 'open'],
    [{ has_submitted: false }, 'unknown'],
    [{ has_submitted: 'false', make_up_is_closed: false }, 'unknown'],
    [{ submitted: false, is_closed: false, closed_time: '2027-02-20T00:00:00Z' }, 'unknown'],
  ])('uses only the student make-up endpoint schema: %j', (row, state) => {
    expect(project({ makeUp: { make_up_record: row } }).makeUp.state).toBe(state);
  });

  it('does not infer a personal resubmit permission from the activity setting alone', () => {
    expect(project().resubmit.state).toBe('none');
    expect(project({ resubmit: {} }).resubmit.state).toBe('none');
    expect(project({ resubmit: { unknown: null } }).resubmit.state).toBe('unknown');
    expect(project({ activity: { is_resubmit_open: false }, resubmit: { resubmit_record: RESUBMIT } }).resubmit.state).toBe('disabled');
    expect(project({ activity: { is_resubmit_open: undefined }, resubmit: { resubmit_record: RESUBMIT } }).resubmit.state).toBe('unknown');
    expect(project({ resubmit: { resubmit_record: { ...RESUBMIT, has_submitted: true } } }).resubmit.state).toBe('used');
    expect(project({ resubmit: { resubmit_record: { ...RESUBMIT, resubmit_is_closed: true } } }).resubmit.state).toBe('closed');
  });

  it('identifies one owned draft without relabelling it as a formal attempt or returned version', () => {
    const result = project({ history: { list: [{ ...SUBMISSION, is_draft: true, marked_submitted: false }] } });
    expect(result.draft).toEqual({ state: 'available', count: 1, submissionId: '401' });
    expect(result.ordinary.kind).toBe('first');
    const returned = project({ history: { list: [{ ...SUBMISSION, is_redo: true, marked_submitted: false }] } });
    expect(returned.draft).toEqual({ state: 'none', count: 0, submissionId: null });
    expect(returned.ordinary.kind).toBe('repeat');
  });

  it('does not select a draft arbitrarily when there are several or flags are incomplete', () => {
    const draft = { ...SUBMISSION, is_draft: true, marked_submitted: false, is_latest_version: false };
    expect(project({ history: { list: [draft, { ...draft, id: 402 }] } }).draft)
      .toEqual({ state: 'ambiguous', count: 2, submissionId: null });
    expect(project({ history: { list: [{ ...draft, is_redo: undefined }] } }).draft)
      .toEqual({ state: 'unknown', count: null, submissionId: null });
  });

  it('rejects foreign, incomplete or duplicate personal history before deriving any draft selector', () => {
    for (const history of [
      { list: [{ ...SUBMISSION, created_by: { id: 999 } }] },
      { list: [], total: 1 }, { list: [SUBMISSION, SUBMISSION] },
    ]) expect(() => project({ history })).toThrow();
  });

  it.each(['student_id', 'user_id', 'activity_id', 'homework_id', 'course_id', 'group_id'])(
    'rejects a contradictory special-record scope: %s', key => {
      expect(() => project({ makeUp: { make_up_record: { ...MAKE_UP, [key]: 999 } } })).toThrow('TRONCLASS_AVAILABILITY_UNAVAILABLE');
    },
  );

  it('projects no names, body, credentials, teacher identity or unknown source fields', () => {
    const result = project({
      activity: { created_by: { id: 999, email: 'private-instructor' }, cookies: 'private-cookie' },
      history: { list: [{ ...SUBMISSION, marked_submitted: false, is_draft: true }] },
      makeUp: { make_up_record: { ...MAKE_UP, created_by: { id: 999 }, comment: 'private-remarks', url: 'https://private.test' } },
    });
    expect(JSON.stringify(result)).not.toMatch(/private|created_by|cookies|comment|https:/);
    expect(isTronClassSubmissionAvailability(result, SCOPE, REVISION)).toBe(true);
  });
});

describe('availability reader ownership and freshness', () => {
  it('reads fixed student records from the binding and rechecks course role and binding before returning', async () => {
    const s = setup();
    const result = await s.reader(OWNER, SCOPE, REVISION);
    expect(result).toMatchObject({ ...SCOPE, revision: REVISION, ordinary: { state: 'open' } });
    for (const method of [s.source.fetchStudentSubmissionList!, s.source.fetchStudentMakeUpRecord!, s.source.fetchStudentResubmitRecord!]) {
      expect(method).toHaveBeenCalledWith({ session: 'synthetic-server-cookie' }, 202, 303,
        { signal: expect.any(AbortSignal), timeoutMs: expect.any(Number) });
    }
    expect(s.source.fetchCoursePage).toHaveBeenCalledTimes(2);
    expect(s.bindings.assertCurrent.mock.calls.every(call => call[0] === OWNER && call[1] === REVISION)).toBe(true);
    expect(isTronClassSubmissionAvailability(result, SCOPE, REVISION)).toBe(true);
  });

  it('preserves successful empty special records after the normal ownership and freshness checks', async () => {
    const s = setup();
    vi.mocked(s.source.fetchStudentMakeUpRecord!).mockResolvedValue({ ok: true, value: {} });
    vi.mocked(s.source.fetchStudentResubmitRecord!).mockResolvedValue({ ok: true, value: {} });
    const result = await s.reader(OWNER, SCOPE, REVISION);
    expect(result).toMatchObject({
      ...SCOPE, revision: REVISION, ordinary: { state: 'open' },
      makeUp: { state: 'none' }, resubmit: { state: 'none' },
    });
    expect(s.source.fetchCoursePage).toHaveBeenCalledTimes(2);
    expect(s.bindings.assertCurrent.mock.calls.every(call => call[0] === OWNER && call[1] === REVISION)).toBe(true);
    expect(isTronClassSubmissionAvailability(result, SCOPE, REVISION)).toBe(true);
  });

  it('uses the preparation snapshot for the course and all student-specific records', async () => {
    const s = setup();
    const binding = await s.bindings.requireBinding(OWNER);
    s.bindings.requireBinding.mockClear().mockResolvedValue({ ...binding, revision: 'b'.repeat(32), cookies: {} });
    await expect(s.reader(OWNER, SCOPE, REVISION, undefined, binding)).resolves.toMatchObject({ revision: REVISION });
    expect(s.bindings.requireBinding).not.toHaveBeenCalled();
    for (const method of [s.source.fetchCourses, s.source.fetchStudentSubmissionList!,
      s.source.fetchStudentMakeUpRecord!, s.source.fetchStudentResubmitRecord!]) {
      expect(method).toHaveBeenCalled();
      for (const [cookies] of vi.mocked(method).mock.calls) expect(cookies).toEqual(binding.cookies);
    }
  });

  it('does not mix a preparation with an already replaced binding', async () => {
    const s = setup();
    s.changeBinding({ revision: 'b'.repeat(32) });
    await expect(s.reader(OWNER, SCOPE, REVISION)).rejects.toMatchObject({ code: 'TRONCLASS_BINDING_CHANGED' });
    expect(s.source.fetchCourses).not.toHaveBeenCalled();
  });

  it('stops before the next student read when history delivery changes the bound account', async () => {
    const s = setup();
    vi.mocked(s.source.fetchStudentSubmissionList!).mockImplementationOnce(async () => {
      s.changeBinding({ userId: 999, revision: 'b'.repeat(32) });
      return { ok: true, value: { list: [] } };
    });
    await expect(s.reader(OWNER, SCOPE, REVISION)).rejects.toMatchObject({ code: 'TRONCLASS_BINDING_CHANGED' });
    expect(s.source.fetchStudentMakeUpRecord).not.toHaveBeenCalled();
    expect(s.source.fetchStudentResubmitRecord).not.toHaveBeenCalled();
  });

  it.each(['missing', 'teacher', 'changed'] as const)('requires an explicit current student course role: %s', async mode => {
    const s = setup();
    const wrong = COURSE_PAGE.replace('value="True"', 'value="False"');
    if (mode === 'changed') vi.mocked(s.source.fetchCoursePage!).mockResolvedValueOnce({ ok: true, value: COURSE_PAGE }).mockResolvedValueOnce({ ok: true, value: wrong });
    else vi.mocked(s.source.fetchCoursePage!).mockResolvedValue({ ok: true, value: mode === 'missing' ? '<input id="courseId" value="101">' : wrong });
    await expect(s.reader(OWNER, SCOPE, REVISION)).rejects.toMatchObject({ code: expect.stringMatching(/COURSE|AVAILABILITY/) });
  });

  it('does not let an explicit non-student list role pass via the display fallback', async () => {
    const s = setup();
    vi.mocked(s.source.fetchCourses).mockResolvedValue([{ id: 101, role: 'instructor' }]);
    await expect(s.reader(OWNER, SCOPE, REVISION)).rejects.toMatchObject({ code: 'TRONCLASS_COURSE_ACCESS_DENIED' });
    expect(s.source.fetchStudentSubmissionList).not.toHaveBeenCalled();
  });

  it('keeps a failed or missing special-record reader unknown, while preserving ordinary preparation', async () => {
    const s = setup();
    vi.mocked(s.source.fetchStudentMakeUpRecord!).mockResolvedValue({ ok: false, status: 502 });
    s.source.fetchStudentResubmitRecord = undefined;
    const result = await s.reader(OWNER, SCOPE, REVISION);
    expect(result.ordinary.state).toBe('open');
    expect(result.makeUp.state).toBe('unknown');
    expect(result.resubmit.state).toBe('unknown');
  });

  it.each([
    ['make-up', 401], ['make-up', 403], ['resubmit', 401], ['resubmit', 403],
  ] as const)('does not soften an authorization error from the %s endpoint: %s', async (kind, status) => {
    const s = setup();
    vi.mocked(s.source.fetchStudentMakeUpRecord!).mockResolvedValue({ ok: true, value: {} });
    const method = kind === 'make-up' ? s.source.fetchStudentMakeUpRecord! : s.source.fetchStudentResubmitRecord!;
    vi.mocked(method).mockResolvedValue({ ok: false, status });
    await expect(s.reader(OWNER, SCOPE, REVISION)).rejects.toMatchObject({ status });
    if (kind === 'make-up') expect(s.source.fetchStudentResubmitRecord).not.toHaveBeenCalled();
  });

  it('does not read a personal history or invent group membership for group homework', async () => {
    const s = setup();
    s.changeActivity({ submit_by_group: true, group_set_id: 777 });
    const result = await s.reader(OWNER, SCOPE, REVISION);
    expect(result.state).toBe('group-unsupported');
    expect(result.draft.submissionId).toBeNull();
    expect(s.source.fetchStudentSubmissionList).not.toHaveBeenCalled();
    expect(s.source.fetchStudentMakeUpRecord).not.toHaveBeenCalled();
    expect(isTronClassSubmissionAvailability(result, SCOPE, REVISION)).toBe(true);
  });

  it('does not return a late personal result after the activity changes to a group', async () => {
    const s = setup();
    vi.mocked(s.source.fetchStudentResubmitRecord!).mockImplementationOnce(async () => {
      s.changeActivity({ submit_by_group: true });
      return { ok: true, value: { resubmit_record: null } };
    });
    await expect(s.reader(OWNER, SCOPE, REVISION)).rejects.toMatchObject({ code: 'TRONCLASS_AVAILABILITY_UNAVAILABLE' });
  });

  it('shares one deadline and stops late source responses from starting the next request', async () => {
    vi.useFakeTimers();
    const s = setup();
    let finish!: (value: LmsReadResult<unknown>) => void;
    vi.mocked(s.source.fetchStudentMakeUpRecord!).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const reader = createTronClassSubmissionAvailabilityReader({ bindings: s.bindings, source: s.source, now: () => NOW, timeoutMs: 50 });
    const pending = expect(reader(OWNER, SCOPE, REVISION)).rejects.toMatchObject({ code: 'TRONCLASS_READ_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(50);
    await pending;
    finish({ ok: true, value: { make_up_record: MAKE_UP } });
    await vi.advanceTimersByTimeAsync(0);
    expect(s.source.fetchStudentResubmitRecord).not.toHaveBeenCalled();
  });

  it('honors cancellation before any owner or school request', async () => {
    const s = setup();
    const controller = new AbortController();
    controller.abort();
    await expect(s.reader(OWNER, SCOPE, REVISION, controller.signal)).rejects.toMatchObject({ code: 'TRONCLASS_READ_TIMEOUT' });
    expect(s.bindings.requireBinding).not.toHaveBeenCalled();
    expect(s.source.fetchCourses).not.toHaveBeenCalled();
  });

  it('sanitizes unexpected private source exceptions', async () => {
    const s = setup();
    vi.mocked(s.source.fetchCourses).mockRejectedValue(new Error('private-cookie private-body https://private.test'));
    await expect(s.reader(OWNER, SCOPE, REVISION)).rejects.toMatchObject({
      code: 'TRONCLASS_AVAILABILITY_UNAVAILABLE', message: 'TRONCLASS_AVAILABILITY_UNAVAILABLE',
    });
  });
});

describe('shared preparation boundary', () => {
  it('requires the exact enclosing scope and current binding revision', () => {
    const result = project();
    expect(isTronClassSubmissionAvailability(result, { ...SCOPE, courseId: 999 }, REVISION)).toBe(false);
    expect(isTronClassSubmissionAvailability(result, SCOPE, 'b'.repeat(32))).toBe(false);
    expect(isTronClassSubmissionAvailability({ ...result, student_id: 303 }, SCOPE, REVISION)).toBe(false);
  });

  it('rejects contradictory DTO states and any raw record fields', () => {
    const result = project();
    for (const value of [
      { ...result, state: 'unavailable' },
      { ...result, ordinary: { ...result.ordinary, state: 'open', remainingAttempts: 0 } },
      { ...result, ordinary: { ...result.ordinary, state: 'attempts-exhausted', remainingAttempts: 2 } },
      { ...result, makeUp: { state: 'disabled', updatedAt: null } },
      { ...result, resubmit: { ...result.resubmit, cookies: 'private' } },
      { ...result, draft: { state: 'none', submissionId: '401', count: 0 } },
      { ...result, draft: { state: 'available', submissionId: '../other', count: 1 } },
      { ...result, draft: { state: 'ambiguous', submissionId: null, count: 1 } },
    ]) expect(isTronClassSubmissionAvailability(value, SCOPE, REVISION)).toBe(false);
  });
});

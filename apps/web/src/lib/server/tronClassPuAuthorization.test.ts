// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { NuniError } from '@campus/shared/src/nuni';
import { createTronClassPuAuthorizationReader } from './tronClassPuAuthorization';
import { assertTronClassCandidateAuthorization } from './tronClassSubmissionCandidate';
import type { LmsReadonlySource, LmsReadOptions, LmsReadResult } from './tronClassLmsSource';
import type { TronClassHomeworkScope, TronClassSubmissionBinding } from './tronClassSubmissionSource';

// This is a deidentified shape from the documented live read, not a stored
// private response. All identifiers, names, content and dates are synthetic.
const NOW = Date.parse('2027-02-16T03:00:00.000Z');
const OWNER = 'platform:pa_pu_authorization_fixture';
const SCOPE = { courseId: 101, homeworkId: 202 };
const COURSE_PAGE = '<!doctype html><input type="hidden" id="courseId" value="101"><input type="hidden" id="enrollment-is-student" value="True">';
const ACTIVITY = {
  id: 202, course_id: 101, type: 'homework', title: '合成練習', published: true,
  submit_by_group: false, is_assigned_to_all: true, has_assign_student: false, has_assign_group: false,
  is_started: true, is_in_progress: true, is_closed: false, need_make_up: false,
  non_submit_times: true, submit_times: null, user_submit_count: 0, prerequisites: [], teaching_model: 'online',
  start_time: '2027-02-14T00:00:00Z', end_time: '2027-02-20T12:00:00Z', is_resubmit_open: true,
  using_phase: 'unspecified', version: null,
  data: { mode: 'normal', homework_type: 'file_upload', has_assign_target: false, allow_retract: true,
    non_submit_times: true, submit_times: null, description: '<p>合成說明 &amp; 第二段</p>' },
};
const SUBMISSION = {
  id: 401, activity_id: 202, created_by: { id: 303 }, created_at: '2027-02-15T01:00:00Z',
  is_latest_version: true, is_draft: false, is_redo: false, marked_submitted: true, submit_by_instructor: false,
  group: null, group_id: null, mode: 'normal', comment: '合成歷史內容', uploads: [],
};
function setup() {
  let at = NOW;
  let activity: Record<string, unknown> = structuredClone(ACTIVITY);
  let history: unknown = { list: [] };
  let binding: TronClassSubmissionBinding = {
    schoolId: 'pu', userId: 303, account: 'synthetic-account', userName: null,
    revision: 'a'.repeat(32), cookies: { session: 'synthetic-server-cookie' }, expiresAt: new Date(NOW + 3600_000).toISOString(),
  };
  const bindings = {
    requireBinding: vi.fn(async (owner: string) => {
      if (owner !== OWNER) throw new NuniError(401, 'TRONCLASS_NOT_CONNECTED');
      return structuredClone(binding);
    }),
    assertCurrent: vi.fn(async (owner: string, revision: string, studentId?: number) => {
      if (owner !== OWNER || revision !== binding.revision || studentId !== binding.userId || Date.parse(binding.expiresAt) <= NOW) throw new NuniError(409, 'TRONCLASS_BINDING_CHANGED');
    }),
  };
  const source: LmsReadonlySource = {
    fetchCourses: vi.fn(async (_cookies, options) => options.status === 'ongoing' ? [{ id: 101, name: '合成課程', role: 'student' }] : []),
    fetchHomeworkPage: vi.fn(async () => ({ ok: true as const, value: {
      homework_activities: [{ id: 202, title: '清單標題', published: true, submitted: false }], total: 1,
    } })),
    fetchActivities: vi.fn(async () => ({ ok: true as const, value: [] })),
    fetchCourseAnnouncements: vi.fn(async () => ({ ok: true as const, value: [] })),
    fetchSiteAnnouncements: vi.fn(async () => ({ ok: true as const, value: [] })),
    fetchHomeworkActivity: vi.fn(async () => ({ ok: true as const, value: structuredClone(activity) })),
    fetchCoursePage: vi.fn(async () => ({ ok: true as const, value: COURSE_PAGE })),
    fetchStudentSubmissionList: vi.fn(async () => ({ ok: true as const, value: structuredClone(history) })),
  };
  const now = () => at;
  return {
    bindings, source, now, reader: createTronClassPuAuthorizationReader({ bindings, source, now }),
    changeBinding(change: Partial<TronClassSubmissionBinding>) { binding = { ...binding, ...change }; },
    changeActivity(change: Record<string, unknown>) { activity = { ...activity, ...change }; },
    changeData(change: Record<string, unknown>) { activity.data = { ...activity.data as Record<string, unknown>, ...change }; },
    removeActivity(key: string) { delete activity[key]; },
    removeData(key: string) { delete (activity.data as Record<string, unknown>)[key]; },
    setHistory(value: unknown) { history = value; },
    setNow(value: number) { at = value; },
  };
}
afterEach(() => vi.useRealTimers());

describe('PU source-backed first individual submission authorization', () => {
  it('confirms ordinary normal text only from complete membership, precise source flags and empty own history', async () => {
    const s = setup();
    s.changeActivity({ created_by: { id: 999, email: 'private-fixture@example.test' }, reference_answer: 'private-fixture' });
    const result = await s.reader(OWNER, SCOPE);
    expect(result).toMatchObject({
      binding: { schoolId: 'pu', userId: 303, revision: 'a'.repeat(32) },
      mode: 'normal', historyComplete: true, priorSubmissionIds: [], userSubmitCount: 0,
      ordinaryWindowConfirmed: true, prerequisitesConfirmed: true,
      assignment: {
        ...SCOPE, studentId: 303, title: '合成練習', description: '合成說明 & 第二段',
        opensAt: '2027-02-14T00:00:00.000Z', deadline: '2027-02-20T12:00:00.000Z',
        permissionKnown: true, individual: true, canSubmit: true, isClosed: false, allowLate: false,
        remainingAttempts: null, allowsText: true, allowsAttachments: false,
        maxFiles: 0, maxFileBytes: 0, maxTotalBytes: 0, allowedContentTypes: [],
        details: { status: 'available', fetchedAt: new Date(NOW).toISOString(), submissionType: 'individual',
          mode: 'normal', resubmissionOpen: true, retractAllowed: true,
          attempts: { unlimited: true, limit: null, used: 0, remaining: null } },
      },
    });
    expect(() => assertTronClassCandidateAuthorization(result, SCOPE, NOW)).not.toThrow();
    expect(JSON.stringify(result.assignment)).not.toContain('private-fixture');
    expect(JSON.stringify(result.assignment)).not.toContain('synthetic-server-cookie');
    expect(result).not.toHaveProperty('contractVerified');
    expect(s.source.fetchStudentSubmissionList).toHaveBeenCalledTimes(2);
    for (const call of vi.mocked(s.source.fetchStudentSubmissionList!).mock.calls) {
      expect(call).toEqual([{ session: 'synthetic-server-cookie' }, 202, 303, { signal: expect.any(AbortSignal), timeoutMs: 8000 }]);
    }
    expect(s.source.fetchCourses).toHaveBeenCalledTimes(4);
    expect(vi.mocked(s.source.fetchCourses).mock.calls.every(call => call[1].userId === 303)).toBe(true);
    expect(s.source.fetchHomeworkPage).toHaveBeenCalledTimes(2);
    expect(s.source.fetchCoursePage).toHaveBeenCalledTimes(2);
    for (const call of vi.mocked(s.source.fetchCoursePage!).mock.calls) {
      expect(call).toEqual([{ session: 'synthetic-server-cookie' }, 101, { signal: expect.any(AbortSignal), timeoutMs: 8000 }]);
    }
    expect(s.bindings.assertCurrent).toHaveBeenCalledTimes(3);
  });

  it.each([1, 3, '3', Number.MAX_SAFE_INTEGER])('accepts an exact positive finite source limit: %s', async limit => {
    const s = setup();
    s.changeActivity({ non_submit_times: false, submit_times: limit });
    s.changeData({ non_submit_times: false, submit_times: limit });
    expect((await s.reader(OWNER, SCOPE)).assignment.remainingAttempts).toBe(Number(limit));
  });

  it.each([0, -1, 1.5, '03', '2x', '1e2', ' 2', '+2', '2.0', '', null, undefined, Number.NaN, Number.MAX_SAFE_INTEGER + 1])(
    'does not invent a remaining attempt from an unknown or exhausted finite limit: %s', async limit => {
      const s = setup();
      s.changeActivity({ non_submit_times: false, submit_times: limit });
      s.changeData({ non_submit_times: false, submit_times: limit });
      await expect(s.reader(OWNER, SCOPE)).rejects.toMatchObject({ code: 'TRONCLASS_SUBMISSION_BLOCKED' });
      expect(s.source.fetchStudentSubmissionList).not.toHaveBeenCalled();
    },
  );

  it.each([
    { non_submit_times: true, submit_times: 3 }, { non_submit_times: true, submit_times: undefined },
    { non_submit_times: undefined, submit_times: null }, { non_submit_times: 'true', submit_times: null },
  ])('requires an explicit coherent unlimited declaration: %j', async change => {
    const s = setup();
    s.changeActivity(change);
    await expect(s.reader(OWNER, SCOPE)).rejects.toMatchObject({ code: 'TRONCLASS_SUBMISSION_BLOCKED' });
  });

  it.each([{ non_submit_times: false }, { submit_times: 2 }, { submit_times: undefined }])(
    'refuses conflicting or ambiguous duplicate data settings: %j', async change => {
      const s = setup();
      s.changeData(change);
      await expect(s.reader(OWNER, SCOPE)).rejects.toMatchObject({ code: 'TRONCLASS_SUBMISSION_BLOCKED' });
    },
  );

  it('uses explicit top-level settings when duplicate data settings are absent', async () => {
    const s = setup();
    s.removeData('non_submit_times');
    s.removeData('submit_times');
    expect((await s.reader(OWNER, SCOPE)).assignment.remainingAttempts).toBeNull();
  });

  it.each([
    ['submit_by_group', true], ['submit_by_group', undefined], ['is_assigned_to_all', false], ['is_assigned_to_all', undefined],
    ['has_assign_student', true], ['has_assign_student', undefined], ['has_assign_group', true], ['has_assign_group', undefined],
    ['is_started', false], ['is_started', 1], ['is_in_progress', false], ['is_in_progress', 'true'],
    ['is_closed', true], ['is_closed', undefined], ['need_make_up', true], ['need_make_up', undefined],
    ['user_submit_count', 1], ['user_submit_count', '0'], ['user_submit_count', undefined],
    ['teaching_model', 'offline'], ['teaching_model', undefined],
    ['prerequisites', [{}]], ['prerequisites', null], ['prerequisites', undefined],
  ])('does not infer the required source condition %s from %j', async (key, value) => {
    const s = setup();
    s.changeActivity({ [key as string]: value });
    await expect(s.reader(OWNER, SCOPE)).rejects.toMatchObject({ code: 'TRONCLASS_SUBMISSION_BLOCKED' });
    expect(s.source.fetchStudentSubmissionList).not.toHaveBeenCalled();
  });

  it.each([
    { has_assign_target: true }, { has_assign_target: undefined }, { mode: 'multiple' }, { mode: undefined },
    { homework_type: 'external' }, { homework_type: undefined },
  ])('requires the observed normal individual assignment mode: %j', async change => {
    const s = setup();
    s.changeData(change);
    await expect(s.reader(OWNER, SCOPE)).rejects.toMatchObject({ code: 'TRONCLASS_SUBMISSION_BLOCKED' });
  });

  it.each([{ id: '202' }, { id: 999 }, { course_id: 999 }, { course_id: undefined }, { type: 'exam' },
    { published: false }, { published: undefined }, { published: 1 }, { hidden: true }])(
    'rejects a mismatched or non-explicitly-published activity before own history: %j', async change => {
      const s = setup();
      s.changeActivity(change);
      await expect(s.reader(OWNER, SCOPE)).rejects.toBeInstanceOf(NuniError);
      expect(s.source.fetchStudentSubmissionList).not.toHaveBeenCalled();
    },
  );

  it.each(['teacher', 'instructor', 'assistant', null, undefined])('does not turn an explicit non-student course role into permission: %s', async role => {
    const s = setup();
    vi.mocked(s.source.fetchCourses).mockImplementation(async (_cookies, options) => options.status === 'ongoing' ? [{ id: '101', role }] : []);
    await expect(s.reader(OWNER, SCOPE)).rejects.toMatchObject({ code: 'TRONCLASS_COURSE_ACCESS_DENIED' });
    expect(s.source.fetchHomeworkPage).not.toHaveBeenCalled();
    expect(s.source.fetchStudentSubmissionList).not.toHaveBeenCalled();
  });

  it('rejects a conflicting teacher role in the second course list', async () => {
    const s = setup();
    vi.mocked(s.source.fetchCourses).mockImplementation(async (_cookies, options) => [{ id: 101, role: options.status === 'ongoing' ? 'student' : 'teacher' }]);
    await expect(s.reader(OWNER, SCOPE)).rejects.toMatchObject({ code: 'TRONCLASS_COURSE_ACCESS_DENIED' });
  });

  it('requires independent positive enrollment when the legacy course list lacks role provenance', async () => {
    const s = setup();
    // The normalized course role is not the proof: both actual course pages
    // must independently confirm this binding's student enrollment.
    vi.mocked(s.source.fetchCourses).mockImplementation(async (_cookies, options) => options.status === 'ongoing' ? [{ id: 101 }] : []);
    const result = await s.reader(OWNER, SCOPE);
    expect(result.assignment.allowsText).toBe(true);
    expect(result).not.toHaveProperty('contractVerified');
    expect(s.source.fetchCoursePage).toHaveBeenCalledTimes(2);
  });

  it.each(['missing', 'defaulted'] as const)('does not grant from %s role without positive HTML enrollment', async role => {
    const s = setup();
    vi.mocked(s.source.fetchCourses).mockImplementation(async (_cookies, options) => options.status === 'ongoing'
      ? [{ id: 101, ...(role === 'defaulted' ? { role: 'student' } : {}) }] : []);
    vi.mocked(s.source.fetchCoursePage!).mockResolvedValue({ ok: true, value: COURSE_PAGE.replace('value="True"', 'value="False"') });
    await expect(s.reader(OWNER, SCOPE)).rejects.toMatchObject({ code: 'TRONCLASS_COURSE_ACCESS_DENIED' });
    expect(s.source.fetchStudentSubmissionList).not.toHaveBeenCalled();
  });

  it('refuses to authorize without the authenticated fixed course-page hook', async () => {
    const s = setup();
    delete s.source.fetchCoursePage;
    await expect(s.reader(OWNER, SCOPE)).rejects.toMatchObject({ code: 'TRONCLASS_SUBMISSION_UNAVAILABLE' });
    expect(s.source.fetchCourses).not.toHaveBeenCalled();
    expect(s.source.fetchStudentSubmissionList).not.toHaveBeenCalled();
  });

  it.each([401, 403, 404])('does not treat course-page status %i as positive enrollment', async status => {
    const s = setup();
    vi.mocked(s.source.fetchCoursePage!).mockResolvedValue({ ok: false, status });
    await expect(s.reader(OWNER, SCOPE)).rejects.toMatchObject({ code: status === 401 ? 'TRONCLASS_RECONNECT_REQUIRED'
      : status === 403 ? 'TRONCLASS_COURSE_ACCESS_DENIED' : 'TRONCLASS_SUBMISSION_UNAVAILABLE' });
    expect(s.source.fetchStudentSubmissionList).not.toHaveBeenCalled();
  });

  it('checks positive enrollment again after the first history, stopping when student access is revoked', async () => {
    const s = setup();
    vi.mocked(s.source.fetchStudentSubmissionList!).mockImplementationOnce(async () => {
      vi.mocked(s.source.fetchCoursePage!).mockResolvedValue({ ok: true, value: COURSE_PAGE.replace('value="True"', 'value="False"') });
      return { ok: true, value: { list: [] } };
    });
    await expect(s.reader(OWNER, SCOPE)).rejects.toMatchObject({ code: 'TRONCLASS_COURSE_ACCESS_DENIED' });
    expect(s.source.fetchCoursePage).toHaveBeenCalledTimes(2);
    expect(s.source.fetchStudentSubmissionList).toHaveBeenCalledTimes(1);
  });

  it('requires complete homework enumeration even when the target appeared on the first page', async () => {
    const s = setup();
    vi.mocked(s.source.fetchHomeworkPage).mockResolvedValue({ ok: true, value: { homework_activities: [ACTIVITY], total: 2 } });
    await expect(s.reader(OWNER, SCOPE)).rejects.toMatchObject({ code: 'TRONCLASS_SUBMISSION_UNAVAILABLE' });
    expect(s.source.fetchStudentSubmissionList).not.toHaveBeenCalled();
  });

  it('requires current course membership before inspecting the supplied homework ID', async () => {
    const s = setup();
    await expect(s.reader(OWNER, { ...SCOPE, courseId: 999 })).rejects.toMatchObject({ code: 'TRONCLASS_COURSE_ACCESS_DENIED' });
    expect(s.source.fetchHomeworkActivity).not.toHaveBeenCalled();
    expect(s.source.fetchStudentSubmissionList).not.toHaveBeenCalled();
  });

  it.each([
    { list: [], total: 1 }, { list: [], has_next: true }, { list: [], next_page: 2 }, { list: [], pagination: {} },
    { list: [], page: 1 }, { list: [], next_cursor: 'more' }, { list: [], total: 0 }, { list: [], unknown_metadata: true },
    { data: { list: [] } }, { list: null }, [], null,
  ])('does not turn incomplete, wrapped or unfamiliar history into no prior submission: %j', async history => {
    const s = setup();
    s.setHistory(history);
    await expect(s.reader(OWNER, SCOPE)).rejects.toMatchObject({ code: 'TRONCLASS_SUBMISSION_UNAVAILABLE' });
  });

  it.each([{}, { is_draft: true }, { is_redo: true }, { submit_by_instructor: true }, { is_latest_version: false }])(
    'blocks every existing version despite retract/resubmit settings and a zero count: %j', async change => {
      const s = setup();
      s.setHistory({ list: [{ ...SUBMISSION, ...change }] });
      await expect(s.reader(OWNER, SCOPE)).rejects.toMatchObject({ code: 'TRONCLASS_SUBMISSION_BLOCKED' });
    },
  );

  it('does not discard foreign or corrupt history rows to manufacture an empty history', async () => {
    const s = setup();
    s.setHistory({ list: [{ ...SUBMISSION, created_by: { id: 999 } }] });
    await expect(s.reader(OWNER, SCOPE)).rejects.toMatchObject({ code: 'TRONCLASS_SUBMISSION_UNAVAILABLE' });
  });

  it('allows explicit null start only with the independently confirmed started ordinary window', async () => {
    const s = setup();
    s.changeActivity({ start_time: null });
    expect((await s.reader(OWNER, SCOPE)).assignment.opensAt).toBeNull();
    s.changeActivity({ is_started: false });
    await expect(s.reader(OWNER, SCOPE)).rejects.toMatchObject({ code: 'TRONCLASS_SUBMISSION_BLOCKED' });
    s.changeActivity({ is_started: true });
    s.removeActivity('start_time');
    await expect(s.reader(OWNER, SCOPE)).rejects.toMatchObject({ code: 'TRONCLASS_SUBMISSION_BLOCKED' });
  });

  it.each([
    { start_time: '2027-02-17T03:00:00Z' }, { end_time: '2027-02-16T02:59:59Z' }, { end_time: '2027-02-16T03:00:00Z' },
    { end_time: null }, { end_time: undefined }, { end_time: '2027-02-20 12:00:00' },
    { end_time: '2027-02-20T20:00:00+08:00' }, { end_time: '2027-02-30T12:00:00Z' },
    { start_time: '2027-02-14T24:00:00Z' }, { start_time: '2027-02-14T00:00:00' },
    { start_time: '2027-02-20T12:00:00Z', end_time: '2027-02-20T12:00:00Z' },
  ])('requires an already started and not yet elapsed valid UTC interval: %j', async change => {
    const s = setup();
    s.changeActivity(change);
    await expect(s.reader(OWNER, SCOPE)).rejects.toMatchObject({ code: 'TRONCLASS_SUBMISSION_BLOCKED' });
  });

  it('accepts the beginning of an explicit window and canonicalizes fractional UTC seconds', async () => {
    const s = setup();
    s.changeActivity({ start_time: new Date(NOW).toISOString(), end_time: '2027-02-20T12:00:00.1Z' });
    expect((await s.reader(OWNER, SCOPE)).assignment.deadline).toBe('2027-02-20T12:00:00.100Z');
  });

  it.each([{ revision: 'b'.repeat(32) }, { userId: 404 }, { expiresAt: new Date(NOW).toISOString() }])(
    'rechecks the bound identity and expiration after the first school snapshot: %j', async change => {
      const s = setup();
      vi.mocked(s.source.fetchStudentSubmissionList!).mockImplementation(async () => {
        s.changeBinding(change);
        return { ok: true, value: { list: [] } };
      });
      await expect(s.reader(OWNER, SCOPE)).rejects.toBeInstanceOf(NuniError);
      expect(s.source.fetchStudentSubmissionList).toHaveBeenCalledTimes(1);
    },
  );

  it('rejects a mismatched requested revision before any school read', async () => {
    const s = setup();
    await expect(s.reader(OWNER, SCOPE, undefined, 'b'.repeat(32)))
      .rejects.toMatchObject({ code: 'TRONCLASS_BINDING_CHANGED' });
    expect(s.source.fetchCourses).not.toHaveBeenCalled();
  });

  it('keeps the supplied session across both authorization checks', async () => {
    const s = setup();
    const binding = await s.bindings.requireBinding(OWNER);
    s.bindings.requireBinding.mockClear().mockResolvedValue({ ...binding, revision: 'b'.repeat(32), cookies: {} });
    await expect(s.reader(OWNER, SCOPE, undefined, binding)).resolves.toMatchObject({ binding });
    expect(s.bindings.requireBinding).not.toHaveBeenCalled();
    for (const [cookies] of vi.mocked(s.source.fetchCourses).mock.calls) expect(cookies).toEqual(binding.cookies);
  });

  it('rechecks the binding again after the final history snapshot', async () => {
    const s = setup();
    vi.mocked(s.source.fetchStudentSubmissionList!).mockResolvedValueOnce({ ok: true, value: { list: [] } }).mockImplementationOnce(async () => {
      s.changeBinding({ revision: 'b'.repeat(32) });
      return { ok: true, value: { list: [] } };
    });
    await expect(s.reader(OWNER, SCOPE)).rejects.toMatchObject({ code: 'TRONCLASS_BINDING_CHANGED' });
  });

  it('rechecks activity settings instead of returning a stale open snapshot', async () => {
    const s = setup();
    vi.mocked(s.source.fetchStudentSubmissionList!).mockImplementationOnce(async () => {
      s.changeActivity({ is_closed: true });
      return { ok: true, value: { list: [] } };
    });
    await expect(s.reader(OWNER, SCOPE)).rejects.toMatchObject({ code: 'TRONCLASS_SUBMISSION_BLOCKED' });
    expect(s.source.fetchStudentSubmissionList).toHaveBeenCalledTimes(1);
  });

  it.each([{ courses: [] }, { courses: [{ id: 101, role: 'teacher' }] }])('rechecks current course membership and role before returning: %j', async ({ courses }) => {
    const s = setup();
    vi.mocked(s.source.fetchStudentSubmissionList!).mockImplementationOnce(async () => {
      vi.mocked(s.source.fetchCourses).mockResolvedValue(courses);
      return { ok: true, value: { list: [] } };
    });
    await expect(s.reader(OWNER, SCOPE)).rejects.toMatchObject({ code: 'TRONCLASS_COURSE_ACCESS_DENIED' });
  });

  it('blocks a prior version that appears during the authorization read', async () => {
    const s = setup();
    vi.mocked(s.source.fetchStudentSubmissionList!).mockResolvedValueOnce({ ok: true, value: { list: [] } })
      .mockResolvedValueOnce({ ok: true, value: { list: [SUBMISSION] } });
    await expect(s.reader(OWNER, SCOPE)).rejects.toMatchObject({ code: 'TRONCLASS_SUBMISSION_BLOCKED' });
  });

  it('checks the source deadline again after the final binding lookup', async () => {
    const s = setup();
    s.changeActivity({ end_time: '2027-02-16T03:01:00Z' });
    s.bindings.assertCurrent.mockImplementation(async () => {
      if (s.bindings.assertCurrent.mock.calls.length === 3) s.setNow(NOW + 60_000);
    });
    await expect(s.reader(OWNER, SCOPE)).rejects.toMatchObject({ code: 'TRONCLASS_SUBMISSION_BLOCKED' });
  });

  it.each([{ revision: 'not-a-revision' }, { userId: 0 }, { expiresAt: 'invalid' }, { expiresAt: new Date(NOW).toISOString() }])(
    'refuses an invalid or expired binding before school I/O: %j', async change => {
      const s = setup();
      s.changeBinding(change);
      await expect(s.reader(OWNER, SCOPE)).rejects.toMatchObject({ code: 'TRONCLASS_RECONNECT_REQUIRED' });
      expect(s.source.fetchCourses).not.toHaveBeenCalled();
    },
  );

  it.each([401, 403, 404, 410, 500])('keeps school status %i from becoming empty history', async status => {
    const s = setup();
    vi.mocked(s.source.fetchStudentSubmissionList!).mockResolvedValue({ ok: false, status });
    await expect(s.reader(OWNER, SCOPE)).rejects.toMatchObject({
      code: status === 401 ? 'TRONCLASS_RECONNECT_REQUIRED' : status === 403 ? 'TRONCLASS_COURSE_ACCESS_DENIED' : 'TRONCLASS_SUBMISSION_UNAVAILABLE',
    });
  });

  it('sanitizes source errors instead of forwarding private cookies or response text', async () => {
    const s = setup();
    vi.mocked(s.source.fetchStudentSubmissionList!).mockRejectedValue(new Error('private-fixture cookie and response body'));
    await expect(s.reader(OWNER, SCOPE)).rejects.toThrow('TRONCLASS_SUBMISSION_UNAVAILABLE');
  });

  it('snapshots scope before an awaiting binding lookup', async () => {
    const s = setup();
    const scope = { ...SCOPE };
    const pending = s.reader(OWNER, scope);
    scope.courseId = 999;
    scope.homeworkId = 999;
    expect((await pending).assignment).toMatchObject(SCOPE);
  });

  it.each([{ courseId: 0, homeworkId: 202 }, { courseId: 101, homeworkId: '202' }, null])(
    'rejects invalid scope before binding or source I/O: %j', async scope => {
      const s = setup();
      await expect(s.reader(OWNER, scope as unknown as TronClassHomeworkScope)).rejects.toMatchObject({ code: 'TRONCLASS_INVALID_INPUT' });
      expect(s.bindings.requireBinding).not.toHaveBeenCalled();
    },
  );
});

describe('PU authorization cancellation and total read deadline', () => {
  it('does no binding or school I/O for an already cancelled request', async () => {
    const s = setup();
    const controller = new AbortController();
    controller.abort();
    await expect(s.reader(OWNER, SCOPE, controller.signal)).rejects.toMatchObject({ code: 'TRONCLASS_READ_TIMEOUT' });
    expect(s.bindings.requireBinding).not.toHaveBeenCalled();
    expect(s.source.fetchCourses).not.toHaveBeenCalled();
  });

  it('includes a hung binding lookup in the total deadline', async () => {
    vi.useFakeTimers();
    const s = setup();
    s.bindings.requireBinding.mockImplementation(() => new Promise(() => {}));
    const reader = createTronClassPuAuthorizationReader({ bindings: s.bindings, source: s.source, now: s.now, timeoutMs: 100 });
    const pending = expect(reader(OWNER, SCOPE)).rejects.toMatchObject({ code: 'TRONCLASS_READ_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(101);
    await pending;
    expect(s.source.fetchCourses).not.toHaveBeenCalled();
  });

  it('does not start downstream reads when a course provider resolves after the total deadline', async () => {
    vi.useFakeTimers();
    const s = setup();
    let finish!: (value: unknown) => void;
    vi.mocked(s.source.fetchCourses).mockImplementation((_cookies, options) => options.status === 'ongoing'
      ? new Promise(resolve => { finish = resolve; }) : Promise.resolve([]));
    const reader = createTronClassPuAuthorizationReader({ bindings: s.bindings, source: s.source, now: s.now, timeoutMs: 100 });
    const pending = expect(reader(OWNER, SCOPE)).rejects.toMatchObject({ code: 'TRONCLASS_READ_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(101);
    await pending;
    finish([{ id: 101, role: 'student' }]);
    await vi.runAllTimersAsync();
    expect(s.source.fetchHomeworkPage).not.toHaveBeenCalled();
    expect(s.source.fetchHomeworkActivity).not.toHaveBeenCalled();
    expect(s.source.fetchStudentSubmissionList).not.toHaveBeenCalled();
  });

  it('forwards one cancellation signal and the remaining total budget to every source read', async () => {
    vi.useFakeTimers();
    const s = setup();
    vi.mocked(s.source.fetchCourses).mockImplementation(async (_cookies, options) => {
      await new Promise(resolve => setTimeout(resolve, 30));
      return options.status === 'ongoing' ? [{ id: 101, role: 'student' }] : [];
    });
    const reader = createTronClassPuAuthorizationReader({ bindings: s.bindings, source: s.source, now: s.now, timeoutMs: 100 });
    const pending = reader(OWNER, SCOPE);
    await vi.advanceTimersByTimeAsync(80);
    await pending;
    const courseOptions = vi.mocked(s.source.fetchCourses).mock.calls.map(call => call[2]!);
    const pageOptions = vi.mocked(s.source.fetchHomeworkPage).mock.calls.map(call => call[4]!);
    const activityOptions = vi.mocked(s.source.fetchHomeworkActivity!).mock.calls.map(call => call[2]!);
    const enrollmentOptions = vi.mocked(s.source.fetchCoursePage!).mock.calls.map(call => call[2]!);
    const historyOptions = vi.mocked(s.source.fetchStudentSubmissionList!).mock.calls.map(call => call[3]!);
    const all: LmsReadOptions[] = [...courseOptions, ...pageOptions, ...activityOptions, ...enrollmentOptions, ...historyOptions];
    expect(all.every(options => options.signal === courseOptions[0].signal && !options.signal!.aborted)).toBe(true);
    expect(courseOptions.map(options => options.timeoutMs)).toEqual([100, 100, 70, 70]);
    expect(pageOptions.map(options => options.timeoutMs)).toEqual([70, 40]);
    expect(enrollmentOptions.map(options => options.timeoutMs)).toEqual([70, 40]);
    expect(historyOptions.map(options => options.timeoutMs)).toEqual([70, 40]);
  });

  it.each(['deadline', 'caller'] as const)('aborts the course-page transport on %s and refuses its late result', async cause => {
    vi.useFakeTimers();
    const s = setup();
    let finish!: (value: LmsReadResult<string>) => void;
    vi.mocked(s.source.fetchCoursePage!).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const controller = new AbortController();
    const reader = createTronClassPuAuthorizationReader({ bindings: s.bindings, source: s.source, now: s.now, timeoutMs: 100 });
    const pending = expect(reader(OWNER, SCOPE, controller.signal)).rejects.toMatchObject({ code: 'TRONCLASS_READ_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(0);
    const options = vi.mocked(s.source.fetchCoursePage!).mock.calls[0][2]!;
    if (cause === 'deadline') await vi.advanceTimersByTimeAsync(101);
    else controller.abort();
    await pending;
    expect(options.signal!.aborted).toBe(true);
    finish({ ok: true, value: COURSE_PAGE });
    await vi.runAllTimersAsync();
    expect(s.source.fetchHomeworkActivity).toHaveBeenCalledTimes(1);
    expect(s.source.fetchStudentSubmissionList).not.toHaveBeenCalled();
  });

  it('cancels a running source read and does not continue if that source returns late', async () => {
    vi.useFakeTimers();
    const s = setup();
    let finish!: (value: LmsReadResult<unknown>) => void;
    vi.mocked(s.source.fetchStudentSubmissionList!).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const controller = new AbortController();
    const pending = expect(s.reader(OWNER, SCOPE, controller.signal)).rejects.toMatchObject({ code: 'TRONCLASS_READ_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(0);
    const options = vi.mocked(s.source.fetchStudentSubmissionList!).mock.calls[0][3]!;
    controller.abort();
    await pending;
    expect(options.signal!.aborted).toBe(true);
    finish({ ok: true, value: { list: [] } });
    await vi.runAllTimersAsync();
    expect(s.bindings.requireBinding).toHaveBeenCalledTimes(1);
    expect(s.source.fetchStudentSubmissionList).toHaveBeenCalledTimes(1);
  });

  it.each([0, -1, 1.5, 30_001, Number.NaN])('rejects an invalid total timeout %s', timeoutMs => {
    const s = setup();
    expect(() => createTronClassPuAuthorizationReader({ bindings: s.bindings, source: s.source, timeoutMs }))
      .toThrow('TRONCLASS_INVALID_INPUT');
  });
});

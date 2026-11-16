// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { isTronClassAssignmentDetails } from '../tronClassAssignmentDetails';
import { normalizeTronClassAssignmentDetails, readTronClassAssignmentDetails } from './tronClassAssignmentDetails';
import type { LmsReadonlySource } from './tronClassLmsSource';
import type { TronClassSubmissionBinding } from './tronClassSubmissionSource';

const scope = { courseId: 101, homeworkId: 202 };
const now = Date.parse('2026-11-16T08:00:00.000Z');
const activity = { id: 202, course_id: 101, type: 'homework', title: '報告', published: true,
  start_time: '2026-11-01 09:00:00', end_time: '2026-11-20 23:59:00',
  submit_by_group: false, is_in_progress: true, is_closed: false, is_resubmit_open: false,
  non_submit_times: false, submit_times: 3, user_submit_count: 1,
  data: { mode: 'normal', description: '<p>報告要求</p>', allow_retract: false } };
const binding: TronClassSubmissionBinding = {
  schoolId: 'pu', revision: 'a'.repeat(32), account: 'student-fixture', userId: 303,
  userName: '測試同學', cookies: { SESSION: 'private-fixture' }, expiresAt: '2026-11-17T08:00:00.000Z',
};

function normalized(change: Record<string, unknown> = {}) {
  return normalizeTronClassAssignmentDetails({ ...activity, ...change }, scope, now).details;
}

describe('source-backed read-only homework details', () => {
  it('projects only displayed source fields, with Taipei dates and independently known counts', () => {
    const result = normalizeTronClassAssignmentDetails({ ...activity,
      data: { ...activity.data, reference_answer: 'private reference', score: 99 },
      cookies: binding.cookies, created_by: { id: 999, email: 'private@example.test' },
    }, scope, now);
    expect(result).toEqual({ title: '報告', description: '報告要求', details: {
      status: 'available', fetchedAt: '2026-11-16T08:00:00.000Z', submissionType: 'individual', mode: 'normal',
      opensAt: '2026-11-01T01:00:00.000Z', deadline: '2026-11-20T15:59:00.000Z',
      isInProgress: true, isClosed: false, resubmissionOpen: false, retractAllowed: false,
      attempts: { unlimited: false, limit: 3, used: 1, remaining: 2 },
    } });
    expect(isTronClassAssignmentDetails(result.details)).toBe(true);
    expect(JSON.stringify(result)).not.toContain('private');
  });

  it('does not infer default normal mode, individual submission, open windows or unlimited attempts from absence', () => {
    const result = normalizeTronClassAssignmentDetails({ id: 202, course_id: 101, type: 'homework' }, scope, now);
    expect(result).toEqual({ title: null, description: null, details: {
      status: 'available', fetchedAt: '2026-11-16T08:00:00.000Z', submissionType: 'unknown', mode: 'unknown',
      opensAt: null, deadline: null, isInProgress: null, isClosed: null, resubmissionOpen: null, retractAllowed: null,
      attempts: { unlimited: null, limit: null, used: null, remaining: null },
    } });
  });

  it.each([
    [{ non_submit_times: false, submit_times: 0, user_submit_count: 0 }, { unlimited: false, limit: 0, used: 0, remaining: 0 }],
    [{ non_submit_times: false, submit_times: 2, user_submit_count: 4 }, { unlimited: false, limit: 2, used: 4, remaining: 0 }],
    [{ non_submit_times: true, submit_times: 3, user_submit_count: 4 }, { unlimited: true, limit: null, used: 4, remaining: null }],
    [{ non_submit_times: undefined, submit_times: 3, user_submit_count: 1 }, { unlimited: null, limit: 3, used: 1, remaining: null }],
    [{ non_submit_times: false, submit_times: null, user_submit_count: 1 }, { unlimited: false, limit: null, used: 1, remaining: null }],
    [{ non_submit_times: false, submit_times: 3, user_submit_count: undefined }, { unlimited: false, limit: 3, used: null, remaining: null }],
  ])('keeps explicit zero values and does not fill missing attempt evidence: %j', (change, expected) => {
    const result = normalized(change);
    expect(result).toMatchObject({ attempts: expected });
    expect(isTronClassAssignmentDetails(result)).toBe(true);
  });

  it.each([['3', '1', 2], ['0', '0', 0], ['2', '4', 0]])(
    'accepts exact decimal source counts without relaxing write permission: %s / %s', (limit, used, remaining) => {
      expect(normalized({ submit_times: limit, user_submit_count: used })).toMatchObject({
        attempts: { unlimited: false, limit: Number(limit), used: Number(used), remaining },
      });
    },
  );

  it.each(['2x', '1e2', '+2', ' 2', '2.0', '02', '9007199254740992', -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1, true, {}, []])(
    'does not treat malformed source counts as a remaining attempt grant: %j', (value) => {
      const result = normalized({ submit_times: value, user_submit_count: value });
      expect(result).toMatchObject({ attempts: { unlimited: false, limit: null, used: null, remaining: null } });
      expect(isTronClassAssignmentDetails(result)).toBe(true);
    },
  );

  it.each(['true', 1, 0, null, {}, []])('does not coerce unverified source boolean encoding: %j', value => {
    expect(normalized({ non_submit_times: value, submit_by_group: value, is_in_progress: value,
      is_closed: value, is_resubmit_open: value, data: { allow_retract: value } })).toMatchObject({
      submissionType: 'unknown', isInProgress: null, isClosed: null, resubmissionOpen: null, retractAllowed: null,
      attempts: { unlimited: null, remaining: null },
    });
  });

  it('shows group and multiple-choice modes without exposing group members, answer options or grading data', () => {
    const result = normalized({ submit_by_group: true, group: { id: 987, students: ['private student'] },
      data: { mode: 'multiple', multiple_choice: [{ title: 'private choice' }], allow_retract: true } });
    expect(result).toMatchObject({ submissionType: 'group', mode: 'multiple', retractAllowed: true });
    expect(JSON.stringify(result)).not.toContain('private');
    expect(isTronClassAssignmentDetails(result)).toBe(true);
  });

  it('keeps closed and in-progress observations separate rather than turning them into permission', () => {
    const result = normalized({ is_in_progress: true, is_closed: true, is_resubmit_open: true });
    expect(result).toMatchObject({ isInProgress: true, isClosed: true, resubmissionOpen: true });
    expect(result).not.toHaveProperty('canSubmit');
    expect(result).not.toHaveProperty('permissionKnown');
  });

  it.each(['invalid', '2026-99-99', 123, {}, null])('does not invent timestamps from invalid date values: %j', value => {
    expect(normalized({ start_time: value, end_time: value })).toMatchObject({ opensAt: null, deadline: null });
  });

  it.each([{ id: 999 }, { course_id: 999 }, { type: 'exam' }, { id: '202' }])(
    'rejects mismatched activity identity instead of presenting another activity: %j', change => {
      expect(() => normalized(change)).toThrow(expect.objectContaining({ code: 'TRONCLASS_ASSIGNMENT_DETAILS_INVALID' }));
    },
  );

  it.each([{ published: false }, { hidden: true }, { is_hidden: 1 }, { published: true, hidden: true }])(
    'does not expose current hidden activity settings: %j', change => {
      expect(() => normalized(change)).toThrow(expect.objectContaining({ code: 'TRONCLASS_HOMEWORK_NOT_FOUND' }));
    },
  );
});

describe('assignment detail GET failure and identity boundaries', () => {
  function source(result: { ok: true; value: unknown } | { ok: false; status: number }) {
    return { fetchHomeworkActivity: vi.fn(async () => result) } as unknown as LmsReadonlySource;
  }

  it('uses only the verified binding cookie and activity id with the existing fixed GET source', async () => {
    const reads = source({ ok: true, value: activity });
    expect(await readTronClassAssignmentDetails(reads, binding, scope)).toMatchObject({ details: { status: 'available' } });
    expect(reads.fetchHomeworkActivity).toHaveBeenCalledExactlyOnceWith(binding.cookies, 202);
  });

  it.each([401, 403, 404, 410])('preserves definitive source denial %s instead of treating it as a transient failure', async status => {
    await expect(readTronClassAssignmentDetails(source({ ok: false, status }), binding, scope))
      .rejects.toMatchObject({ status: status === 410 ? 404 : status });
  });

  it.each([429, 500, 502, 503])('allows independently visible summaries to remain available for transient source %s', async status => {
    expect(await readTronClassAssignmentDetails(source({ ok: false, status }), binding, scope))
      .toEqual({ details: { status: 'unavailable' }, title: null, description: null });
  });

  it('maps thrown authentication expiry without returning its private upstream message', async () => {
    const reads = source({ ok: true, value: activity });
    vi.mocked(reads.fetchHomeworkActivity!).mockRejectedValueOnce(new Error('TronClass session 已失效，請重新登入'));
    await expect(readTronClassAssignmentDetails(reads, binding, scope)).rejects.toMatchObject({ code: 'TRONCLASS_RECONNECT_REQUIRED' });
  });

  it('does not request a malformed scope or identity', async () => {
    const reads = source({ ok: true, value: activity });
    await expect(readTronClassAssignmentDetails(reads, { ...binding, userId: 0 }, scope)).rejects.toMatchObject({ code: 'TRONCLASS_ASSIGNMENT_DETAILS_INVALID' });
    expect(reads.fetchHomeworkActivity).not.toHaveBeenCalled();
  });
});

describe('shared details response validation', () => {
  it('accepts the explicit unavailable state without inventing missing details', () => {
    expect(isTronClassAssignmentDetails({ status: 'unavailable' })).toBe(true);
    expect(isTronClassAssignmentDetails({ status: 'unavailable', isInProgress: true })).toBe(false);
  });

  it.each([
    { fetchedAt: 'yesterday' }, { opensAt: '2026-11-16' }, { deadline: 123 }, { isClosed: 'false' },
    { submissionType: 'all' }, { mode: 'exam' }, { raw: 'private data' }, { isInProgress: undefined },
    { attempts: { unlimited: false, limit: 3, used: 1, remaining: 3 } },
    { attempts: { unlimited: true, limit: 3, used: 1, remaining: null } },
    { attempts: { unlimited: null, limit: 3, used: 1, remaining: 2 } },
    { attempts: { unlimited: false, limit: 3, used: 1, remaining: 2, raw: 'private data' } },
  ])('rejects invalid or contradictory provider output: %j', change => {
    expect(isTronClassAssignmentDetails({ ...normalized(), ...change })).toBe(false);
  });
});

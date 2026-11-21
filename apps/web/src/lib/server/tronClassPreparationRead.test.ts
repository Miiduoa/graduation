// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTronClassPublicSubmissionService, type TronClassPublicSubmissionDependencies } from './tronClassPublicSubmissionService';
import { createTronClassSubmissionService, type TronClassSubmissionFirestore } from './tronClassSubmission';
import { createTronClassSubmissionSource, type TronClassSubmissionBinding } from './tronClassSubmissionSource';
import type { LmsReadonlySource, LmsReadOptions } from './tronClassLmsSource';
import type { TronClassCandidateAuthorization } from './tronClassSubmissionCandidate';
import { TRONCLASS_PREPARATION_TIMEOUT_MS, withTronClassPreparationRead } from './tronClassPreparationRead';

const NOW = Date.parse('2026-11-18T01:00:00.000Z');
const OWNER = 'firebase:preparation-cancellation-fixture';
const scope = { courseId: 101, homeworkId: 202 };
const activity = { id: 202, course_id: 101, type: 'homework', title: '測試作業', published: true,
  submit_by_group: false, data: { mode: 'normal', description: '<p>測試說明</p>' } };
const page = { ok: true as const, value: { homework_activities: [activity], total: 1 } };
const detail = { ok: true as const, value: activity };
const history = { ok: true as const, value: { list: [] } };
const availability = {
  source: 'tronclass' as const, ...scope, revision: 'a'.repeat(32), fetchedAt: new Date(NOW).toISOString(),
  state: 'unavailable' as const,
  ordinary: { state: 'unknown' as const, kind: 'unknown' as const, remainingAttempts: null },
  makeUp: { state: 'unknown' as const, updatedAt: null }, resubmit: { state: 'unknown' as const, updatedAt: null },
  draft: { state: 'unknown' as const, submissionId: null, count: null },
};

function fixture(contractVerified = false,
  readAvailability?: Parameters<typeof createTronClassSubmissionService>[0]['readAvailability']) {
  const identity: TronClassSubmissionBinding = { schoolId: 'pu', userId: 303, account: 'fixture-student', userName: null,
    revision: 'a'.repeat(32), cookies: { session: 'private-fixture', 'XSRF-TOKEN': 'private-xsrf' },
    expiresAt: new Date(NOW + 3600_000).toISOString() };
  const reads = {
    fetchCourses: vi.fn<LmsReadonlySource['fetchCourses']>(async (_cookies, options) => options.status === 'ongoing' ? [{ id: 101 }] : []),
    fetchHomeworkPage: vi.fn<LmsReadonlySource['fetchHomeworkPage']>(async () => page),
    fetchHomeworkActivity: vi.fn<NonNullable<LmsReadonlySource['fetchHomeworkActivity']>>(async () => detail),
    fetchStudentSubmissionList: vi.fn<NonNullable<LmsReadonlySource['fetchStudentSubmissionList']>>(async () => history),
    fetchActivities: vi.fn<LmsReadonlySource['fetchActivities']>(),
    fetchCourseAnnouncements: vi.fn<LmsReadonlySource['fetchCourseAnnouncements']>(),
    fetchSiteAnnouncements: vi.fn<LmsReadonlySource['fetchSiteAnnouncements']>(),
  } satisfies LmsReadonlySource;
  const bindings = { requireBinding: vi.fn(async () => structuredClone(identity)), assertCurrent: vi.fn(async () => {}) };
  const db: TronClassSubmissionFirestore = {
    doc: vi.fn(() => { throw new Error('preparation must not access operation documents'); }),
    runTransaction: vi.fn(async () => { throw new Error('preparation must not claim an operation'); }),
  };
  const source = createTronClassSubmissionSource(reads);
  const legacy = createTronClassSubmissionService({ db, bindings, source, readAvailability, now: () => NOW, writeEnabled: () => false });
  const granted: TronClassCandidateAuthorization = { binding: structuredClone(identity), assignment: {
    ...scope, studentId: 303, title: '測試作業', description: '測試說明', deadline: null, opensAt: null,
    permissionKnown: true, individual: true, canSubmit: true, isClosed: false, allowLate: false,
    remainingAttempts: 1, allowsText: true, allowsAttachments: false,
    maxFiles: 0, maxFileBytes: 0, maxTotalBytes: 0, allowedContentTypes: [],
  }, mode: 'normal', historyComplete: true, priorSubmissionIds: [], userSubmitCount: 0,
  ordinaryWindowConfirmed: true, prerequisitesConfirmed: true };
  const authorization = vi.fn<NonNullable<TronClassPublicSubmissionDependencies['authorization']>>(async () => structuredClone(granted));
  const service = createTronClassPublicSubmissionService({ db, bindings, readonlyPrepare: legacy.prepare,
    legacyReconcile: legacy.reconcile, contractVerified, enabled: () => true, authorization, now: () => NOW });
  const counts = () => [reads.fetchCourses, reads.fetchHomeworkPage, reads.fetchHomeworkActivity,
    reads.fetchStudentSubmissionList, bindings.requireBinding, bindings.assertCurrent, authorization]
    .map(fn => fn.mock.calls.length);
  return { service, reads, bindings, db, identity, authorization, granted, counts };
}

afterEach(() => vi.useRealTimers());

describe('one cancellation boundary through the real preparation readers', () => {
  it('includes optional personal availability under the existing preparation signal', async () => {
    const readAvailability = vi.fn<NonNullable<Parameters<typeof createTronClassSubmissionService>[0]['readAvailability']>>(
      async () => structuredClone(availability),
    );
    const f = fixture(false, readAvailability);
    const result = await f.service.prepare(OWNER, scope);
    expect(result.availability).toEqual(availability);
    expect(readAvailability).toHaveBeenCalledExactlyOnceWith(OWNER, scope, f.identity.revision,
      f.reads.fetchCourses.mock.calls[0][2]?.signal);
    expect(f.authorization).not.toHaveBeenCalled();
    expect(f.db.doc).not.toHaveBeenCalled();
  });

  it.each(['cancelled', 'expired'] as const)(
    'never downgrades a %s availability read into a successful fallback', async mode => {
      if (mode === 'expired') { vi.useFakeTimers(); vi.setSystemTime(NOW); }
      let release!: () => void;
      let receivedSignal: AbortSignal | undefined;
      const readAvailability = vi.fn<NonNullable<Parameters<typeof createTronClassSubmissionService>[0]['readAvailability']>>(
        (...args) => new Promise(resolve => {
          receivedSignal = args[3];
          release = () => resolve(structuredClone(availability));
        }),
      );
      const f = fixture(true, readAvailability);
      const controller = new AbortController();
      const pending = f.service.prepare(OWNER, scope, controller.signal).catch(error => error);
      if (mode === 'expired') await vi.advanceTimersByTimeAsync(0);
      else await vi.waitFor(() => expect(readAvailability).toHaveBeenCalledTimes(1));
      expect(readAvailability).toHaveBeenCalledTimes(1);
      if (mode === 'expired') await vi.advanceTimersByTimeAsync(TRONCLASS_PREPARATION_TIMEOUT_MS);
      else controller.abort();
      expect(await pending).toMatchObject({ status: 504, code: 'TRONCLASS_READ_TIMEOUT' });
      expect(receivedSignal?.aborted).toBe(true);
      const afterCancellation = f.counts();
      release();
      if (mode === 'expired') await vi.advanceTimersByTimeAsync(0);
      else await new Promise(resolve => setImmediate(resolve));
      expect(f.counts()).toEqual(afterCancellation);
      expect(f.authorization).not.toHaveBeenCalled();
      expect(f.db.runTransaction).not.toHaveBeenCalled();
    },
  );

  it('reads detail and complete own history with one signal without creating an operation', async () => {
    const f = fixture();
    const result = await f.service.prepare(OWNER, scope);
    expect(result).toMatchObject({ title: activity.title, canSubmit: false,
      details: { status: 'available' }, history: { state: 'available', entries: [] } });
    const options = [
      ...f.reads.fetchCourses.mock.calls.map(call => call[2]),
      ...f.reads.fetchHomeworkPage.mock.calls.map(call => call[4]),
      ...f.reads.fetchHomeworkActivity.mock.calls.map(call => call[2]),
      ...f.reads.fetchStudentSubmissionList.mock.calls.map(call => call[3]),
    ];
    expect(options.length).toBeGreaterThan(4);
    expect(new Set(options.map(option => option?.signal)).size).toBe(1);
    for (const option of options) {
      expect(option?.signal).toBeInstanceOf(AbortSignal);
      expect(option?.timeoutMs).toBeGreaterThan(0);
      expect(option?.timeoutMs).toBeLessThanOrEqual(8_000);
    }
    expect(f.db.doc).not.toHaveBeenCalled();
    expect(f.db.runTransaction).not.toHaveBeenCalled();
    expect(f.authorization).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toMatch(/private-fixture|private-xsrf|cookies/);
  });

  it('does not start binding or school reads for an already cancelled request', async () => {
    const f = fixture();
    const controller = new AbortController();
    controller.abort();
    await expect(f.service.prepare(OWNER, scope, controller.signal)).rejects.toMatchObject({ code: 'TRONCLASS_READ_TIMEOUT' });
    expect(f.counts()).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });

  it.each(['courses', 'page', 'details', 'history'] as const)(
    'cancels a %s provider that ignores AbortSignal and never starts its next stage', async phase => {
      const f = fixture(true);
      let release!: () => void;
      let started = false;
      if (phase === 'courses') f.reads.fetchCourses.mockImplementationOnce(() => new Promise(resolve => {
        started = true; release = () => resolve([{ id: 101 }]);
      }));
      if (phase === 'page') f.reads.fetchHomeworkPage.mockImplementationOnce(() => new Promise(resolve => {
        started = true; release = () => resolve(page);
      }));
      if (phase === 'details') f.reads.fetchHomeworkActivity.mockImplementationOnce(() => new Promise(resolve => {
        started = true; release = () => resolve(detail);
      }));
      if (phase === 'history') f.reads.fetchStudentSubmissionList.mockImplementationOnce(() => new Promise(resolve => {
        started = true; release = () => resolve(history);
      }));
      const controller = new AbortController();
      const pending = f.service.prepare(OWNER, scope, controller.signal).then(value => ({ value }), error => ({ error }));
      await vi.waitFor(() => expect(started).toBe(true));
      controller.abort();
      expect(await pending).toMatchObject({ error: { status: 504, code: 'TRONCLASS_READ_TIMEOUT' } });
      const afterCancellation = f.counts();
      release();
      await new Promise(resolve => setImmediate(resolve));
      expect(f.counts()).toEqual(afterCancellation);
      expect(f.authorization).not.toHaveBeenCalled();
      expect(f.db.runTransaction).not.toHaveBeenCalled();
    },
  );

  it('does not read another homework page after cancellation during an incomplete first page', async () => {
    const f = fixture();
    let release!: () => void;
    f.reads.fetchHomeworkPage.mockImplementationOnce(() => new Promise(resolve => {
      release = () => resolve({ ok: true, value: { total: 51,
        homework_activities: Array.from({ length: 50 }, (_, index) => ({ ...activity, id: index + 1000 })) } });
    }));
    const controller = new AbortController();
    const pending = f.service.prepare(OWNER, scope, controller.signal).catch(error => error);
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    controller.abort();
    expect(await pending).toMatchObject({ code: 'TRONCLASS_READ_TIMEOUT' });
    release();
    await new Promise(resolve => setImmediate(resolve));
    expect(f.reads.fetchHomeworkPage).toHaveBeenCalledTimes(1);
    expect(f.reads.fetchHomeworkActivity).not.toHaveBeenCalled();
  });

  it('does not turn a cancelled history rejection into an available detail fallback', async () => {
    const f = fixture();
    const controller = new AbortController();
    f.reads.fetchStudentSubmissionList.mockImplementationOnce(async () => {
      controller.abort();
      throw new Error('late school failure with private response');
    });
    await expect(f.service.prepare(OWNER, scope, controller.signal)).rejects.toMatchObject({ code: 'TRONCLASS_READ_TIMEOUT' });
    expect(f.authorization).not.toHaveBeenCalled();
  });

  it('forwards the same cancellation to fresh authorization and refuses its late permission', async () => {
    const f = fixture(true);
    let release!: () => void;
    f.authorization.mockImplementationOnce(() => new Promise(resolve => { release = () => resolve(f.granted); }));
    const controller = new AbortController();
    const pending = f.service.prepare(OWNER, scope, controller.signal).catch(error => error);
    await vi.waitFor(() => expect(f.authorization).toHaveBeenCalledOnce());
    const authorizationSignal = f.authorization.mock.calls[0][2];
    expect(authorizationSignal).toBe(f.reads.fetchCourses.mock.calls[0][2]?.signal);
    controller.abort();
    expect(await pending).toMatchObject({ code: 'TRONCLASS_READ_TIMEOUT' });
    expect(authorizationSignal?.aborted).toBe(true);
    const afterCancellation = f.counts();
    release();
    await new Promise(resolve => setImmediate(resolve));
    expect(f.counts()).toEqual(afterCancellation);
    expect(f.db.runTransaction).not.toHaveBeenCalled();
  });

  it('bounds the entire request even when the first binding provider never settles', async () => {
    vi.useFakeTimers();
    const f = fixture();
    let release!: () => void;
    f.bindings.requireBinding.mockImplementationOnce(() => new Promise(resolve => { release = () => resolve(f.identity); }));
    const pending = f.service.prepare(OWNER, scope).catch(error => error);
    await vi.advanceTimersByTimeAsync(TRONCLASS_PREPARATION_TIMEOUT_MS);
    expect(await pending).toMatchObject({ status: 504, code: 'TRONCLASS_READ_TIMEOUT' });
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.reads.fetchCourses).not.toHaveBeenCalled();
    expect(f.authorization).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('passes only the remaining budget to a late next read instead of resetting its timeout', async () => {
    vi.useFakeTimers();
    let release!: () => void;
    let nextOptions: LmsReadOptions | undefined;
    const next = vi.fn(async (options: LmsReadOptions) => {
      nextOptions = options;
      return new Promise<never>(() => {});
    });
    const pending = withTronClassPreparationRead(undefined, async context => {
      await context.read(() => new Promise<void>(resolve => { release = resolve; }));
      return context.read(next);
    }).catch(error => error);
    await vi.advanceTimersByTimeAsync(TRONCLASS_PREPARATION_TIMEOUT_MS - 100);
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(nextOptions?.timeoutMs).toBe(100);
    await vi.advanceTimersByTimeAsync(100);
    expect(await pending).toMatchObject({ code: 'TRONCLASS_READ_TIMEOUT' });
    expect(nextOptions?.signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});

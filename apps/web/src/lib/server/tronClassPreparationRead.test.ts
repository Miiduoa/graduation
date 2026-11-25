// @vitest-environment node
import { NextRequest } from 'next/server';
import { NuniError } from '@campus/shared/src/nuni';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTronClassPublicSubmissionService, type TronClassPublicSubmissionDependencies } from './tronClassPublicSubmissionService';
import { createTronClassSubmissionService, type TronClassSubmissionFirestore } from './tronClassSubmission';
import { createTronClassSubmissionSource, type TronClassSubmissionBinding } from './tronClassSubmissionSource';
import type { LmsReadonlySource, LmsReadOptions } from './tronClassLmsSource';
import type { TronClassCandidateAuthorization } from './tronClassSubmissionCandidate';
import { TRONCLASS_PREPARATION_TIMEOUT_MS, withTronClassPreparationRead } from './tronClassPreparationRead';

import { createTronClassAgentClient } from '../tronClassAgentClient';
import { createTronClassClient } from '../tronClassIntegrationClient';
import { handleTronClassAgent } from './tronClassAgentRoute';
import { handleTronClassIntegration, type TronClassRouteDependencies } from './tronClassIntegrationRoute';
import { createTronClassIntegrationReader } from './tronClassIntegrationSource';
import { createTronClassAgentService } from './tronClassAgent';

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
  const bindings = { requireBinding: vi.fn(async () => structuredClone(identity)), assertCurrent: vi.fn(async (_owner: string, _revision: string) => {}) };
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

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it('rejects stale Agent and workspace selections before any school call, including native requests', async () => {
  vi.stubEnv('TRONCLASS_INTEGRATION_ENABLED', 'true');
  const f = fixture();
  let binding = f.identity;
  const grant = () => ({
    revision: binding.revision, version: binding.revision, updatedAt: null,
    permissions: { readCourseData: true, downloadMaterials: true, prepareHomework: true },
  });
  f.bindings.requireBinding.mockImplementation(async () => structuredClone(binding));
  f.bindings.assertCurrent.mockImplementation(async (_owner: string, revision: string) => {
    if (revision !== binding.revision) throw new NuniError(409, 'TRONCLASS_BINDING_CHANGED');
  });
  f.reads.fetchCourses.mockImplementation(async (_cookies, options) =>
    options.status === 'ongoing' ? [{ id: scope.courseId, name: '外交' }] : []);
  const read = createTronClassIntegrationReader({ bindings: f.bindings, source: f.reads });
  const auth = { authenticate: async () => ({ ownerKey: OWNER, provider: 'firebase' as const }), rateLimit: () => {} };
  const integration = { ...auth, bindings: f.bindings as unknown as TronClassRouteDependencies['bindings'],
    read, submissions: async () => f.service };
  const agent = {
    ...auth, bindings: f.bindings, read,
    grants: { get: async () => grant(), require: async () => grant(), assertCurrent: async () => {} },
    prepare: (owner: string, input: typeof scope, snapshot: TronClassSubmissionBinding) =>
      f.service.prepare(owner, input, undefined, snapshot),
  };
  const dispatch = (path: string, init: RequestInit) => {
    const request = new NextRequest(`https://nuni.tw${path}`, { ...init, signal: init.signal ?? undefined });
    return path.endsWith('/agent') ? handleTronClassAgent(request, agent) : handleTronClassIntegration(request, integration);
  };
  vi.stubGlobal('fetch', dispatch);
  const access = { kind: 'firebase' as const, getIdToken: async () => 'fixture' };
  const agentClient = createTronClassAgentClient(access);
  const workspace = createTronClassClient(access);

  const selected = await workspace.sync();
  expect(selected.homework).toEqual([expect.objectContaining({ id: scope.homeworkId, courseId: scope.courseId })]);
  const revision = selected.revision;
  const nativePrepare = () => dispatch('/api/tronclass', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer fixture' },
    body: JSON.stringify({ action: 'prepare', ...scope, revision }),
  });

  await expect(agentClient.prepare(scope.courseId, scope.homeworkId, revision)).resolves.toMatchObject({ revision });
  await expect(workspace.prepare(scope.courseId, scope.homeworkId, revision)).resolves.toMatchObject({ revision });
  expect((await nativePrepare()).status).toBe(200);
  for (const endpoint of Object.values(f.reads)) endpoint.mockClear();

  binding = { ...binding, revision: 'b'.repeat(32), userId: 404, cookies: { session: 'replacement-fixture' } };
  const attempts = [
    agentClient.ask({ question: '幫我準備 TronClass 作業', ...scope, revision }),
    agentClient.ask({ question: '查 TronClass 作業', courseId: scope.courseId, revision }),
    agentClient.prepare(scope.courseId, scope.homeworkId, revision),
    workspace.prepare(scope.courseId, scope.homeworkId, revision),
    workspace.sync(scope.courseId, undefined, revision),
  ];
  await Promise.all(attempts.map(attempt =>
    expect(attempt).rejects.toMatchObject({ code: 'TRONCLASS_BINDING_CHANGED' })));
  const native = await nativePrepare();
  expect(native.status).toBe(409);
  expect(await native.json()).toMatchObject({ error: 'TRONCLASS_BINDING_CHANGED' });
  for (const endpoint of Object.values(f.reads)) expect(endpoint).not.toHaveBeenCalled();
});

describe('one cancellation boundary through the real preparation readers', () => {
  it.each(['explicit', 'automatic', 'expired'] as const)('keeps preparation on the authorized session for %s selection', async mode => {
    const f = fixture(false);
    const replacement = { ...f.identity, revision: 'b'.repeat(32), cookies: { session: 'other-fixture' } };
    const grant = { revision: f.identity.revision, version: 'c'.repeat(32), updatedAt: null,
      permissions: { readCourseData: true, downloadMaterials: true, prepareHomework: true } };
    const course = { id: scope.courseId, name: '外交', code: 'PS101', teachers: [], semester: '', status: 'ongoing', href: '' };
    const homework = { id: scope.homeworkId, courseId: scope.courseId, courseName: course.name, title: '測試作業',
      deadline: null, deadlineLabel: '', submitted: false, description: '', href: '' };
    f.bindings.requireBinding.mockResolvedValueOnce(f.identity).mockResolvedValue(replacement);
    const agent = createTronClassAgentService({
      bindings: f.bindings,
      grants: { get: async () => grant, require: async () => grant, assertCurrent: async () => {} },
      read: async () => ({
        revision: grant.revision, fetchedAt: new Date(NOW).toISOString(), partial: false, errors: [],
        courses: [course], homework: [homework], announcements: [], materials: [],
      }),
      prepare: (owner, input, binding) => f.service.prepare(owner, input, undefined, binding),
    });
    if (mode === 'expired') {
      f.bindings.assertCurrent.mockRejectedValue(new NuniError(409, 'TRONCLASS_BINDING_CHANGED'));
      await expect(agent.prepare(OWNER, { ...scope, revision: grant.revision })).rejects.toMatchObject({ code: 'TRONCLASS_BINDING_CHANGED' });
      expect(f.reads.fetchCourses).not.toHaveBeenCalled();
      expect(f.reads.fetchHomeworkPage).not.toHaveBeenCalled();
    } else {
      const preparation = mode === 'explicit' ? await agent.prepare(OWNER, { ...scope, revision: grant.revision })
        : (await agent.ask(OWNER, { question: '準備玩課雲『外交』作業' })).preparation;
      expect(preparation).toMatchObject({ ...scope, revision: grant.revision, canSubmit: false });
      expect(f.reads.fetchCourses).toHaveBeenCalled();
      expect(f.reads.fetchHomeworkPage).toHaveBeenCalled();
      for (const [cookies] of [...f.reads.fetchCourses.mock.calls, ...f.reads.fetchHomeworkPage.mock.calls]) {
        expect(cookies).toEqual(f.identity.cookies);
      }
    }
    expect(f.bindings.requireBinding).toHaveBeenCalledTimes(1);
  });

  it('includes optional personal availability under the existing preparation signal', async () => {
    const readAvailability = vi.fn<NonNullable<Parameters<typeof createTronClassSubmissionService>[0]['readAvailability']>>(
      async () => structuredClone(availability),
    );
    const f = fixture(false, readAvailability);
    const result = await f.service.prepare(OWNER, scope);
    expect(result.availability).toEqual(availability);
    expect(readAvailability).toHaveBeenCalledExactlyOnceWith(OWNER, scope, f.identity.revision,
      f.reads.fetchCourses.mock.calls[0][2]?.signal, f.identity);
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

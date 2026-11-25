// @vitest-environment node
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { NuniError } from '@campus/shared/src/nuni';
import {
  createTronClassAcceptanceService,
  type TronClassAcceptanceInput,
} from './tronClassAcceptance';
import type { TronClassCandidateAuthorization } from './tronClassSubmissionCandidate';
import type { TronClassSubmissionFirestore, TronClassSubmissionRef } from './tronClassSubmission';
import type { TronClassSubmissionBinding } from './tronClassSubmissionSource';

vi.mock('server-only', () => ({}));
const NOW = Date.parse('2026-11-18T10:00:00.000Z');
const SECRET = 'synthetic-acceptance-binding-secret-32-characters';
const OWNER = 'firebase:synthetic-acceptance';
const REVISION = 'a'.repeat(32);
const OPERATION = 'synthetic_acceptance_operation_1';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const input = (): TronClassAcceptanceInput => ({
  version: 1,
  schoolId: 'pu',
  ownerKey: OWNER,
  studentId: 303,
  courseId: 101,
  homeworkId: 202,
  revision: REVISION,
  operationId: OPERATION,
  content: '受控合成 <內容> &\r\n第二行',
});

/** Atomic fake Firestore; the production controlled journal is used unchanged. */
function fixture() {
  let clock = NOW,
    writes = 0,
    failAckSave = false,
    lostAck = false,
    readFailure = false;
  let currentBinding: TronClassSubmissionBinding = {
    schoolId: 'pu',
    revision: REVISION,
    userId: 303,
    account: 'synthetic-account',
    userName: null,
    expiresAt: new Date(NOW + 3600_000).toISOString(),
    cookies: { session: 'synthetic-private-cookie', 'XSRF-TOKEN': 'synthetic-csrf' },
  };
  const rows = new Map<string, Record<string, unknown>>();
  const bindingPath = `_tronClassBindings/${hash(OWNER)}`;
  const saveBinding = () =>
    rows.set(bindingPath, {
      ownerKey: OWNER,
      schoolId: 'pu',
      state: 'connected',
      revision: currentBinding.revision,
      userId: currentBinding.userId,
      expiresAt: Date.parse(currentBinding.expiresAt),
    });
  saveBinding();
  const snapshot = (path: string) => ({
    exists: rows.has(path),
    data: () => structuredClone(rows.get(path)),
  });
  let queue = Promise.resolve();
  const db: TronClassSubmissionFirestore = {
    doc: (path) => ({ path, get: async () => snapshot(path) }),
    runTransaction(run) {
      const next = queue.then(async () => {
        const pending: Array<[string, Record<string, unknown>]> = [];
        const result = await run({
          get: async (ref: TronClassSubmissionRef) => {
            if (pending.length) throw new Error('Transaction reads must precede writes');
            return snapshot(ref.path);
          },
          set(ref, value) {
            pending.push([ref.path, structuredClone(value)]);
          },
        });
        if (failAckSave && pending.some(([, row]) => row.state === 'acknowledged'))
          throw new Error('private-ack-store-failure');
        for (const [path, value] of pending) rows.set(path, value);
        writes += pending.length;
        return result;
      });
      queue = next.then(
        () => undefined,
        () => undefined,
      );
      return next;
    },
  };
  const unsealSession = vi.fn(() => structuredClone(currentBinding));
  const bindings = {
    requireBinding: vi.fn(async (ownerKey: string, sourceRevision?: string) => {
      if (ownerKey !== OWNER) throw new NuniError(401, 'TRONCLASS_RECONNECT_REQUIRED');
      if (sourceRevision !== undefined && sourceRevision !== currentBinding.revision)
        throw new NuniError(409, 'TRONCLASS_BINDING_CHANGED');
      return unsealSession();
    }),
    assertCurrent: vi.fn(async (ownerKey: string, revision: string) => {
      if (ownerKey !== OWNER || revision !== currentBinding.revision)
        throw new NuniError(409, 'TRONCLASS_BINDING_CHANGED');
    }),
  };
  const authorize = vi.fn(
    async (): Promise<TronClassCandidateAuthorization> => ({
      binding: structuredClone(currentBinding),
      mode: 'normal',
      historyComplete: true,
      priorSubmissionIds: [],
      userSubmitCount: 0,
      ordinaryWindowConfirmed: true,
      prerequisitesConfirmed: true,
      assignment: {
        courseId: 101,
        homeworkId: 202,
        studentId: currentBinding.userId,
        title: '合成作業',
        description: '',
        opensAt: null,
        deadline: new Date(NOW + 7200_000).toISOString(),
        permissionKnown: true,
        individual: true,
        canSubmit: true,
        isClosed: false,
        allowLate: false,
        remainingAttempts: 1,
        allowsText: true,
        allowsAttachments: false,
        maxFiles: 0,
        maxFileBytes: 0,
        maxTotalBytes: 0,
        allowedContentTypes: [],
      },
    }),
  );
  let finalRow: Record<string, unknown> | null = null;
  const fetchSchool = vi.fn(async (url: string, init: RequestInit = {}) => {
    expect(url).toBe('https://tronclass.pu.edu.tw/api/course/activities/202/submissions');
    expect(init).toMatchObject({ method: 'POST', redirect: 'manual', cache: 'no-store' });
    expect([...rows.values()].some((row) => row.state === 'final-claimed')).toBe(true);
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      uploads: [],
      slides: [],
      other_resources: [],
      uploads_in_rich_text: [],
      mode: 'normal',
      is_draft: false,
    });
    finalRow = {
      id: 501,
      course_id: 101,
      activity_id: 202,
      created_by: { id: 303 },
      is_latest_version: true,
      is_draft: false,
      is_redo: false,
      submit_by_instructor: false,
      comment: body.comment,
      uploads: [],
      other_resources: [],
      slide_references: [],
      created_at: '2026-11-18T10:00:00Z',
    };
    if (lostAck) throw new Error('lost response with synthetic-private-cookie');
    return new Response(JSON.stringify({ submission: finalRow, student: { id: 303 } }), {
      headers: { 'Content-Type': 'application/json' },
    });
  });
  const readHistory = vi.fn(
    async (
      ownerKey: string,
      binding: TronClassSubmissionBinding,
      scope: { courseId: number; homeworkId: number },
    ) => {
      expect(ownerKey).toBe(OWNER);
      expect(binding.userId).toBe(303);
      expect(scope).toEqual({ courseId: 101, homeworkId: 202 });
      if (readFailure) throw new Error('synthetic-private-history-response');
      return { list: finalRow ? [structuredClone(finalRow)] : [] };
    },
  );
  const service = (reserveDispatch?: (plan: unknown) => Promise<boolean>) =>
    createTronClassAcceptanceService({
      db,
      bindings,
      authorize,
      readHistory,
      fetchSchool,
      planSecret: SECRET,
      now: () => clock,
      reserveDispatch,
    });
  return {
    db,
    rows,
    bindings,
    unsealSession,
    authorize,
    fetchSchool,
    readHistory,
    service,
    writes: () => writes,
    setClock: (value: number) => {
      clock = value;
    },
    loseAck: () => {
      lostAck = true;
    },
    failAckSave: () => {
      failAckSave = true;
    },
    setReadFailure: (value: boolean) => {
      readFailure = value;
    },
    rebind: (revision: string, studentId = 303) => {
      currentBinding = { ...currentBinding, revision, userId: studentId };
      saveBinding();
    },
  };
}
const confirmation = (plan: { operationId: string; contentSha256: string }) => ({
  operationId: plan.operationId,
  contentSha256: plan.contentSha256,
  confirmed: true,
});

describe('controlled first-text acceptance entry', () => {
  it('preflights without any claim, journal mutation, upload or final request and seals a short private plan', async () => {
    const f = fixture();
    const plan = await f.service().preflight(input());
    expect(plan).toMatchObject({
      version: 1,
      schoolId: 'pu',
      kind: 'controlled-first-text',
      contractVerified: false,
      ownerKey: OWNER,
      studentId: 303,
      courseId: 101,
      homeworkId: 202,
      revision: REVISION,
      operationId: OPERATION,
      contentSha256: hash(input().content),
      issuedAt: new Date(NOW).toISOString(),
      expiresAt: new Date(NOW + 300_000).toISOString(),
    });
    expect(plan.signature).toMatch(/^[a-f0-9]{64}$/);
    expect(f.authorize).toHaveBeenCalledExactlyOnceWith(OWNER, { courseId: 101, homeworkId: 202 },
      undefined, expect.objectContaining({ revision: REVISION, userId: 303 }));
    expect(f.bindings.requireBinding).toHaveBeenCalledExactlyOnceWith(OWNER, REVISION);
    expect(f.fetchSchool).not.toHaveBeenCalled();
    expect(f.readHistory).not.toHaveBeenCalled();
    expect(f.writes()).toBe(0);
    expect(f.rows.size).toBe(1);
    for (const secret of [SECRET, 'synthetic-private-cookie', 'synthetic-csrf', input().content])
      expect(JSON.stringify(plan)).not.toContain(secret);
  });

  it('dispatches once through the real journal and maps exact acknowledged readback without invented submittedAt', async () => {
    const f = fixture();
    const plan = await f.service().preflight(input());
    const result = await f.service().dispatch(input(), plan, confirmation(plan));
    expect(result).toMatchObject({
      status: 'confirmed',
      operationId: OPERATION,
      receipt: null,
      confirmation: {
        kind: 'acknowledged-readback',
        submissionId: 501,
        courseId: 101,
        homeworkId: 202,
        confirmedAt: new Date(NOW).toISOString(),
        sourceRecordedAt: new Date(NOW).toISOString(),
      },
    });
    expect(result).not.toHaveProperty('submittedAt');
    expect(f.fetchSchool).toHaveBeenCalledTimes(1);
    expect(f.authorize).toHaveBeenCalledTimes(3); // preflight + both candidate fresh checks
    expect(await f.service().dispatch(input(), plan, confirmation(plan))).toEqual({
      status: 'unknown',
      operationId: OPERATION,
      receipt: null,
    });
    expect(f.fetchSchool).toHaveBeenCalledTimes(1);
    expect(f.authorize).toHaveBeenCalledTimes(3);
  });

  it.each([
    { content: `${input().content} ` },
    { ownerKey: 'firebase:other' },
    { studentId: 404 },
    { courseId: 102 },
    { homeworkId: 203 },
    { revision: 'b'.repeat(32) },
    { operationId: 'another_operation_0001' },
  ])('refuses changed reviewed input %j before source authorization or POST', async (change) => {
    const f = fixture();
    const plan = await f.service().preflight(input());
    await expect(
      f.service().dispatch({ ...input(), ...change }, plan, confirmation(plan)),
    ).rejects.toMatchObject({ code: 'TRONCLASS_ACCEPTANCE_INPUT_CHANGED' });
    expect(f.authorize).toHaveBeenCalledTimes(1);
    expect(f.writes()).toBe(0);
    expect(f.fetchSchool).not.toHaveBeenCalled();
  });

  it.each([
    'ownerKey',
    'studentId',
    'courseId',
    'homeworkId',
    'revision',
    'operationId',
    'contentSha256',
    'expiresAt',
  ])('refuses a modified signed plan field %s', async (field) => {
    const f = fixture();
    const plan = await f.service().preflight(input());
    const changes: Record<string, unknown> = {
      ownerKey: 'firebase:other',
      studentId: 404,
      courseId: 102,
      homeworkId: 203,
      revision: 'b'.repeat(32),
      operationId: 'another_operation_0001',
      contentSha256: 'b'.repeat(64),
      expiresAt: new Date(NOW + 600_000).toISOString(),
    };
    await expect(
      f.service().dispatch(input(), { ...plan, [field]: changes[field] }, confirmation(plan)),
    ).rejects.toMatchObject({ code: 'TRONCLASS_ACCEPTANCE_PLAN_CHANGED' });
    expect(f.fetchSchool).not.toHaveBeenCalled();
    expect(f.writes()).toBe(0);
  });

  it.each([
    { confirmed: false },
    { operationId: 'another_operation_0001' },
    { contentSha256: '0'.repeat(64) },
  ])('requires the explicit reviewed operation and exact content digest %j', async (change) => {
    const f = fixture();
    const plan = await f.service().preflight(input());
    await expect(
      f.service().dispatch(input(), plan, { ...confirmation(plan), ...change }),
    ).rejects.toMatchObject({ code: 'TRONCLASS_ACCEPTANCE_CONFIRMATION_REQUIRED' });
    expect(f.fetchSchool).not.toHaveBeenCalled();
  });

  it('rejects an expired plan before reserving a local dispatch or reading fresh authorization', async () => {
    const f = fixture();
    const plan = await f.service().preflight(input());
    f.setClock(NOW + 300_000);
    const reserve = vi.fn(async () => true);
    await expect(
      f.service(reserve).dispatch(input(), plan, confirmation(plan)),
    ).rejects.toMatchObject({ code: 'TRONCLASS_ACCEPTANCE_PLAN_EXPIRED' });
    expect(reserve).not.toHaveBeenCalled();
    expect(f.authorize).toHaveBeenCalledTimes(1);
  });

  it.each([
    { revision: 'b'.repeat(32), student: 303, code: 'TRONCLASS_BINDING_CHANGED' },
    { revision: REVISION, student: 404, code: 'TRONCLASS_RECONNECT_REQUIRED' },
  ])('rejects a changed current binding %j before candidate entry', async (change) => {
    const f = fixture();
    const plan = await f.service().preflight(input());
    f.rebind(change.revision, change.student);
    await expect(f.service().dispatch(input(), plan, confirmation(plan))).rejects.toMatchObject({
      code: change.code,
    });
    expect(f.fetchSchool).not.toHaveBeenCalled();
    expect(f.writes()).toBe(0);
  });

  it.each(['lost acknowledgment', 'failed acknowledgment persistence'])(
    'keeps %s unknown and does not submit again across instances',
    async (failure) => {
      const f = fixture();
      const plan = await f.service().preflight(input());
      if (failure === 'lost acknowledgment') f.loseAck();
      else f.failAckSave();
      const expected = { status: 'unknown', operationId: OPERATION, receipt: null };
      expect(await f.service().dispatch(input(), plan, confirmation(plan))).toEqual(expected);
      const saved = structuredClone([...f.rows]);
      expect(await f.service().dispatch(input(), plan, confirmation(plan))).toEqual(expected);
      expect(await f.service().reconcile(plan)).toEqual(expected);
      expect(f.fetchSchool).toHaveBeenCalledTimes(1);
      expect(f.readHistory).not.toHaveBeenCalled();
      expect([...f.rows]).toEqual(saved);
      await expect(
        f.service().preflight({ ...input(), operationId: 'another_operation_0001' }),
      ).rejects.toMatchObject({ code: 'TRONCLASS_ACCEPTANCE_RECONCILE_ONLY' });
    },
  );

  it('shares the durable student/assignment claim across simultaneous plans and instances', async () => {
    const f = fixture();
    const second = { ...input(), operationId: 'another_operation_0001' };
    const firstPlan = await f.service().preflight(input());
    const secondPlan = await f.service().preflight(second);
    const results = await Promise.all([
      f.service().dispatch(input(), firstPlan, confirmation(firstPlan)),
      f.service().dispatch(second, secondPlan, confirmation(secondPlan)),
    ]);
    expect(f.fetchSchool).toHaveBeenCalledTimes(1);
    expect(results.filter((result) => result.status === 'confirmed')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'unknown')).toHaveLength(1);
  });

  it('does not associate a losing different-content plan with the winning operation during a concurrent dispatch', async () => {
    const f = fixture();
    const second = { ...input(), content: '不同的合成測試內容' };
    const firstPlan = await f.service().preflight(input());
    const secondPlan = await f.service().preflight(second);
    const results = await Promise.allSettled([
      f.service().dispatch(input(), firstPlan, confirmation(firstPlan)),
      f.service().dispatch(second, secondPlan, confirmation(secondPlan)),
    ]);
    expect(f.fetchSchool).toHaveBeenCalledTimes(1);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({
      reason: { code: 'TRONCLASS_OPERATION_CONFLICT' },
    });
  });

  it('reconciles an expired plan on its original binding without authorizing writes', async () => {
    const f = fixture();
    const plan = await f.service().preflight(input());
    f.setReadFailure(true);
    expect((await f.service().dispatch(input(), plan, confirmation(plan))).status).toBe('unknown');
    const saved = structuredClone(
      [...f.rows].filter(([path]) => !path.startsWith('_tronClassBindings/')),
    );
    f.setReadFailure(false);
    f.setClock(NOW + 600_000);
    f.authorize.mockRejectedValue(new Error('write permission unavailable'));
    const calls = f.authorize.mock.calls.length;
    expect((await f.service().reconcile(plan)).status).toBe('confirmed');
    expect(f.authorize).toHaveBeenCalledTimes(calls);
    expect(f.fetchSchool).toHaveBeenCalledTimes(1);
    expect([...f.rows].filter(([path]) => !path.startsWith('_tronClassBindings/'))).toEqual(saved);
  });

  it.each([303, 404])('rejects an acknowledged plan after rebinding to student %i before opening the session', async (studentId) => {
    const f = fixture();
    const plan = await f.service().preflight(input());
    f.setReadFailure(true);
    expect((await f.service().dispatch(input(), plan, confirmation(plan))).status).toBe('unknown');
    expect([...f.rows.values()].some((row) => row.state === 'acknowledged')).toBe(true);
    f.setReadFailure(false);
    f.rebind('b'.repeat(32), studentId);
    const saved = structuredClone([...f.rows]);
    f.bindings.requireBinding.mockClear();
    f.unsealSession.mockClear();
    f.readHistory.mockClear();

    await expect(f.service().reconcile(plan)).rejects.toMatchObject({ code: 'TRONCLASS_BINDING_CHANGED' });
    expect(f.bindings.requireBinding).toHaveBeenCalledExactlyOnceWith(OWNER, REVISION);
    expect(f.unsealSession).not.toHaveBeenCalled();
    expect(f.readHistory).not.toHaveBeenCalled();
    expect(f.fetchSchool).toHaveBeenCalledTimes(1);
    expect([...f.rows]).toEqual(saved);
  });

  it('keeps a failed readback unknown with its original operation and lock intact', async () => {
    const f = fixture();
    const plan = await f.service().preflight(input());
    f.setReadFailure(true);
    await f.service().dispatch(input(), plan, confirmation(plan));
    const saved = structuredClone([...f.rows]);
    expect(await f.service().reconcile(plan)).toEqual({
      status: 'unknown',
      operationId: OPERATION,
      receipt: null,
    });
    expect([...f.rows]).toEqual(saved);
    expect(f.fetchSchool).toHaveBeenCalledTimes(1);
  });

  it('freshly refuses revoked permission after review without treating the signed plan as a write grant', async () => {
    const f = fixture();
    const plan = await f.service().preflight(input());
    const grant = await f.authorize();
    f.authorize.mockResolvedValue({
      ...grant,
      assignment: { ...grant.assignment, canSubmit: false },
    });
    const reserve = vi.fn(async () => true);
    const service = f.service(reserve);
    expect((await service.dispatch(input(), plan, confirmation(plan))).status).toBe('unknown');
    const sourceCalls = f.authorize.mock.calls.length;
    expect((await service.dispatch(input(), plan, confirmation(plan))).status).toBe('unknown');
    expect(f.authorize).toHaveBeenCalledTimes(sourceCalls);
    expect(reserve).toHaveBeenCalledTimes(1);
    expect(f.fetchSchool).not.toHaveBeenCalled();
    expect(f.writes()).toBe(0);
  });

  it('reserves a local plan only after full validation and refuses a second dispatch without entering the candidate', async () => {
    const f = fixture();
    const plan = await f.service().preflight(input());
    const reserve = vi.fn(async () => false);
    const service = f.service(reserve);
    await expect(
      service.dispatch({ ...input(), content: 'changed' }, plan, confirmation(plan)),
    ).rejects.toMatchObject({ code: 'TRONCLASS_ACCEPTANCE_INPUT_CHANGED' });
    expect(reserve).not.toHaveBeenCalled();
    expect((await service.dispatch(input(), plan, confirmation(plan))).status).toBe('unknown');
    expect((await service.dispatch(input(), plan, confirmation(plan))).status).toBe('unknown');
    expect(reserve).toHaveBeenCalledTimes(1);
    expect(f.fetchSchool).not.toHaveBeenCalled();
    expect(f.writes()).toBe(0);
  });

  it('rejects attachments and unrecognized input before reading any binding or school data', async () => {
    const f = fixture();
    await expect(f.service().preflight({ ...input(), attachments: [] })).rejects.toMatchObject({
      code: 'TRONCLASS_ACCEPTANCE_INVALID_INPUT',
    });
    await expect(
      f.service().preflight({ ...input(), cookies: { session: 'private' } }),
    ).rejects.toMatchObject({ code: 'TRONCLASS_ACCEPTANCE_INVALID_INPUT' });
    expect(f.bindings.requireBinding).not.toHaveBeenCalled();
    expect(f.authorize).not.toHaveBeenCalled();
  });

  it('sanitizes upstream exceptions without leaking credentials, content or response bodies', async () => {
    const f = fixture();
    f.authorize.mockRejectedValue(
      new Error(`${SECRET} synthetic-private-cookie ${input().content}`),
    );
    await expect(f.service().preflight(input())).rejects.toMatchObject({
      code: 'TRONCLASS_ACCEPTANCE_UNAVAILABLE',
      message: 'TRONCLASS_ACCEPTANCE_UNAVAILABLE',
    });
  });
});

// @vitest-environment node
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { NuniError } from '@campus/shared/src/nuni';
import { createTronClassPublicSubmissionService, type TronClassPublicSubmissionDependencies, type TronClassPublicSubmitInput } from './tronClassPublicSubmissionService';
import type { TronClassCandidateAuthorization } from './tronClassSubmissionCandidate';
import type { TronClassPreparedSubmission, TronClassSubmissionBindings, TronClassSubmissionFirestore, TronClassSubmissionRef } from './tronClassSubmission';
import type { TronClassSubmissionBinding } from './tronClassSubmissionSource';
import type { LmsReadonlySource } from './tronClassLmsSource';
import { createTronClassPuAuthorizationReader } from './tronClassPuAuthorization';

vi.mock('server-only', () => ({}));

// Real candidate/journal/parser code with atomic in-memory transactions and
// synthetic HTTP only. These fixtures do not attest a school contract.
const OWNER = 'firebase:public-adapter-fixture';
const SCOPE = { courseId: 101, homeworkId: 202 };
const REVISION = 'a'.repeat(32);
const OPERATION = 'operation_public_fixture_0001';
const FILE_ID = 'file_public_fixture_0001';
const NOW = Date.parse('2026-11-18T01:00:00.700Z');
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const operationPath = `_tronClassSubmissionOperations/${hash(JSON.stringify([OWNER, OPERATION]))}`;
const lockPath = `_tronClassSubmissionLocks/${hash(JSON.stringify(['pu', 303, SCOPE.courseId, SCOPE.homeworkId]))}`;
const bindingPath = `_tronClassBindings/${hash(OWNER)}`;
const target = { uploadId: 601, mode: 'raw' as const, url: 'https://fixture-storage.example.invalid/objects/601' };
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });

function atomicDb() {
  const rows = new Map<string, Record<string, unknown>>();
  let failAcknowledgmentSave = false;
  let queue: Promise<unknown> = Promise.resolve();
  const snapshot = (path: string) => ({ exists: rows.has(path), data: () => rows.has(path) ? structuredClone(rows.get(path)!) : undefined });
  const db: TronClassSubmissionFirestore = {
    doc(path) { return { path, get: async () => snapshot(path) }; },
    runTransaction(run) {
      const pending = queue.then(async () => {
        const writes: Array<[string, Record<string, unknown>]> = [];
        const value = await run({
          get: async (ref: TronClassSubmissionRef) => {
            if (writes.length) throw new Error('Firestore reads must precede writes');
            return snapshot(ref.path);
          },
          set(ref, value) {
            if (failAcknowledgmentSave && value.version === 2 && value.state === 'acknowledged') {
              failAcknowledgmentSave = false;
              throw new Error('synthetic acknowledgment transaction failure');
            }
            writes.push([ref.path, structuredClone(value)]);
          },
        });
        for (const [path, row] of writes) rows.set(path, row);
        return value;
      });
      queue = pending.then(() => undefined, () => undefined);
      return pending;
    },
  };
  return { db, rows, failAcknowledgmentSaveOnce: () => { failAcknowledgmentSave = true; } };
}

function fixture(overrides: Partial<TronClassPublicSubmissionDependencies> = {}) {
  const store = atomicDb();
  let now = NOW;
  let enabled = true;
  let loseFinalResponse = false;
  let loseHistory = false;
  let acknowledgmentMissing = false;
  let callbackFailure = false;
  let finalRow: Record<string, unknown> | null = null;
  const identity: TronClassSubmissionBinding = { schoolId: 'pu', revision: REVISION, account: 'fixture-student', userId: 303,
    userName: null, cookies: { session: 'fixture-private-session', 'XSRF-TOKEN': 'fixture-xsrf' }, expiresAt: '2026-11-18T02:00:00.000Z' };
  const saveBinding = () => store.rows.set(bindingPath, { ownerKey: OWNER, schoolId: 'pu', state: 'connected', revision: identity.revision,
    userId: identity.userId, expiresAt: Date.parse(identity.expiresAt), updatedAt: now });
  saveBinding();
  const bindings: TronClassSubmissionBindings = {
    requireBinding: vi.fn(async owner => {
      if (owner !== OWNER) throw new NuniError(401, 'TRONCLASS_NOT_CONNECTED');
      if (store.rows.get(bindingPath)?.state !== 'connected') throw new NuniError(401, 'TRONCLASS_RECONNECT_REQUIRED');
      return structuredClone(identity);
    }),
    assertCurrent: vi.fn(async (owner, revision) => {
      if (owner !== OWNER || revision !== identity.revision) throw new NuniError(409, 'TRONCLASS_BINDING_CHANGED');
      if (store.rows.get(bindingPath)?.state !== 'connected') throw new NuniError(401, 'TRONCLASS_RECONNECT_REQUIRED');
    }),
  };
  const granted: TronClassCandidateAuthorization = { binding: structuredClone(identity), assignment: {
    ...SCOPE, studentId: 303, title: '新的校方標題', description: '', deadline: '2026-11-18T03:00:00.000Z', opensAt: null,
    permissionKnown: true, individual: true, canSubmit: true, isClosed: false, allowLate: false, remainingAttempts: 1,
    allowsText: true, allowsAttachments: true, maxFiles: 4, maxFileBytes: 10 * 1024 * 1024, maxTotalBytes: 20 * 1024 * 1024,
    allowedContentTypes: ['application/pdf'],
  }, mode: 'normal', historyComplete: true, priorSubmissionIds: [], userSubmitCount: 0,
  ordinaryWindowConfirmed: true, prerequisitesConfirmed: true };
  const base: TronClassPreparedSubmission = { source: 'tronclass', schoolId: 'pu', ...SCOPE, revision: REVISION,
    title: '唯讀詳情標題', description: '唯讀作業說明', deadline: null, canSubmit: false, blockedReason: '尚未開放',
    maxFiles: 0, maxFileBytes: 0, allowedContentTypes: [], rules: { status: 'unknown' }, receipt: null,
    details: { status: 'unavailable' }, history: { source: 'tronclass', ...SCOPE, fetchedAt: new Date(NOW).toISOString(),
      state: 'available', latestId: null, entries: [] } };
  const readonlyPrepare = vi.fn(async () => structuredClone(base));
  const legacyReconcile = vi.fn(async (_owner: string, input: { operationId: string; revision: string }) =>
    ({ status: 'unknown' as const, operationId: input.operationId, receipt: null }));
  const authorization = vi.fn(async () => structuredClone(granted));
  const resolveStorageTarget = vi.fn(async () => ({ ...target }));
  const fetchSchool = vi.fn(async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname;
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(new URL(url).origin).toBe('https://tronclass.pu.edu.tw');
    expect(init.method).toBe('POST');
    if (path === '/api/uploads') return json({ ...body, id: 601, storage_type: 'S3', transcoder: 'WRPC', upload_url: target.url });
    if (path === '/internal-api/upload/callback/601') return new Response(null, { status: callbackFailure ? 503 : 204 });
    expect(path).toBe('/api/course/activities/202/submissions');
    expect(body).toMatchObject({ is_draft: false, mode: 'normal', slides: [], other_resources: [], uploads_in_rich_text: [] });
    finalRow = { id: 501, course_id: 101, activity_id: 202, created_by: { id: 303 },
      is_latest_version: true, is_draft: false, is_redo: false, submit_by_instructor: false,
      comment: body.comment, uploads: (body.uploads as number[]).map(id => ({ id, name: 'fixture.pdf', size: 4 })),
      created_at: '2026-11-18T01:00:00Z', other_resources: [], slide_references: [] };
    if (loseFinalResponse) throw new Error('synthetic response lost');
    if (acknowledgmentMissing) return json({ id: 501 });
    return json({ submission: finalRow, student: { id: 303 } });
  });
  const fetchStorage = vi.fn(async (_url: string, init: RequestInit = {}) => {
    expect(init).toMatchObject({ method: 'PUT', redirect: 'manual', credentials: 'omit' });
    for (const name of ['Cookie', 'Authorization', 'X-XSRF-TOKEN', 'Referer']) expect(new Headers(init.headers).has(name)).toBe(false);
    return new Response(null, { status: 204 });
  });
  const readHistory = vi.fn(async (owner: string, binding: Pick<TronClassSubmissionBinding, 'schoolId' | 'revision' | 'userId'>, scope: typeof SCOPE) => {
    expect(owner).toBe(OWNER);
    expect(binding.userId).toBe(303);
    expect(scope).toEqual(SCOPE);
    if (loseHistory) throw new NuniError(504, 'TRONCLASS_READ_TIMEOUT');
    return { list: finalRow ? [structuredClone(finalRow)] : [] };
  });
  const dependencies: TronClassPublicSubmissionDependencies = { db: store.db, bindings, readonlyPrepare, legacyReconcile,
    enabled: () => enabled, contractVerified: true, authorization, resolveStorageTarget, readHistory, fetchSchool, fetchStorage, now: () => now,
    ...overrides };
  const service = createTronClassPublicSubmissionService(dependencies);
  return { ...store, service, dependencies, identity, saveBinding, granted, base, bindings, readonlyPrepare, legacyReconcile,
    authorization, resolveStorageTarget, fetchSchool, fetchStorage, readHistory,
    setEnabled: (value: boolean) => { enabled = value; }, setNow: (value: number) => { now = value; },
    loseFinalResponse: () => { loseFinalResponse = true; }, loseHistory: (value = true) => { loseHistory = value; },
    omitAcknowledgment: () => { acknowledgmentMissing = true; }, failCallback: () => { callbackFailure = true; } };
}
const upload = () => ({ ...SCOPE, revision: REVISION, operationId: OPERATION, fileId: FILE_ID,
  name: 'fixture.pdf', contentType: 'application/pdf', bytes: Uint8Array.from([37, 80, 68, 70]) });
const submit = (attachments: string[] = []): TronClassPublicSubmitInput => ({ ...SCOPE, revision: REVISION,
  operationId: OPERATION, content: '本文 <測試>\n第二行', attachments, confirmed: true });
const finalCalls = (f: ReturnType<typeof fixture>) => f.fetchSchool.mock.calls.filter(([url]) => url.endsWith('/submissions'));

function sourceBackedTextService(f: ReturnType<typeof fixture>) {
  let student = true;
  const activity = {
    id: SCOPE.homeworkId, course_id: SCOPE.courseId, type: 'homework', title: '來源已確認的純文字作業',
    published: true, submit_by_group: false, is_assigned_to_all: true, has_assign_student: false,
    has_assign_group: false, prerequisites: [], teaching_model: 'online', is_started: true,
    is_in_progress: true, is_closed: false, need_make_up: false, user_submit_count: 0,
    non_submit_times: true, submit_times: null, start_time: null, end_time: '2026-11-18T03:00:00Z',
    data: { mode: 'normal', homework_type: 'file_upload', has_assign_target: false, description: '合成來源說明' },
  };
  const source: LmsReadonlySource = {
    fetchCourses: vi.fn(async (_cookies, options) => options.status === 'ongoing'
      ? [{ id: SCOPE.courseId, name: '合成課程', role: 'student' }] : []),
    fetchHomeworkPage: vi.fn(async () => ({ ok: true as const, value: { homework_activities: [structuredClone(activity)], total: 1 } })),
    fetchHomeworkActivity: vi.fn(async () => ({ ok: true as const, value: structuredClone(activity) })),
    fetchCoursePage: vi.fn(async () => ({ ok: true as const, value: '<!doctype html><html><body>' +
      `<input type="hidden" id="courseId" value="${SCOPE.courseId}">` +
      `<input type="hidden" id="enrollment-is-student" value="${student ? 'True' : 'False'}">` +
      '</body></html>' })),
    fetchStudentSubmissionList: vi.fn(async () => ({ ok: true as const, value: await f.readHistory(OWNER, f.identity, SCOPE) })),
    fetchActivities: vi.fn(async () => ({ ok: true as const, value: [] })),
    fetchCourseAnnouncements: vi.fn(async () => ({ ok: true as const, value: [] })),
    fetchSiteAnnouncements: vi.fn(async () => ({ ok: true as const, value: [] })),
  };
  const authorization = createTronClassPuAuthorizationReader({ bindings: f.bindings, source, now: () => NOW });
  const service = createTronClassPublicSubmissionService({ ...f.dependencies, authorization, resolveStorageTarget: undefined });
  return { service, source, setStudent: (value: boolean) => { student = value; } };
}

describe('source-backed text authorization through the public v2 service', () => {
  it('uses actual enrollment/activity/history reads before the single final claim and exact readback', async () => {
    const f = fixture();
    const { service, source } = sourceBackedTextService(f);
    const prepared = await service.prepare(OWNER, SCOPE);
    expect(prepared).toMatchObject({ canSubmit: true, title: '來源已確認的純文字作業',
      maxFiles: 0, maxFileBytes: 0, allowedContentTypes: [],
      rules: { status: 'confirmed', allowsText: true, allowsAttachments: false, maxTotalBytes: 0 } });
    expect(await service.submit(OWNER, submit())).toMatchObject({ status: 'confirmed', operationId: OPERATION,
      confirmation: { kind: 'acknowledged-readback', submissionId: 501, ...SCOPE } });
    expect(f.authorization).not.toHaveBeenCalled();
    expect(source.fetchCoursePage).toHaveBeenCalled();
    expect(source.fetchStudentSubmissionList).toHaveBeenCalled();
    expect(finalCalls(f)).toHaveLength(1);
    expect(f.fetchStorage).not.toHaveBeenCalled();
    expect(f.rows.get(operationPath)).toMatchObject({ version: 2, state: 'acknowledged', files: [] });
  });

  it('does not reuse a prior prepare when current student enrollment has been withdrawn', async () => {
    const f = fixture();
    const { service, setStudent } = sourceBackedTextService(f);
    expect((await service.prepare(OWNER, SCOPE)).canSubmit).toBe(true);
    setStudent(false);
    // The candidate boundary deliberately returns its fixed public error;
    // the denied enrollment must still prevent both a claim and a school POST.
    await expect(service.submit(OWNER, submit())).rejects.toMatchObject({ code: 'TRONCLASS_CANDIDATE_UNCONFIRMED' });
    expect(f.fetchSchool).not.toHaveBeenCalled();
    expect(f.rows.has(operationPath)).toBe(false);
    expect(f.rows.has(lockPath)).toBe(false);
  });
});

describe('public v2 submission adapter gates and preparation', () => {
  it.each([true, false])('preserves scoped read-only availability through the public projection (verified=%s)', async verified => {
    const f = fixture({ contractVerified: verified });
    const availability = { source: 'tronclass' as const, ...SCOPE, revision: REVISION,
      fetchedAt: new Date(NOW).toISOString(), state: 'available' as const,
      ordinary: { state: 'open' as const, kind: 'first' as const, remainingAttempts: 1 },
      makeUp: { state: 'none' as const, updatedAt: null }, resubmit: { state: 'none' as const, updatedAt: null },
      draft: { state: 'none' as const, submissionId: null, count: 0 } };
    f.base.availability = availability;
    expect(await f.service.prepare(OWNER, SCOPE)).toMatchObject({ availability, canSubmit: verified });
    expect(f.fetchSchool).not.toHaveBeenCalled();
  });

  it.each(['course', 'revision', 'private-field'])('rejects %s availability at the public adapter boundary', async kind => {
    const f = fixture({ contractVerified: false });
    f.base.availability = { source: 'tronclass', ...SCOPE, revision: REVISION,
      fetchedAt: new Date(NOW).toISOString(), state: 'unavailable',
      ordinary: { state: 'unknown', kind: 'unknown', remainingAttempts: null },
      makeUp: { state: 'unknown', updatedAt: null }, resubmit: { state: 'unknown', updatedAt: null },
      draft: { state: 'unknown', submissionId: null, count: null } };
    if (kind === 'course') f.base.availability.courseId = 999;
    if (kind === 'revision') f.base.availability.revision = 'b'.repeat(32);
    if (kind === 'private-field') Object.assign(f.base.availability, { upload_url: 'private-source-url' });
    await expect(f.service.prepare(OWNER, SCOPE)).rejects.toMatchObject({ code: 'TRONCLASS_SUBMISSION_UNAVAILABLE' });
    expect(f.authorization).not.toHaveBeenCalled();
    expect(f.fetchSchool).not.toHaveBeenCalled();
  });

  it.each([
    ['default enabled', { enabled: undefined }], ['default attestation', { contractVerified: undefined }],
    ['unverified contract', { contractVerified: false }], ['no tenant authorizer', { authorization: undefined }],
    ['unverified text-only provider', { contractVerified: false, resolveStorageTarget: undefined }],
    ['text-only provider without authorizer', { authorization: undefined, resolveStorageTarget: undefined }],
  ] as const)('stays disabled with %s despite other supplied dependencies', async (_name, overrides) => {
    const f = fixture(overrides);
    const prepared = await f.service.prepare(OWNER, SCOPE);
    expect(prepared).toMatchObject({ canSubmit: false, rules: { status: 'unknown' }, details: { status: 'unavailable' } });
    expect(prepared.history).toEqual(f.base.history);
    await expect(f.service.upload(OWNER, upload())).rejects.toBeInstanceOf(NuniError);
    await expect(f.service.submit(OWNER, submit())).rejects.toBeInstanceOf(NuniError);
    expect(f.authorization).not.toHaveBeenCalled();
    expect(f.fetchSchool).not.toHaveBeenCalled();
    expect(f.fetchStorage).not.toHaveBeenCalled();
    expect(f.rows.has(operationPath)).toBe(false);
  });

  it('projects fresh authorized rules, preserves read-only history and never invents a receipt', async () => {
    const f = fixture();
    const result = await f.service.prepare(OWNER, SCOPE);
    expect(result).toMatchObject({ ...SCOPE, revision: REVISION, title: '新的校方標題', description: '',
      canSubmit: true, blockedReason: null, rules: { status: 'confirmed', allowsText: true, allowsAttachments: true }, receipt: null });
    expect(result.history).toEqual(f.base.history);
    expect(JSON.stringify(result)).not.toMatch(/fixture-private-session|fixture-xsrf|studentId|cookies/);
    expect(f.rows.has(operationPath)).toBe(false);
  });

  it.each([
    [true, true, true], [true, true, false], [true, false, true], [true, false, false],
    [false, true, true], [false, true, false], [false, false, true], [false, false, false],
  ] as const)('prepares effective capabilities with storage=%s, text=%s and source attachments=%s', async (storage, text, attachments) => {
    const f = fixture(storage ? {} : { resolveStorageTarget: undefined });
    f.granted.assignment.allowsText = text;
    f.granted.assignment.allowsAttachments = attachments;
    const prepared = await f.service.prepare(OWNER, SCOPE);
    const canAttach = storage && attachments;
    expect(prepared).toMatchObject({
      canSubmit: text || canAttach,
      maxFiles: canAttach ? 4 : 0,
      maxFileBytes: canAttach ? 10 * 1024 * 1024 : 0,
      allowedContentTypes: canAttach ? ['application/pdf'] : [],
      rules: { status: 'confirmed', allowsText: text, allowsAttachments: canAttach,
        maxTotalBytes: canAttach ? 20 * 1024 * 1024 : 0 },
    });
    expect(prepared.blockedReason === null).toBe(text || canAttach);
    expect(prepared.history).toEqual(f.base.history);
    expect(f.fetchSchool).not.toHaveBeenCalled();
    expect(f.fetchStorage).not.toHaveBeenCalled();
    expect(f.rows.has(operationPath)).toBe(false);
  });

  it('rejects attachment operations without storage policy before authorization, claims or network work', async () => {
    const f = fixture({ resolveStorageTarget: undefined });
    await expect(f.service.upload(OWNER, upload())).rejects.toMatchObject({ code: 'TRONCLASS_SUBMISSION_UNAVAILABLE' });
    await expect(f.service.submit(OWNER, submit([FILE_ID]))).rejects.toMatchObject({ code: 'TRONCLASS_SUBMISSION_UNAVAILABLE' });
    expect(f.authorization).not.toHaveBeenCalled();
    expect(f.fetchSchool).not.toHaveBeenCalled();
    expect(f.fetchStorage).not.toHaveBeenCalled();
    expect(f.rows.has(operationPath)).toBe(false);
    expect(f.rows.has(lockPath)).toBe(false);
  });

  it('cannot turn an attachment-only assignment into text submission when storage policy is absent', async () => {
    const f = fixture({ resolveStorageTarget: undefined });
    f.granted.assignment.allowsText = false;
    expect(await f.service.prepare(OWNER, SCOPE)).toMatchObject({ canSubmit: false, maxFiles: 0,
      rules: { status: 'confirmed', allowsText: false, allowsAttachments: false } });
    await expect(f.service.submit(OWNER, submit())).rejects.toMatchObject({ code: 'TRONCLASS_SUBMISSION_BLOCKED' });
    expect(f.fetchSchool).not.toHaveBeenCalled();
    expect(f.rows.has(operationPath)).toBe(false);
  });

  it('does not retain old details when the fresh authorization has no detail snapshot', async () => {
    const f = fixture();
    f.base.details = { status: 'available', fetchedAt: new Date(NOW - 60_000).toISOString(), submissionType: 'individual',
      mode: 'normal', opensAt: null, deadline: '2026-11-17T01:00:00.000Z', isInProgress: false, isClosed: true,
      attempts: { unlimited: false, limit: 1, used: 1, remaining: 0 }, resubmissionOpen: false, retractAllowed: false };
    const result = await f.service.prepare(OWNER, SCOPE);
    expect(result).toMatchObject({ canSubmit: true, deadline: f.granted.assignment.deadline, details: { status: 'unavailable' } });
  });

  it.each(['permissionKnown', 'prerequisitesConfirmed', 'ordinaryWindowConfirmed', 'historyComplete'] as const)(
    'does not grant prepare when %s is unknown', async field => {
      const f = fixture();
      if (field === 'permissionKnown') f.granted.assignment.permissionKnown = false;
      else f.granted[field] = false;
      expect((await f.service.prepare(OWNER, SCOPE)).canSubmit).toBe(false);
      expect(f.fetchSchool).not.toHaveBeenCalled();
    });

  it.each([true, false])('serializes the verified client contract when the optional XSRF cookie is absent (storage=%s)', async storage => {
    const f = fixture(storage ? {} : { resolveStorageTarget: undefined });
    delete f.granted.binding.cookies['XSRF-TOKEN'];
    expect((await f.service.prepare(OWNER, SCOPE)).canSubmit).toBe(true);
    expect(f.fetchSchool).not.toHaveBeenCalled();
    await expect(f.service.submit(OWNER, submit())).resolves.toMatchObject({ status: 'confirmed',
      confirmation: { kind: 'acknowledged-readback', submissionId: 501, ...SCOPE } });
    expect(finalCalls(f)).toHaveLength(1);
    expect(new Headers(finalCalls(f)[0][1]?.headers).has('X-XSRF-TOKEN')).toBe(false);
  });

  it.each([true, false])('never substitutes token presence for the separate production contract gate (token=%s)', async token => {
    const f = fixture({ contractVerified: false });
    if (!token) delete f.granted.binding.cookies['XSRF-TOKEN'];
    expect((await f.service.prepare(OWNER, SCOPE)).canSubmit).toBe(false);
    await expect(f.service.submit(OWNER, submit())).rejects.toMatchObject({ code: 'TRONCLASS_SUBMISSION_UNAVAILABLE' });
    expect(f.fetchSchool).not.toHaveBeenCalled();
  });

  it('rejects a mismatched authorization scope before projecting its content', async () => {
    const f = fixture();
    f.granted.assignment.homeworkId = 999;
    await expect(f.service.prepare(OWNER, SCOPE)).rejects.toMatchObject({ code: 'TRONCLASS_OPERATION_CONFLICT' });
  });

  it('withdraws prepare when the switch changes during authorization', async () => {
    const f = fixture();
    f.authorization.mockImplementationOnce(async () => { f.setEnabled(false); return structuredClone(f.granted); });
    expect((await f.service.prepare(OWNER, SCOPE)).canSubmit).toBe(false);
  });
});

describe('public v2 upload and final mapping', () => {
  it('runs real metadata/binary/callback/journal and exposes only the public uploaded handle', async () => {
    const f = fixture();
    const input = upload();
    const result = await f.service.upload(OWNER, input);
    expect(result).toEqual({ fileId: FILE_ID, name: input.name, contentType: input.contentType, size: 4,
      sha256: createHash('sha256').update(input.bytes).digest('hex'), status: 'uploaded' });
    expect(f.rows.get(operationPath)).toMatchObject({ version: 2, state: 'preparing', files: [{ fileId: FILE_ID, state: 'transferred', uploadId: 601 }] });
    expect(JSON.stringify(result)).not.toMatch(/ownerKey|studentId|uploadId|cookies|storage|revision/);
    expect(f.fetchStorage).toHaveBeenCalledOnce();
    expect(f.legacyReconcile).not.toHaveBeenCalled();
  });

  it('freezes the public upload bytes and scope before awaiting authorization', async () => {
    const f = fixture();
    let release!: (value: TronClassCandidateAuthorization) => void;
    f.authorization.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const input = upload();
    const pending = f.service.upload(OWNER, input);
    input.homeworkId = 999;
    input.bytes[0] = 0;
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    release(structuredClone(f.granted));
    const result = await pending;
    expect(result.sha256).toBe(createHash('sha256').update(upload().bytes).digest('hex'));
    expect(f.rows.get(operationPath)?.homeworkId).toBe(SCOPE.homeworkId);
  });

  it('does not call storage/final after a metadata-only transfer failure', async () => {
    const f = fixture();
    f.resolveStorageTarget.mockResolvedValueOnce(null as never);
    await expect(f.service.upload(OWNER, upload())).rejects.toBeInstanceOf(NuniError);
    expect(f.fetchStorage).not.toHaveBeenCalled();
    expect(f.rows.get(operationPath)).toMatchObject({ version: 2, state: 'preparing', files: [{ state: 'claimed' }] });
    await expect(f.service.submit(OWNER, submit([FILE_ID]))).rejects.toMatchObject({ code: 'TRONCLASS_UPLOAD_UNCONFIRMED' });
    expect(finalCalls(f)).toHaveLength(0);
  });

  it('does not expose an uploaded handle when callback was not confirmed', async () => {
    const f = fixture();
    f.failCallback();
    await expect(f.service.upload(OWNER, upload())).rejects.toBeInstanceOf(NuniError);
    expect(f.rows.get(operationPath)).toMatchObject({ files: [{ state: 'claimed' }] });
  });

  it.each(['confirmed missing', 'confirmed false', 'confirmed string', 'duplicate files', 'foreign field'])(
    'rejects %s before any claim or school request', async kind => {
      const f = fixture();
      const input = submit() as unknown as Record<string, unknown>;
      if (kind === 'confirmed missing') delete input.confirmed;
      if (kind === 'confirmed false') input.confirmed = false;
      if (kind === 'confirmed string') input.confirmed = 'true';
      if (kind === 'duplicate files') input.attachments = [FILE_ID, FILE_ID];
      if (kind === 'foreign field') input.ownerKey = 'someone-else';
      await expect(f.service.submit(OWNER, input as unknown as TronClassPublicSubmitInput)).rejects.toMatchObject({ code: 'TRONCLASS_INVALID_INPUT' });
      expect(f.rows.has(operationPath)).toBe(false);
      expect(f.fetchSchool).not.toHaveBeenCalled();
    });

  it.each(['too large', 'empty', 'invalid name', 'invalid MIME', 'unknown field'])('rejects bounded upload %s before network', async kind => {
    const f = fixture();
    const input = upload();
    if (kind === 'too large') input.bytes = new Uint8Array(10 * 1024 * 1024 + 1);
    if (kind === 'empty') input.bytes = new Uint8Array();
    if (kind === 'invalid name') input.name = '../secret.pdf';
    if (kind === 'invalid MIME') input.contentType = 'application/pdf\r\nCookie: x';
    if (kind === 'unknown field') Object.assign(input, { uploadUrl: target.url });
    await expect(f.service.upload(OWNER, input)).rejects.toMatchObject({ code: 'TRONCLASS_INVALID_INPUT' });
    expect(f.rows.has(operationPath)).toBe(false);
    expect(f.fetchSchool).not.toHaveBeenCalled();
  });

  it('maps a real final and exact readback to the distinct confirmed union without submittedAt', async () => {
    const f = fixture();
    await f.service.upload(OWNER, upload());
    const result = await f.service.submit(OWNER, submit([FILE_ID]));
    expect(result).toEqual({ status: 'confirmed', operationId: OPERATION, receipt: null, confirmation: {
      kind: 'acknowledged-readback', source: 'tronclass', schoolId: 'pu', operationId: OPERATION, submissionId: 501,
      ...SCOPE, confirmedAt: new Date(NOW).toISOString(), sourceRecordedAt: '2026-11-18T01:00:00.000Z',
    } });
    expect(JSON.stringify(result)).not.toMatch(/submittedAt|studentId|ownerKey|fixture.pdf|本文|Cookie/);
    expect(f.rows.get(operationPath)).toMatchObject({ version: 2, state: 'acknowledged', purgeAt: null });
    expect(f.rows.has(lockPath)).toBe(true);
    expect(finalCalls(f)).toHaveLength(1);
    expect(f.legacyReconcile).not.toHaveBeenCalled();
  });

  it.each([true, false])('supports pure text without creating a v1 operation or uploading files (storage=%s)', async storage => {
    const f = fixture(storage ? {} : { resolveStorageTarget: undefined });
    expect((await f.service.submit(OWNER, submit())).status).toBe('confirmed');
    expect(f.rows.get(operationPath)?.version).toBe(2);
    expect(f.fetchStorage).not.toHaveBeenCalled();
    expect(finalCalls(f)).toHaveLength(1);
  });

  it.each([true, false])('keeps a lost final response unknown and cannot dispatch again across service instances (storage=%s)', async storage => {
    const f = fixture(storage ? {} : { resolveStorageTarget: undefined });
    f.loseFinalResponse();
    expect(await f.service.submit(OWNER, submit())).toEqual({ status: 'unknown', operationId: OPERATION, receipt: null });
    const saved = structuredClone(f.rows.get(operationPath));
    const restarted = createTronClassPublicSubmissionService(f.dependencies);
    expect((await restarted.submit(OWNER, submit())).status).toBe('unknown');
    expect((await restarted.reconcile(OWNER, { operationId: OPERATION, revision: REVISION })).status).toBe('unknown');
    expect(f.rows.get(operationPath)).toEqual(saved);
    expect(f.rows.has(lockPath)).toBe(true);
    expect(f.readHistory).not.toHaveBeenCalled();
    expect(finalCalls(f)).toHaveLength(1);
  });

  it('keeps a malformed acknowledgment unknown without matching a same-content school version', async () => {
    const f = fixture();
    f.omitAcknowledgment();
    expect((await f.service.submit(OWNER, submit())).status).toBe('unknown');
    expect(f.readHistory).not.toHaveBeenCalled();
    expect(f.rows.get(operationPath)).toMatchObject({ state: 'final-claimed', acknowledgment: null });
    expect((await f.service.reconcile(OWNER, { operationId: OPERATION, revision: REVISION })).status).toBe('unknown');
    expect(finalCalls(f)).toHaveLength(1);
  });

  it('keeps an acknowledgment save failure unknown without retrying the accepted final', async () => {
    const f = fixture();
    f.failAcknowledgmentSaveOnce();
    expect((await f.service.submit(OWNER, submit())).status).toBe('unknown');
    expect(f.rows.get(operationPath)).toMatchObject({ state: 'final-claimed', acknowledgment: null });
    expect(f.readHistory).not.toHaveBeenCalled();
    expect((await f.service.submit(OWNER, submit())).status).toBe('unknown');
    expect(f.rows.has(lockPath)).toBe(true);
    expect(finalCalls(f)).toHaveLength(1);
  });

  it('reconciles the original acknowledged operation after a history failure with writes disabled', async () => {
    const f = fixture();
    f.loseHistory();
    expect((await f.service.submit(OWNER, submit())).status).toBe('unknown');
    f.loseHistory(false);
    f.setEnabled(false);
    const before = structuredClone(f.rows.get(operationPath));
    const result = await f.service.reconcile(OWNER, { operationId: OPERATION, revision: REVISION });
    expect(result.status).toBe('confirmed');
    expect(f.rows.get(operationPath)).toEqual(before);
    expect(f.rows.has(lockPath)).toBe(true);
    expect(finalCalls(f)).toHaveLength(1);
  });

  it('keeps an existing attachment operation read-only when its storage policy is removed', async () => {
    const f = fixture();
    await f.service.upload(OWNER, upload());
    f.loseHistory();
    expect((await f.service.submit(OWNER, submit([FILE_ID]))).status).toBe('unknown');
    const before = structuredClone(f.rows.get(operationPath));
    const textOnly = createTronClassPublicSubmissionService({ ...f.dependencies, resolveStorageTarget: undefined });
    await expect(textOnly.submit(OWNER, submit([FILE_ID]))).rejects.toMatchObject({ code: 'TRONCLASS_SUBMISSION_UNAVAILABLE' });
    f.loseHistory(false);
    f.setEnabled(false);
    expect((await textOnly.reconcile(OWNER, { operationId: OPERATION, revision: REVISION })).status).toBe('confirmed');
    expect(f.rows.get(operationPath)).toEqual(before);
    expect(f.rows.has(lockPath)).toBe(true);
    expect(finalCalls(f)).toHaveLength(1);
    expect(f.fetchStorage).toHaveBeenCalledOnce();
  });

  it('uses the original v1 reconciler only for v1 ledger records', async () => {
    const f = fixture();
    f.rows.set(operationPath, { version: 1 });
    await f.service.reconcile(OWNER, { operationId: OPERATION, revision: REVISION });
    expect(f.legacyReconcile).toHaveBeenCalledExactlyOnceWith(OWNER, { operationId: OPERATION, revision: REVISION }, f.identity);
    expect(f.fetchSchool).not.toHaveBeenCalled();
  });

  it('rejects a changed payload for an already claimed operation', async () => {
    const f = fixture();
    f.loseFinalResponse();
    await f.service.submit(OWNER, submit());
    await expect(f.service.submit(OWNER, { ...submit(), content: 'other text' })).rejects.toMatchObject({ code: 'TRONCLASS_OPERATION_CONFLICT' });
    expect(finalCalls(f)).toHaveLength(1);
  });

  it.each(['content', 'removed attachment', 'replaced attachment'])('rejects changed %s even when fresh permission blocks before the claim digest', async change => {
    const f = fixture();
    await f.service.upload(OWNER, upload());
    f.loseFinalResponse();
    expect((await f.service.submit(OWNER, submit([FILE_ID]))).status).toBe('unknown');
    const saved = structuredClone(f.rows.get(operationPath));
    f.granted.assignment.canSubmit = false;
    f.granted.userSubmitCount = 1;
    const changed = submit([FILE_ID]);
    if (change === 'content') changed.content = 'new draft';
    if (change === 'removed attachment') changed.attachments = [];
    if (change === 'replaced attachment') changed.attachments = ['file_different_fixture_001'];
    await expect(f.service.submit(OWNER, changed)).rejects.toMatchObject({ code: 'TRONCLASS_OPERATION_CONFLICT' });
    expect((await f.service.submit(OWNER, submit([FILE_ID]))).status).toBe('unknown');
    expect(f.rows.get(operationPath)).toEqual(saved);
    expect(f.rows.has(lockPath)).toBe(true);
    expect(finalCalls(f)).toHaveLength(1);
  });

  it('rejects an old revision rather than exposing a late confirmed response', async () => {
    const f = fixture();
    f.readHistory.mockImplementationOnce(async () => {
      f.identity.revision = 'b'.repeat(32);
      f.saveBinding();
      return { list: [] };
    });
    await expect(f.service.submit(OWNER, submit())).rejects.toMatchObject({ code: 'TRONCLASS_BINDING_CHANGED' });
    expect(f.rows.has(lockPath)).toBe(true);
    expect(finalCalls(f)).toHaveLength(1);
  });

  it('accepts an abort signal without starting a final request', async () => {
    const f = fixture();
    const controller = new AbortController();
    controller.abort();
    await expect(f.service.submit(OWNER, submit(), controller.signal)).rejects.toMatchObject({ code: 'TRONCLASS_CANDIDATE_TIMEOUT' });
    expect(f.rows.has(operationPath)).toBe(false);
    expect(f.fetchSchool).not.toHaveBeenCalled();
  });
});

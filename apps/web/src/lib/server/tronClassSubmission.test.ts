// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { NuniError } from '@campus/shared/src/nuni';
import { normalizeTronClassAssignmentDetails } from './tronClassAssignmentDetails';
import { createTronClassSubmissionSource } from './tronClassSubmissionSource';
import type { LmsReadonlySource } from './tronClassLmsSource';
import type { TronClassSubmissionAvailability } from '@campus/shared/src/tronClassSubmissionAvailability';
import {
  createTronClassSubmissionService,
  TRONCLASS_MAX_FILE_BYTES,
  type TronClassSubmissionFirestore,
  type TronClassSubmissionRef,
} from './tronClassSubmission';
import type {
  TronClassAssignment, TronClassSourceReceipt, TronClassSubmissionBinding,
  TronClassSubmissionSource,
} from './tronClassSubmissionSource';

const NOW = Date.parse('2026-11-13T08:00:00.000Z');
const OWNER = 'nuni:test-alice';
const REVISION = 'a'.repeat(32);
const OPERATION = 'operation-000000001';
const FILE_A = 'attachment-00000001';
const FILE_B = 'attachment-00000002';
const SCOPE = { courseId: 101, homeworkId: 202 };
const availability: TronClassSubmissionAvailability = {
  source: 'tronclass', ...SCOPE, revision: REVISION, fetchedAt: new Date(NOW).toISOString(), state: 'available',
  ordinary: { state: 'open', kind: 'first', remainingAttempts: 1 },
  makeUp: { state: 'none', updatedAt: null }, resubmit: { state: 'none', updatedAt: null },
  draft: { state: 'none', submissionId: null, count: 0 },
};
const INPUT = { ...SCOPE, revision: REVISION, operationId: OPERATION, content: '我的作業', attachments: [] as string[], confirmed: true as const };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

/** A transactionally shared store: separate service instances share one ledger. */
function memoryDb() {
  const rows = new Map<string, Record<string, unknown>>();
  let queue = Promise.resolve();
  let insideTransaction = false;
  const snapshot = (path: string) => ({
    exists: rows.has(path), data: () => rows.has(path) ? structuredClone(rows.get(path)!) : undefined,
  });
  const db: TronClassSubmissionFirestore = {
    doc(path) { return { path, get: async () => snapshot(path) }; },
    runTransaction(run) {
      const pending = queue.then(async () => {
        const writes: Array<[string, Record<string, unknown>]> = [];
        insideTransaction = true;
        try {
          const result = await run({
            get: async (ref: TronClassSubmissionRef) => {
              if (writes.length) throw new Error('Firestore reads must precede writes');
              return snapshot(ref.path);
            },
            set(ref, value) { writes.push([ref.path, structuredClone(value)]); },
          });
          for (const [path, value] of writes) rows.set(path, value);
          return result;
        } finally { insideTransaction = false; }
      });
      queue = pending.then(() => undefined, () => undefined);
      return pending;
    },
  };
  return { db, rows, isInsideTransaction: () => insideTransaction };
}

function fixture() {
  const store = memoryDb();
  const binding: TronClassSubmissionBinding = { schoolId: 'pu', revision: REVISION,
    account: 'student-test', userId: 303, userName: '測試同學', cookies: { session: 'fixture' },
    expiresAt: new Date(NOW + 3600_000).toISOString() };
  const assignment: TronClassAssignment = { ...SCOPE, studentId: 303,
    title: '資料庫作業', description: '請上傳報告。', deadline: new Date(NOW + 3600_000).toISOString(),
    opensAt: new Date(NOW - 3600_000).toISOString(), permissionKnown: true, individual: true,
    canSubmit: true, isClosed: false, allowLate: false, remainingAttempts: 1,
    allowsText: true, allowsAttachments: true, maxFiles: 4, maxFileBytes: TRONCLASS_MAX_FILE_BYTES,
    maxTotalBytes: 20 * 1024 * 1024, allowedContentTypes: ['application/pdf'] };
  const receipts: TronClassSourceReceipt[] = [];
  let enabled = true;
  let currentRevision = REVISION;
  const bindings = {
    requireBinding: vi.fn(async (ownerKey: string) => {
      if (ownerKey !== OWNER) throw new NuniError(401, 'TRONCLASS_RECONNECT_REQUIRED');
      return { ...binding, revision: currentRevision };
    }),
    assertCurrent: vi.fn(async (ownerKey: string, revision: string) => {
      if (ownerKey !== OWNER || revision !== currentRevision) throw new NuniError(409, 'TRONCLASS_BINDING_CHANGED');
    }),
  };
  const source: TronClassSubmissionSource = {
    contractVerified: true,
    getAssignment: vi.fn(async () => structuredClone(assignment)),
    uploadFile: vi.fn(async (_binding, scope, file) => {
      expect(store.isInsideTransaction()).toBe(false);
      return { courseId: scope.courseId, homeworkId: scope.homeworkId, studentId: scope.studentId,
        key: `school-${file.fileId}`, name: file.name, contentType: file.contentType,
        size: file.bytes.byteLength, sha256: file.sha256 };
    }),
    submit: vi.fn(async (_binding, scope, input) => {
      expect(store.isInsideTransaction()).toBe(false);
      receipts.push({ id: 'receipt-1', ...SCOPE, studentId: scope.studentId, status: 'submitted',
        submittedAt: new Date(NOW).toISOString(), content: input.content, attachments: input.attachments });
    }),
    listSubmissions: vi.fn(async () => structuredClone(receipts)),
  };
  const create = (overrides: Partial<Parameters<typeof createTronClassSubmissionService>[0]> = {}) =>
    createTronClassSubmissionService({ db: store.db, bindings, source, now: () => NOW, writeEnabled: () => enabled, ...overrides });
  const service = create();
  const upload = (fileId = FILE_A) => service.upload(OWNER, { ...SCOPE, revision: REVISION, operationId: OPERATION,
    fileId, name: `${fileId}.pdf`, contentType: 'application/pdf', bytes: new Uint8Array([1, 2, 3]) });
  return { ...store, source, assignment, binding, bindings, receipts, service, create, upload,
    disable: () => { enabled = false; }, rebind: () => { currentRevision = 'b'.repeat(32); } };
}

function closeOwner(rows: Map<string, Record<string, unknown>>) {
  rows.set(`_tronClassBindings/${createHash('sha256').update(OWNER).digest('hex')}`, {
    schoolId: 'pu', state: 'closed', ownerHash: createHash('sha256').update(OWNER).digest('hex'),
    revision: 'c'.repeat(32), updatedAt: NOW,
  });
  for (const [path, row] of rows) {
    if (row.ownerKey !== OWNER) continue;
    if (path.startsWith('_tronClassSubmissionOperations/')) rows.delete(path);
    if (path.startsWith('_tronClassSubmissionLocks/')) {
      rows.set(path, { version: 1, state: 'owner-deleted', updatedAt: NOW });
    }
  }
}

describe('TronClass submission orchestration (injected verified source only)', () => {
  it('keeps the optional availability reader absent from existing injected providers', async () => {
    const f = fixture();
    expect(await f.service.prepare(OWNER, SCOPE)).not.toHaveProperty('availability');
  });

  it('reads the same bound availability while writes are disabled without turning observations into a write grant', async () => {
    const f = fixture();
    f.disable();
    f.source.contractVerified = false;
    const readAvailability = vi.fn(async () => structuredClone(availability));
    const result = await f.create({ readAvailability }).prepare(OWNER, SCOPE);
    expect(readAvailability).toHaveBeenCalledExactlyOnceWith(OWNER, SCOPE, REVISION, expect.any(AbortSignal));
    expect(result).toMatchObject({ availability, canSubmit: false, receipt: null });
    expect(f.source.uploadFile).not.toHaveBeenCalled();
    expect(f.source.submit).not.toHaveBeenCalled();
    expect(result.availability).not.toBe(availability);
  });

  it('keeps confirmed detail and history when the optional availability read times out', async () => {
    const f = fixture();
    f.source.contractVerified = false;
    const history = { source: 'tronclass' as const, ...SCOPE, fetchedAt: new Date(NOW).toISOString(),
      state: 'available' as const, latestId: null, entries: [] };
    const details = normalizeTronClassAssignmentDetails({ id: SCOPE.homeworkId, course_id: SCOPE.courseId,
      type: 'homework', submit_by_group: false, is_in_progress: true, is_closed: false,
      non_submit_times: false, submit_times: 2, user_submit_count: 0, data: { mode: 'normal' },
    }, SCOPE, NOW).details;
    f.assignment.details = details;
    f.source.readSubmissionHistory = vi.fn(async () => history);
    const service = f.create({ readAvailability: async () => { throw new NuniError(504, 'TRONCLASS_READ_TIMEOUT'); } });
    expect(await service.prepare(OWNER, SCOPE)).toMatchObject({ details, history, canSubmit: false,
      availability: { ...SCOPE, revision: REVISION, state: 'unavailable',
        ordinary: { state: 'unknown', kind: 'unknown', remainingAttempts: null },
        makeUp: { state: 'unknown' }, resubmit: { state: 'unknown' }, draft: { state: 'unknown' } } });
  });

  it.each([
    { ...availability, courseId: 999 }, { ...availability, homeworkId: 999 },
    { ...availability, revision: 'b'.repeat(32) },
    { ...availability, cookie: 'private-provider-value' },
  ])('does not project mismatched or unfiltered availability data', async malformed => {
    const f = fixture();
    const service = f.create({ readAvailability: async () => malformed });
    const result = await service.prepare(OWNER, SCOPE);
    expect(result.availability).toMatchObject({ ...SCOPE, revision: REVISION, state: 'unavailable' });
    expect(JSON.stringify(result)).not.toContain('private-provider-value');
  });

  it.each([
    [401, 'TRONCLASS_RECONNECT_REQUIRED'], [403, 'TRONCLASS_COURSE_ACCESS_DENIED'],
    [404, 'TRONCLASS_HOMEWORK_NOT_FOUND'], [409, 'TRONCLASS_BINDING_CHANGED'],
  ] as const)('discards the earlier preparation after availability discovers %s %s', async (status, code) => {
    const f = fixture();
    const service = f.create({ readAvailability: async () => { throw new NuniError(status, code); } });
    await expect(service.prepare(OWNER, SCOPE)).rejects.toMatchObject({ status, code });
  });

  it('drops a late availability result after the student account is rebound', async () => {
    const f = fixture();
    const service = f.create({ readAvailability: async () => { f.rebind(); return availability; } });
    await expect(service.prepare(OWNER, SCOPE)).rejects.toMatchObject({ code: 'TRONCLASS_BINDING_CHANGED' });
  });

  it.each([
    [new Error('HTTP 401'), 'TRONCLASS_RECONNECT_REQUIRED'],
    [Object.assign(new Error('private upstream denial'), { status: 403 }), 'TRONCLASS_COURSE_ACCESS_DENIED'],
    [new Error('session 已失效'), 'TRONCLASS_RECONNECT_REQUIRED'],
  ])('does not downgrade a raw authentication/access failure from an injected reader', async (failure, code) => {
    const f = fixture();
    const service = f.create({ readAvailability: async () => { throw failure; } });
    await expect(service.prepare(OWNER, SCOPE)).rejects.toMatchObject({ code });
  });

  it('returns source details independently of write rules without granting a production writer', async () => {
    const f = fixture();
    const details = normalizeTronClassAssignmentDetails({ id: SCOPE.homeworkId, course_id: SCOPE.courseId,
      type: 'homework', submit_by_group: false, is_in_progress: true, is_closed: false,
      non_submit_times: false, submit_times: 2, user_submit_count: 0, data: { mode: 'normal' },
    }, SCOPE, NOW).details;
    Object.assign(f.assignment, { details, permissionKnown: false, canSubmit: false });
    f.source.contractVerified = false;
    const result = await f.service.prepare(OWNER, SCOPE);
    expect(result).toMatchObject({ details, rules: { status: 'unknown' }, canSubmit: false, receipt: null });
    expect(f.source.listSubmissions).not.toHaveBeenCalled();
    expect(f.source.submit).not.toHaveBeenCalled();
    expect(f.source.uploadFile).not.toHaveBeenCalled();
  });

  it('rejects malformed details from a provider before returning preparation', async () => {
    const f = fixture();
    Object.assign(f.assignment, { details: { status: 'available', raw: 'private server response' } });
    await expect(f.service.prepare(OWNER, SCOPE)).rejects.toMatchObject({ code: 'TRONCLASS_SUBMISSION_UNAVAILABLE' });
    expect(f.source.listSubmissions).not.toHaveBeenCalled();
  });

  it('discards detailed activity data when the binding changes during the source read', async () => {
    const f = fixture();
    vi.mocked(f.source.getAssignment).mockImplementationOnce(async () => {
      f.rebind();
      return { ...f.assignment, details: { status: 'unavailable' } };
    });
    await expect(f.service.prepare(OWNER, SCOPE)).rejects.toMatchObject({ code: 'TRONCLASS_BINDING_CHANGED' });
  });

  it('preserves confirmed zero attachment limits for a text-only assignment', async () => {
    const f = fixture();
    Object.assign(f.assignment, { allowsAttachments: false, maxFiles: 0, maxFileBytes: 0, maxTotalBytes: 0 });
    expect(await f.service.prepare(OWNER, SCOPE)).toMatchObject({ canSubmit: true, maxFiles: 0, maxFileBytes: 0,
      rules: { status: 'confirmed', allowsText: true, allowsAttachments: false, maxTotalBytes: 0 } });
    expect(f.source.uploadFile).not.toHaveBeenCalled();
    expect(f.source.submit).not.toHaveBeenCalled();
  });

  it('reports unconfirmed rules without interpreting placeholder false or zero values as school permissions', async () => {
    const f = fixture();
    Object.assign(f.assignment, { permissionKnown: false, allowsText: false, allowsAttachments: false,
      maxFiles: 0, maxFileBytes: 0, maxTotalBytes: 0 });
    expect(await f.service.prepare(OWNER, SCOPE)).toMatchObject({ canSubmit: false, rules: { status: 'unknown' } });
  });

  it.each([5 * 1024 * 1024, 30 * 1024 * 1024])('returns the stricter school/app total attachment limit for %s bytes', async (maxTotalBytes) => {
    const f = fixture();
    f.assignment.maxTotalBytes = maxTotalBytes;
    expect((await f.service.prepare(OWNER, SCOPE)).rules).toEqual({ status: 'confirmed',
      allowsText: true, allowsAttachments: true, maxTotalBytes: Math.min(maxTotalBytes, 20 * 1024 * 1024) });
  });

  it('does not enable an unverified writer merely because its read rules are known', async () => {
    const f = fixture();
    f.source.contractVerified = false;
    expect(await f.service.prepare(OWNER, SCOPE)).toMatchObject({ canSubmit: false,
      rules: { status: 'confirmed', allowsText: true, allowsAttachments: true } });
    expect(f.source.uploadFile).not.toHaveBeenCalled();
    expect(f.source.submit).not.toHaveBeenCalled();
  });

  it('prepares rules and requires all uploaded files plus a matching school receipt', async () => {
    const f = fixture();
    expect(await f.service.prepare(OWNER, SCOPE)).toMatchObject({ canSubmit: true, revision: REVISION, receipt: null });
    const fileA = await f.upload();
    const fileB = await f.upload(FILE_B);
    expect(fileA).toMatchObject({ status: 'uploaded', fileId: FILE_A, size: 3 });
    expect(fileA).not.toHaveProperty('key');
    const result = await f.service.submit(OWNER, { ...INPUT, attachments: [fileA.fileId, fileB.fileId] });
    expect(result).toMatchObject({ status: 'submitted', operationId: OPERATION,
      receipt: { id: 'receipt-1', source: 'tronclass', status: 'submitted', content: INPUT.content,
        courseId: 101, homeworkId: 202, submittedAt: '2026-11-13T08:00:00.000Z', attachments: [
          { name: `${FILE_A}.pdf`, size: 3 }, { name: `${FILE_B}.pdf`, size: 3 },
        ] } });
    expect(f.source.submit).toHaveBeenCalledTimes(1);
    expect(f.source.listSubmissions).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(result)).not.toContain('fixture');
    expect(JSON.stringify(result)).not.toContain('school-attachment');
  });

  it('keeps the runtime gate and unverified adapter fail-closed before upload or submission', async () => {
    const f = fixture();
    f.disable();
    await expect(f.upload()).rejects.toMatchObject({ code: 'TRONCLASS_WRITES_DISABLED' });
    await expect(f.service.submit(OWNER, INPUT)).rejects.toMatchObject({ code: 'TRONCLASS_WRITES_DISABLED' });
    expect(f.source.uploadFile).not.toHaveBeenCalled();
    expect(f.source.submit).not.toHaveBeenCalled();
    expect((await f.service.prepare(OWNER, SCOPE)).canSubmit).toBe(false);
    const other = fixture();
    other.source.contractVerified = false;
    await expect(other.upload()).rejects.toMatchObject({ code: 'TRONCLASS_SUBMISSION_UNAVAILABLE' });
    await expect(other.service.submit(OWNER, INPUT)).rejects.toMatchObject({ code: 'TRONCLASS_SUBMISSION_UNAVAILABLE' });
    expect((await other.service.prepare(OWNER, SCOPE)).canSubmit).toBe(false);
    expect(other.source.listSubmissions).not.toHaveBeenCalled();
  });

  it.each([
    { status: 401, code: 'TRONCLASS_RECONNECT_REQUIRED' },
    { status: 409, code: 'TRONCLASS_BINDING_CHANGED' },
    { status: 401, code: 'SIGN_IN_REQUIRED' },
    { status: 404, code: 'TRONCLASS_HOMEWORK_NOT_FOUND' },
  ])('surfaces expired or replaced sessions while preparing receipt reads: %j', async ({ status, code }) => {
    const f = fixture();
    vi.mocked(f.source.listSubmissions).mockRejectedValueOnce(new NuniError(status, code));
    await expect(f.service.prepare(OWNER, SCOPE)).rejects.toMatchObject({ status, code });
    expect(f.source.submit).not.toHaveBeenCalled();
    expect(f.source.uploadFile).not.toHaveBeenCalled();
    expect(f.rows.size).toBe(0);
  });

  it('retains a retryable receipt failure when the school session is still valid', async () => {
    const f = fixture();
    vi.mocked(f.source.listSubmissions).mockRejectedValueOnce(new NuniError(503, 'TRONCLASS_SOURCE_UNAVAILABLE'));
    await expect(f.service.prepare(OWNER, SCOPE)).resolves.toMatchObject({
      canSubmit: false, receipt: null, blockedReason: '繳交紀錄暫時無法確認，請重新讀取後再試。',
    });
    expect(f.source.submit).not.toHaveBeenCalled();
  });

  it('shows separate read-only school history while both production write operations remain unavailable', async () => {
    const f = fixture();
    f.source.contractVerified = false;
    const history = { source: 'tronclass' as const, ...SCOPE, fetchedAt: new Date(NOW).toISOString(),
      state: 'available' as const, latestId: '7', entries: [{ id: '7', state: 'returned' as const,
        isLatest: true, createdAt: new Date(NOW - 1000).toISOString(), content: '原本的作業',
        contentTruncated: false, attachments: [], hasOtherResources: false }] };
    f.source.readSubmissionHistory = vi.fn(async () => history);
    const result = await f.service.prepare(OWNER, SCOPE);
    expect(result).toMatchObject({ canSubmit: false, receipt: null, history });
    expect(f.source.listSubmissions).not.toHaveBeenCalled();
    await expect(f.upload()).rejects.toMatchObject({ code: 'TRONCLASS_SUBMISSION_UNAVAILABLE' });
    await expect(f.service.submit(OWNER, INPUT)).rejects.toMatchObject({ code: 'TRONCLASS_SUBMISSION_UNAVAILABLE' });
    expect(f.rows.size).toBe(0);
    expect(f.source.submit).not.toHaveBeenCalled();
  });

  it('does not use historical display data for submission reconciliation', async () => {
    const f = fixture();
    f.source.readSubmissionHistory = vi.fn();
    vi.mocked(f.source.submit).mockResolvedValueOnce();
    expect(await f.service.submit(OWNER, INPUT)).toMatchObject({ status: 'unknown', receipt: null });
    expect(f.source.readSubmissionHistory).not.toHaveBeenCalled();
  });

  it('does not relabel failed history reads as an empty successful history', async () => {
    const f = fixture();
    f.source.contractVerified = false;
    f.source.readSubmissionHistory = vi.fn(async () => { throw new NuniError(502, 'TRONCLASS_HISTORY_UNAVAILABLE'); });
    expect(await f.service.prepare(OWNER, SCOPE)).toMatchObject({ canSubmit: false, receipt: null,
      history: { state: 'unavailable', entries: [], latestId: null } });
  });

  it('drops a history result if the account rebinds while it is being loaded', async () => {
    const f = fixture();
    f.source.contractVerified = false;
    f.source.readSubmissionHistory = vi.fn(async () => {
      f.rebind();
      return { source: 'tronclass' as const, ...SCOPE, fetchedAt: new Date(NOW).toISOString(),
        state: 'available' as const, latestId: null, entries: [] };
    });
    await expect(f.service.prepare(OWNER, SCOPE)).rejects.toMatchObject({ code: 'TRONCLASS_BINDING_CHANGED' });
  });

  it('surfaces school expiry from the separate history source for inline reconnect', async () => {
    const f = fixture();
    f.source.contractVerified = false;
    f.source.readSubmissionHistory = vi.fn(async () => { throw new NuniError(401, 'TRONCLASS_RECONNECT_REQUIRED'); });
    await expect(f.service.prepare(OWNER, SCOPE)).rejects.toMatchObject({ status: 401, code: 'TRONCLASS_RECONNECT_REQUIRED' });
  });

  it.each([
    { read: 2, status: 404 }, { read: 2, status: 410 }, { read: 2, hidden: true },
    { read: 3, status: 404 }, { read: 3, status: 410 }, { read: 3, hidden: true },
  ])('discards earlier visible details when a later activity read denies access: %j', async denial => {
    const f = fixture();
    const activity = { id: SCOPE.homeworkId, course_id: SCOPE.courseId, type: 'homework',
      title: 'Earlier visible title', published: true, submit_by_group: false,
      data: { description: 'Earlier visible instructions', mode: 'normal' } };
    let reads = 0;
    const source: LmsReadonlySource = {
      fetchCourses: vi.fn(async (_cookies, options) => options.status === 'ongoing' ? [{ id: SCOPE.courseId }] : []),
      fetchHomeworkPage: vi.fn(async () => ({ ok: true as const, value: { homework_activities: [activity], total: 1 } })),
      fetchHomeworkActivity: vi.fn(async () => {
        reads += 1;
        if (reads !== denial.read) return { ok: true as const, value: activity };
        return denial.hidden ? { ok: true as const, value: { ...activity, hidden: true } }
          : { ok: false as const, status: denial.status! };
      }),
      fetchStudentSubmissionList: vi.fn(async () => ({ ok: true as const, value: { list: [] } })),
      fetchActivities: vi.fn(), fetchCourseAnnouncements: vi.fn(), fetchSiteAnnouncements: vi.fn(),
    };
    Object.assign(f.source, createTronClassSubmissionSource(source));
    const delivered = vi.fn();
    await expect(f.service.prepare(OWNER, SCOPE).then(delivered)).rejects.toMatchObject({
      status: 404, code: 'TRONCLASS_HOMEWORK_NOT_FOUND',
    });
    expect(delivered).not.toHaveBeenCalled();
    expect(source.fetchHomeworkActivity).toHaveBeenCalledTimes(denial.read);
    expect(source.fetchStudentSubmissionList).not.toHaveBeenCalled();
    expect(f.rows.size).toBe(0);
  });

  it.each(['courses', 'homework'] as const)('discards earlier details after a later %s membership check returns 403', async stage => {
    const f = fixture();
    const activity = { id: SCOPE.homeworkId, course_id: SCOPE.courseId, type: 'homework',
      title: 'Earlier visible title', published: true, submit_by_group: false,
      data: { description: 'Earlier visible instructions' } };
    let courseReads = 0;
    let homeworkReads = 0;
    const source: LmsReadonlySource = {
      fetchCourses: vi.fn(async (_cookies, options) => {
        courseReads += 1;
        if (stage === 'courses' && courseReads > 2) throw Object.assign(new Error('source denied'), { status: 403 });
        return options.status === 'ongoing' ? [{ id: SCOPE.courseId }] : [];
      }),
      fetchHomeworkPage: vi.fn(async () => {
        homeworkReads += 1;
        return stage === 'homework' && homeworkReads > 1 ? { ok: false as const, status: 403 }
          : { ok: true as const, value: { homework_activities: [activity], total: 1 } };
      }),
      fetchHomeworkActivity: vi.fn(async () => ({ ok: true as const, value: activity })),
      fetchStudentSubmissionList: vi.fn(async () => ({ ok: true as const, value: { list: [] } })),
      fetchActivities: vi.fn(), fetchCourseAnnouncements: vi.fn(), fetchSiteAnnouncements: vi.fn(),
    };
    Object.assign(f.source, createTronClassSubmissionSource(source));
    const delivered = vi.fn();
    await expect(f.service.prepare(OWNER, SCOPE).then(delivered)).rejects.toMatchObject({
      status: 403, code: 'TRONCLASS_COURSE_ACCESS_DENIED',
    });
    expect(delivered).not.toHaveBeenCalled();
    expect(source.fetchStudentSubmissionList).not.toHaveBeenCalled();
    expect(f.rows.size).toBe(0);
  });

  it.each([
    { permissionKnown: false }, { individual: false }, { canSubmit: false }, { isClosed: true },
    { remainingAttempts: 0 }, { deadline: '2026-11-12T08:00:00.000Z' },
    { opensAt: '2026-11-14T08:00:00.000Z' }, { allowsText: false, allowsAttachments: false },
  ])('does not submit when the latest source blocks it: %j', async (change) => {
    const f = fixture();
    Object.assign(f.assignment, change);
    expect((await f.service.prepare(OWNER, SCOPE)).canSubmit).toBe(false);
    await expect(f.service.submit(OWNER, INPUT)).rejects.toMatchObject({ code: 'TRONCLASS_SUBMISSION_BLOCKED' });
    expect(f.source.submit).not.toHaveBeenCalled();
  });

  it('does not accept a failed attachment or silently omit it from final submission', async () => {
    const f = fixture();
    await f.upload();
    vi.mocked(f.source.uploadFile).mockRejectedValueOnce(new Error('upstream timeout'));
    await expect(f.upload(FILE_B)).rejects.toMatchObject({ code: 'TRONCLASS_UPLOAD_UNCONFIRMED' });
    await expect(f.service.submit(OWNER, { ...INPUT, attachments: [FILE_A] })).rejects.toMatchObject({ code: 'TRONCLASS_UPLOAD_UNCONFIRMED' });
    await expect(f.service.submit(OWNER, { ...INPUT, attachments: [FILE_A, FILE_B] })).rejects.toMatchObject({ code: 'TRONCLASS_UPLOAD_UNCONFIRMED' });
    expect(f.source.submit).not.toHaveBeenCalled();
  });

  it('reuses a confirmed upload handle without duplicating an upload and rejects changed file bytes', async () => {
    const f = fixture();
    const first = await f.upload();
    expect(await f.upload()).toEqual(first);
    expect(f.source.uploadFile).toHaveBeenCalledTimes(1);
    await expect(f.service.upload(OWNER, { ...SCOPE, revision: REVISION, operationId: OPERATION, fileId: FILE_A,
      name: `${FILE_A}.pdf`, contentType: 'application/pdf', bytes: new Uint8Array([9]) }))
      .rejects.toMatchObject({ code: 'TRONCLASS_OPERATION_CONFLICT' });
  });

  it('rejects a returned upload key belonging to a different assignment', async () => {
    const f = fixture();
    vi.mocked(f.source.uploadFile).mockImplementationOnce(async (_binding, assignment, file) => ({
      courseId: assignment.courseId, homeworkId: 999, studentId: 303, key: 'wrong-homework-file',
      name: file.name, size: file.bytes.byteLength, contentType: file.contentType, sha256: file.sha256,
    }));
    await expect(f.upload()).rejects.toMatchObject({ code: 'TRONCLASS_UPLOAD_UNCONFIRMED' });
    await expect(f.service.submit(OWNER, { ...INPUT, attachments: [FILE_A] })).rejects.toMatchObject({ code: 'TRONCLASS_UPLOAD_UNCONFIRMED' });
    expect(f.source.submit).not.toHaveBeenCalled();
  });

  it('enforces file byte/type limits before writing and rechecks changed rules before final submission', async () => {
    const f = fixture();
    f.assignment.maxFileBytes = 2;
    await expect(f.upload()).rejects.toMatchObject({ code: 'TRONCLASS_SUBMISSION_BLOCKED' });
    f.assignment.maxFileBytes = 100;
    await f.upload();
    f.assignment.allowedContentTypes = ['text/plain'];
    await expect(f.service.submit(OWNER, { ...INPUT, attachments: [FILE_A] })).rejects.toMatchObject({ code: 'TRONCLASS_SUBMISSION_BLOCKED' });
    expect(f.source.submit).not.toHaveBeenCalled();
  });

  it('requires explicit confirmation and a valid bound revision', async () => {
    const f = fixture();
    await expect(f.service.submit(OWNER, { ...INPUT, confirmed: false } as never)).rejects.toMatchObject({ code: 'TRONCLASS_INVALID_INPUT' });
    await expect(f.service.submit(OWNER, { ...INPUT, revision: 'b'.repeat(32) })).rejects.toMatchObject({ code: 'TRONCLASS_BINDING_CHANGED' });
    expect(f.source.submit).not.toHaveBeenCalled();
  });

  it('repeated final requests and a new service instance only read the existing operation', async () => {
    const f = fixture();
    const first = await f.service.submit(OWNER, INPUT);
    const second = await f.create().submit(OWNER, INPUT);
    expect(second).toEqual(first);
    expect(f.source.submit).toHaveBeenCalledTimes(1);
    await expect(f.service.submit(OWNER, { ...INPUT, content: 'different content' })).rejects.toMatchObject({ code: 'TRONCLASS_OPERATION_CONFLICT' });
    expect(f.source.submit).toHaveBeenCalledTimes(1);
  });

  it('serializes independent processes and also locks out a different operation ID for the same assignment', async () => {
    const f = fixture();
    const started = deferred<void>();
    const finish = deferred<void>();
    vi.mocked(f.source.submit).mockImplementationOnce(async (_binding, assignment, input) => {
      started.resolve();
      await finish.promise;
      f.receipts.push({ id: 'receipt-1', ...SCOPE, studentId: assignment.studentId, status: 'submitted',
        submittedAt: new Date(NOW).toISOString(), content: input.content, attachments: input.attachments });
    });
    const first = f.service.submit(OWNER, INPUT);
    await started.promise;
    expect(await f.create().submit(OWNER, INPUT)).toMatchObject({ status: 'unknown' });
    await expect(f.create().submit(OWNER, { ...INPUT, operationId: 'different-operation-0001' }))
      .rejects.toMatchObject({ code: 'TRONCLASS_SUBMISSION_IN_PROGRESS' });
    expect(f.source.submit).toHaveBeenCalledTimes(1);
    finish.resolve();
    expect(await first).toMatchObject({ status: 'submitted' });
  });

  it('one school account bound to two nuni owners still has one final-submission lock', async () => {
    const f = fixture();
    vi.mocked(f.source.submit).mockRejectedValueOnce(new Error('unknown outcome'));
    expect(await f.service.submit(OWNER, INPUT)).toMatchObject({ status: 'unknown' });
    const secondOwner = 'nuni:second-owner';
    const second = createTronClassSubmissionService({ db: f.db, source: f.source, now: () => NOW, writeEnabled: () => true,
      bindings: { requireBinding: async () => f.binding, assertCurrent: async () => undefined } });
    // Reusing even the same operation ID must not bypass the first owner's lock.
    await expect(second.submit(secondOwner, INPUT)).rejects.toMatchObject({ code: 'TRONCLASS_SUBMISSION_IN_PROGRESS' });
    expect(f.source.submit).toHaveBeenCalledTimes(1);
  });

  it('reconciles an accepted submission even when the final POST response is lost', async () => {
    const f = fixture();
    vi.mocked(f.source.submit).mockImplementationOnce(async (_binding, assignment, input) => {
      f.receipts.push({ id: 'accepted-before-timeout', ...SCOPE, studentId: assignment.studentId, status: 'submitted',
        submittedAt: new Date(NOW).toISOString(), content: input.content, attachments: input.attachments });
      throw new Error('response lost');
    });
    expect(await f.service.submit(OWNER, INPUT)).toMatchObject({ status: 'submitted', receipt: { id: 'accepted-before-timeout' } });
    expect(f.source.submit).toHaveBeenCalledTimes(1);
  });

  it('keeps an unconfirmed operation unknown and permits read-only recovery after writes are disabled', async () => {
    const f = fixture();
    vi.mocked(f.source.submit).mockRejectedValueOnce(new Error('timeout'));
    expect(await f.service.submit(OWNER, INPUT)).toEqual({ status: 'unknown', operationId: OPERATION, receipt: null });
    expect(await f.create().submit(OWNER, INPUT)).toMatchObject({ status: 'unknown' });
    expect(f.source.submit).toHaveBeenCalledTimes(1);
    f.receipts.push({ id: 'late-receipt', ...SCOPE, studentId: 303, status: 'submitted',
      submittedAt: new Date(NOW).toISOString(), content: INPUT.content, attachments: [] });
    f.disable();
    expect(await f.create().reconcile(OWNER, { operationId: OPERATION, revision: REVISION }))
      .toMatchObject({ status: 'submitted', receipt: { id: 'late-receipt' } });
    expect(f.source.submit).toHaveBeenCalledTimes(1);
  });

  it('reconciles an unknown operation after reconnecting the same school identity with a new revision', async () => {
    const f = fixture();
    vi.mocked(f.source.submit).mockRejectedValueOnce(new Error('timeout'));
    expect(await f.service.submit(OWNER, INPUT)).toMatchObject({ status: 'unknown' });
    f.rebind();
    f.receipts.push({ id: 'found-after-reconnect', ...SCOPE, studentId: 303, status: 'submitted',
      submittedAt: new Date(NOW).toISOString(), content: INPUT.content, attachments: [] });
    expect(await f.create().reconcile(OWNER, { operationId: OPERATION, revision: 'b'.repeat(32) }))
      .toMatchObject({ status: 'submitted', receipt: { id: 'found-after-reconnect' } });
    expect(f.source.submit).toHaveBeenCalledTimes(1);
  });

  it('does not let a newly bound different school identity read or reuse the previous operation', async () => {
    const f = fixture();
    vi.mocked(f.source.submit).mockRejectedValueOnce(new Error('timeout'));
    await f.service.submit(OWNER, INPUT);
    const readsBeforeRebind = vi.mocked(f.source.listSubmissions).mock.calls.length;
    f.binding.userId = 999;
    f.rebind();
    await expect(f.service.reconcile(OWNER, { operationId: OPERATION, revision: 'b'.repeat(32) }))
      .rejects.toMatchObject({ code: 'TRONCLASS_OPERATION_CONFLICT' });
    expect(f.source.listSubmissions).toHaveBeenCalledTimes(readsBeforeRebind);
    expect(f.source.submit).toHaveBeenCalledTimes(1);
  });

  it.each([
    { status: 'draft' }, { submittedAt: null }, { studentId: 999 }, { homeworkId: 999 },
    { content: 'different answer' }, { submittedAt: '2026-11-12T08:00:00.000Z' },
    { attachments: [{ key: 'unexpected-file', name: 'extra.pdf', size: 3 }] },
  ])('does not accept an unrelated, incomplete or draft receipt: %j', async (change) => {
    const f = fixture();
    vi.mocked(f.source.submit).mockImplementationOnce(async () => {
      f.receipts.push({ id: 'invalid-receipt', ...SCOPE, studentId: 303, status: 'submitted',
        submittedAt: new Date(NOW).toISOString(), content: INPUT.content, attachments: [], ...change } as TronClassSourceReceipt);
    });
    expect(await f.service.submit(OWNER, INPUT)).toMatchObject({ status: 'unknown', receipt: null });
    expect(f.source.submit).toHaveBeenCalledTimes(1);
  });

  it('does not mistake a prior receipt with identical content for this submission', async () => {
    const f = fixture();
    f.receipts.push({ id: 'already-present', ...SCOPE, studentId: 303, status: 'submitted',
      submittedAt: new Date(NOW).toISOString(), content: INPUT.content, attachments: [] });
    vi.mocked(f.source.submit).mockResolvedValueOnce(undefined);
    expect(await f.service.submit(OWNER, INPUT)).toMatchObject({ status: 'unknown', receipt: null });
  });

  it('does not report success merely because the writer resolves without a receipt', async () => {
    const f = fixture();
    vi.mocked(f.source.submit).mockResolvedValueOnce(undefined);
    expect(await f.service.submit(OWNER, INPUT)).toMatchObject({ status: 'unknown', receipt: null });
    expect(f.source.submit).toHaveBeenCalledTimes(1);
  });

  it('stops before writing when the binding changes during preparation', async () => {
    const f = fixture();
    vi.mocked(f.source.getAssignment).mockImplementationOnce(async () => { f.rebind(); return f.assignment; });
    await expect(f.service.submit(OWNER, INPUT)).rejects.toMatchObject({ code: 'TRONCLASS_BINDING_CHANGED' });
    expect(f.source.submit).not.toHaveBeenCalled();
  });

  it('releases its own durable claim if the binding changes before any final request starts', async () => {
    const f = fixture();
    vi.mocked(f.source.getAssignment)
      .mockResolvedValueOnce(structuredClone(f.assignment))
      .mockImplementationOnce(async () => { f.rebind(); return structuredClone(f.assignment); });
    await expect(f.service.submit(OWNER, INPUT)).rejects.toMatchObject({ code: 'TRONCLASS_BINDING_CHANGED' });
    expect(f.source.submit).not.toHaveBeenCalled();
    expect([...f.rows.values()].find((row) => row.version === 1)).toMatchObject({ state: 'draft', payloadDigest: null, submitStartedAt: null });
    expect([...f.rows.values()].find((row) => row.version !== 1)).toMatchObject({ state: 'not-sent' });
    expect(await f.create().submit(OWNER, { ...INPUT, revision: 'b'.repeat(32), operationId: 'new-operation-after-rebind' }))
      .toMatchObject({ status: 'submitted' });
    expect(f.source.submit).toHaveBeenCalledTimes(1);
  });

  it('rechecks school rules after claiming the operation and releases a definitely unsent request', async () => {
    const f = fixture();
    vi.mocked(f.source.getAssignment)
      .mockResolvedValueOnce(structuredClone(f.assignment))
      .mockImplementationOnce(async () => ({ ...f.assignment, isClosed: true }));
    await expect(f.service.submit(OWNER, INPUT)).rejects.toMatchObject({ code: 'TRONCLASS_SUBMISSION_BLOCKED' });
    expect(f.source.submit).not.toHaveBeenCalled();
    expect([...f.rows.values()].find((row) => row.version !== 1)).toMatchObject({ state: 'not-sent' });
    expect(await f.create().submit(OWNER, INPUT)).toMatchObject({ status: 'submitted' });
  });

  it('does not return an old account receipt when binding changes after the external write', async () => {
    const f = fixture();
    vi.mocked(f.source.submit).mockImplementationOnce(async () => { f.rebind(); });
    await expect(f.service.submit(OWNER, INPUT)).rejects.toMatchObject({ code: 'TRONCLASS_BINDING_CHANGED' });
    expect(f.source.submit).toHaveBeenCalledTimes(1);
    await expect(f.service.reconcile('nuni:other', { operationId: OPERATION, revision: REVISION }))
      .rejects.toMatchObject({ code: 'TRONCLASS_RECONNECT_REQUIRED' });
  });

  it.each(['upload', 'submit'] as const)('does not create an %s operation when account closure follows preflight', async (action) => {
    const f = fixture();
    vi.mocked(f.source.getAssignment).mockImplementationOnce(async () => {
      closeOwner(f.rows);
      return structuredClone(f.assignment);
    });
    await expect(action === 'upload' ? f.upload() : f.service.submit(OWNER, INPUT))
      .rejects.toMatchObject({ code: 'TRONCLASS_RECONNECT_REQUIRED' });
    expect([...f.rows.keys()].every((path) => path.startsWith('_tronClassBindings/'))).toBe(true);
    expect(f.source.uploadFile).not.toHaveBeenCalled();
    expect(f.source.submit).not.toHaveBeenCalled();
  });

  it('does not recreate private upload metadata when an in-flight upload returns after account closure', async () => {
    const f = fixture();
    const schoolReply = deferred<Awaited<ReturnType<TronClassSubmissionSource['uploadFile']>>>();
    vi.mocked(f.source.uploadFile).mockImplementationOnce(() => schoolReply.promise);
    const pending = f.upload();
    await vi.waitFor(() => expect(f.source.uploadFile).toHaveBeenCalledOnce());
    closeOwner(f.rows);
    const file = vi.mocked(f.source.uploadFile).mock.calls[0][2];
    schoolReply.resolve({ ...SCOPE, studentId: 303, key: 'school-file', name: file.name,
      contentType: file.contentType, size: file.bytes.byteLength, sha256: file.sha256 });
    await expect(pending).rejects.toMatchObject({ code: 'TRONCLASS_RECONNECT_REQUIRED' });
    expect([...f.rows.keys()].every((path) => path.startsWith('_tronClassBindings/'))).toBe(true);
  });

  it('keeps the opaque slot after a dispatched request finishes after account deletion and blocks a new owner', async () => {
    const f = fixture();
    vi.mocked(f.source.submit).mockImplementationOnce(async () => { closeOwner(f.rows); });
    await expect(f.service.submit(OWNER, INPUT)).rejects.toMatchObject({ code: 'TRONCLASS_RECONNECT_REQUIRED' });
    expect([...f.rows.keys()].some((path) => path.startsWith('_tronClassSubmissionOperations/'))).toBe(false);
    const lock = [...f.rows].find(([path]) => path.startsWith('_tronClassSubmissionLocks/'))![1];
    expect(lock).toEqual({ version: 1, state: 'owner-deleted', updatedAt: NOW });
    const another = createTronClassSubmissionService({ db: f.db, source: f.source, now: () => NOW,
      bindings: { requireBinding: async () => f.binding, assertCurrent: async () => {} }, writeEnabled: () => true });
    await expect(another.submit('firebase:another-owner', INPUT)).rejects.toMatchObject({ code: 'TRONCLASS_SUBMISSION_IN_PROGRESS' });
    expect(f.source.submit).toHaveBeenCalledOnce();
  });

  it('expires private drafts and confirmed receipts without expiring an unresolved submission or its slot', async () => {
    const f = fixture();
    await f.upload();
    const operation = () => [...f.rows].find(([path]) => path.startsWith('_tronClassSubmissionOperations/'))![1];
    expect(operation().purgeAt).toEqual(new Date(NOW + 24 * 3600_000));
    const schoolReply = deferred<void>();
    vi.mocked(f.source.submit).mockImplementationOnce(() => schoolReply.promise);
    const pending = f.service.submit(OWNER, { ...INPUT, attachments: [FILE_A] });
    await vi.waitFor(() => expect(f.source.submit).toHaveBeenCalledOnce());
    expect(operation()).toMatchObject({ state: 'submitting', purgeAt: null });
    schoolReply.resolve();
    expect(await pending).toMatchObject({ status: 'unknown' });
    expect(operation()).toMatchObject({ state: 'unknown', purgeAt: null });
    f.receipts.push({ id: 'late-receipt', ...SCOPE, studentId: 303, status: 'submitted',
      submittedAt: new Date(NOW).toISOString(), content: INPUT.content,
      attachments: [{ key: `school-${FILE_A}`, name: `${FILE_A}.pdf`, size: 3 }] });
    await f.service.reconcile(OWNER, { operationId: OPERATION, revision: REVISION });
    expect(operation()).toMatchObject({ state: 'submitted', purgeAt: new Date(NOW + 30 * 24 * 3600_000) });
    const lock = [...f.rows].find(([path]) => path.startsWith('_tronClassSubmissionLocks/'))![1];
    expect(lock).not.toHaveProperty('purgeAt');
  });

  it('cannot resubmit the same operation ID after TTL removed its confirmed receipt', async () => {
    const f = fixture();
    await f.service.submit(OWNER, INPUT);
    for (const path of f.rows.keys()) if (path.startsWith('_tronClassSubmissionOperations/')) f.rows.delete(path);
    await expect(f.service.submit(OWNER, INPUT)).rejects.toMatchObject({ code: 'TRONCLASS_SUBMISSION_IN_PROGRESS' });
    expect(f.source.submit).toHaveBeenCalledOnce();
  });
});

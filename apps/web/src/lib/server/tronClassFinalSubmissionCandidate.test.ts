import { afterEach, describe, expect, it, vi } from 'vitest';
import { NuniError } from '@campus/shared/src/nuni';
import {
  createTronClassFinalSubmissionCandidate, type TronClassCandidateUploadedFile,
  type TronClassFinalCandidateAttempt, type TronClassFinalCandidateClaim, type TronClassFinalCandidateInput,
} from './tronClassFinalSubmissionCandidate';
import type { TronClassCandidateAuthorization } from './tronClassSubmissionCandidate';

// Synthetic school responses and a shared atomic journal. No live account or request.
const NOW = Date.parse('2026-11-17T08:00:00.000Z');
const OWNER = 'firebase:synthetic-student';
const INPUT = { courseId: 10, homeworkId: 20, revision: 'a'.repeat(32), operationId: 'operation_123456789',
  content: '作業 <內容>\n第二行', fileIds: ['attachment_123456789'] };
const COMMENT = '作業 &lt;內容&gt;<br>第二行';
function authorization(): TronClassCandidateAuthorization {
  return {
    binding: { schoolId: 'pu', userId: 30, account: 'synthetic', userName: null, revision: INPUT.revision,
      expiresAt: new Date(NOW + 3600_000).toISOString(), cookies: { session: 'synthetic-session', 'XSRF-TOKEN': 'synthetic-csrf' } },
    assignment: { courseId: 10, homeworkId: 20, studentId: 30, title: '作業', description: '',
      opensAt: null, deadline: new Date(NOW + 3600_000).toISOString(), permissionKnown: true, individual: true,
      canSubmit: true, isClosed: false, allowLate: false, remainingAttempts: 1, allowsText: true, allowsAttachments: true,
      maxFiles: 4, maxFileBytes: 10 * 1024 * 1024, maxTotalBytes: 20 * 1024 * 1024, allowedContentTypes: ['application/pdf'] },
    mode: 'normal', historyComplete: true, priorSubmissionIds: [], userSubmitCount: 0,
    ordinaryWindowConfirmed: true, prerequisitesConfirmed: true,
  };
}
function upload(): TronClassCandidateUploadedFile {
  return { ownerKey: OWNER, courseId: 10, homeworkId: 20, studentId: 30, revision: INPUT.revision,
    operationId: INPUT.operationId, fileId: INPUT.fileIds[0], uploadId: 40, name: '報告.pdf', size: 12,
    contentType: 'application/pdf', sha256: 'b'.repeat(64), state: 'transferred' };
}
function row() {
  return { id: 90, course_id: 10, activity_id: 20, created_by: { id: 30 }, is_draft: false,
    is_redo: false, submit_by_instructor: false, is_latest_version: true, comment: COMMENT,
    uploads: [{ id: 40, name: '報告.pdf', size: 12 }], created_at: '2026-11-17T08:00:00Z',
    submission_correct: { privateGrade: 'never-return-this' } };
}
function setup() {
  const auth = authorization();
  const files = [upload()];
  const attempts = new Map<string, TronClassFinalCandidateAttempt>();
  const locks = new Set<string>();
  const enabled = vi.fn(() => true);
  const authorize = vi.fn<Parameters<typeof createTronClassFinalSubmissionCandidate>[0]['authorize']>(async () => auth);
  const assertCurrent = vi.fn(async () => {});
  const readUploadedFiles = vi.fn<(owner: string, input: Omit<TronClassFinalCandidateInput, 'content'>) => Promise<TronClassCandidateUploadedFile[]>>(async () => files);
  const claim = vi.fn(async (attempt: TronClassFinalCandidateClaim) => {
    const key = `${attempt.studentId}:${attempt.courseId}:${attempt.homeworkId}`;
    if (locks.has(key)) return false;
    locks.add(key);
    attempts.set(attempt.operationId, structuredClone({ ...attempt, acknowledgment: null }));
    return true;
  });
  const rememberAcknowledgment = vi.fn(async (attempt: TronClassFinalCandidateClaim, acknowledgment: NonNullable<TronClassFinalCandidateAttempt['acknowledgment']>) => {
    const saved = attempts.get(attempt.operationId);
    if (!saved || saved.payloadDigest !== attempt.payloadDigest) throw new Error('journal-conflict');
    saved.acknowledgment = { ...acknowledgment };
  });
  const readAttempt = vi.fn(async (_owner: string, operation: string) => attempts.get(operation) ?? null);
  const requireBinding = vi.fn(async () => auth.binding);
  const readHistory = vi.fn(async () => ({ list: [row()] }));
  const fetch = vi.fn(async () => new Response(JSON.stringify({ student: { id: 30 }, submission: row() }), {
    headers: { 'Content-Type': 'application/json' },
  }));
  const dependencies = { enabled, authorize, assertCurrent, readUploadedFiles, claim, rememberAcknowledgment,
    readAttempt, requireBinding, readHistory, fetch, now: () => NOW };
  return { ...dependencies, dependencies, auth, files, attempts, locks,
    candidate: createTronClassFinalSubmissionCandidate(dependencies) };
}
afterEach(() => { vi.useRealTimers(); });

describe('controlled final POST and exact student readback', () => {
  it('is unavailable by default and never changes the production contract gate', async () => {
    const s = setup();
    const candidate = createTronClassFinalSubmissionCandidate({ ...s.dependencies, enabled: undefined });
    expect(candidate.contractVerified).toBe(false);
    expect(Object.isFrozen(candidate)).toBe(true);
    await expect(candidate.dispatch(OWNER, INPUT)).rejects.toMatchObject({ code: 'TRONCLASS_CANDIDATE_DISABLED' });
    expect(s.authorize).not.toHaveBeenCalled();
    expect(s.fetch).not.toHaveBeenCalled();
  });

  it('claims before POST, persists the acknowledged version, and reads exact text plus files', async () => {
    const s = setup();
    const result = await s.candidate.dispatch(OWNER, INPUT);
    expect(result).toEqual({ state: 'verified-new-version', operationId: INPUT.operationId, submissionId: 90,
      courseId: 10, activityId: 20, studentId: 30, sourceRecordedAt: '2026-11-17T08:00:00.000Z', confirmedAt: '2026-11-17T08:00:00.000Z' });
    expect(result).not.toHaveProperty('submittedAt');
    expect(result).not.toHaveProperty('receipt');
    expect(JSON.stringify(result)).not.toContain('never-return-this');
    expect(s.claim.mock.invocationCallOrder[0]).toBeLessThan(s.fetch.mock.invocationCallOrder[0]);
    expect(s.rememberAcknowledgment.mock.invocationCallOrder[0]).toBeLessThan(s.readHistory.mock.invocationCallOrder[0]);
    const [url, request] = s.fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://tronclass.pu.edu.tw/api/course/activities/20/submissions');
    expect(JSON.parse(String(request.body))).toEqual({ comment: COMMENT, uploads: [40], slides: [],
      is_draft: false, mode: 'normal', other_resources: [], uploads_in_rich_text: [] });
    expect(request).toMatchObject({ method: 'POST', redirect: 'manual', cache: 'no-store' });
    expect(new Headers(request.headers).get('X-XSRF-TOKEN')).toBe('synthetic-csrf');
    expect(s.claim.mock.calls[0][0]).not.toHaveProperty('cookies');
  });

  it('supports attachment-only work without requiring text permission', async () => {
    const s = setup();
    s.auth.assignment.allowsText = false;
    s.readHistory.mockResolvedValueOnce({ list: [{ ...row(), comment: '' }] });
    await expect(s.candidate.dispatch(OWNER, { ...INPUT, content: '' })).resolves.toMatchObject({ state: 'verified-new-version' });
  });

  it.each([
    ['wrong owner', (file: TronClassCandidateUploadedFile) => { file.ownerKey = 'firebase:other'; }],
    ['wrong student', (file: TronClassCandidateUploadedFile) => { file.studentId += 1; }],
    ['wrong binding', (file: TronClassCandidateUploadedFile) => { file.revision = 'c'.repeat(32); }],
    ['wrong operation', (file: TronClassCandidateUploadedFile) => { file.operationId = 'another_operation_id'; }],
    ['wrong homework', (file: TronClassCandidateUploadedFile) => { file.homeworkId += 1; }],
    ['metadata without transfer', (file: TronClassCandidateUploadedFile) => { file.state = 'metadata-created' as 'transferred'; }],
  ])('stops %s before reserving or submitting', async (_label, change) => {
    const s = setup();
    change(s.files[0]);
    await expect(s.candidate.dispatch(OWNER, INPUT)).rejects.toMatchObject({ code: 'TRONCLASS_UPLOAD_UNCONFIRMED' });
    expect(s.claim).not.toHaveBeenCalled();
    expect(s.fetch).not.toHaveBeenCalled();
  });

  it('rejects partial uploaded sets and changed school limits before POST', async () => {
    const s = setup();
    s.files.splice(0);
    await expect(s.candidate.dispatch(OWNER, INPUT)).rejects.toMatchObject({ code: 'TRONCLASS_UPLOAD_UNCONFIRMED' });
    const changed = setup();
    changed.auth.assignment.maxTotalBytes = 1;
    await expect(changed.candidate.dispatch(OWNER, INPUT)).rejects.toMatchObject({ code: 'TRONCLASS_SUBMISSION_BLOCKED' });
    expect(s.fetch).not.toHaveBeenCalled();
    expect(changed.fetch).not.toHaveBeenCalled();
  });

  it('does not claim an empty text-and-file request', async () => {
    const s = setup();
    s.files.splice(0);
    await expect(s.candidate.dispatch(OWNER, { ...INPUT, content: '  ', fileIds: [] })).rejects.toMatchObject({ code: 'TRONCLASS_PROTOCOL_INVALID_INPUT' });
    expect(s.claim).not.toHaveBeenCalled();
  });

  it.each(['disabled', 'deadline', 'binding'])('stops %s changing during the durable claim', async kind => {
    const s = setup();
    let instant = NOW;
    const original = s.claim.getMockImplementation()!;
    s.claim.mockImplementation(async attempt => {
      const result = await original(attempt);
      if (kind === 'disabled') s.enabled.mockReturnValue(false);
      if (kind === 'deadline') instant = NOW + 7200_000;
      if (kind === 'binding') s.assertCurrent.mockRejectedValue(new NuniError(409, 'TRONCLASS_BINDING_CHANGED'));
      return result;
    });
    const candidate = createTronClassFinalSubmissionCandidate({ ...s.dependencies, now: () => instant });
    await expect(candidate.dispatch(OWNER, INPUT)).rejects.toBeInstanceOf(NuniError);
    expect(s.fetch).not.toHaveBeenCalled();
  });

  it('keeps snapshots of caller text, rules, handles and stored claims across awaits', async () => {
    const s = setup();
    const input = structuredClone(INPUT);
    const original = s.claim.getMockImplementation()!;
    s.claim.mockImplementation(async attempt => {
      const result = await original(attempt);
      input.content = 'changed caller text';
      s.files[0].uploadId = 999;
      attempt.comment = 'changed callback text';
      attempt.uploads[0].id = 888;
      return result;
    });
    await expect(s.candidate.dispatch(OWNER, input)).resolves.toMatchObject({ state: 'verified-new-version' });
    const [, request] = s.fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(request.body))).toMatchObject({ comment: COMMENT, uploads: [40] });
  });

  it.each(['external-submission', 'closed', 'smaller-files', 'changed-student'])('rechecks %s after the claim and before POST', async kind => {
    const s = setup();
    const original = s.claim.getMockImplementation()!;
    s.claim.mockImplementation(async attempt => {
      const result = await original(attempt);
      if (kind === 'external-submission') { s.auth.priorSubmissionIds = [80]; s.auth.userSubmitCount = 1; }
      if (kind === 'closed') s.auth.assignment.isClosed = true;
      if (kind === 'smaller-files') s.auth.assignment.maxFileBytes = 1;
      if (kind === 'changed-student') { s.auth.binding.userId = 31; s.auth.assignment.studentId = 31; }
      return result;
    });
    await expect(s.candidate.dispatch(OWNER, INPUT)).rejects.toBeInstanceOf(NuniError);
    expect(s.authorize).toHaveBeenCalledTimes(2);
    expect(s.fetch).not.toHaveBeenCalled();
  });

  it('does not let an uploaded-file reader replace the selected file IDs', async () => {
    const s = setup();
    s.readUploadedFiles.mockImplementationOnce(async (_owner, input) => {
      (input.fileIds as string[])[0] = 'different_file_12345';
      return [{ ...upload(), fileId: 'different_file_12345' }];
    });
    await expect(s.candidate.dispatch(OWNER, INPUT)).rejects.toMatchObject({ code: 'TRONCLASS_UPLOAD_UNCONFIRMED' });
    expect(INPUT.fileIds[0]).toBe('attachment_123456789');
    expect(s.fetch).not.toHaveBeenCalled();
  });

  it('uses the durable claim across concurrent candidates instead of a process-local boolean', async () => {
    const s = setup();
    const second = createTronClassFinalSubmissionCandidate(s.dependencies);
    const results = await Promise.allSettled([s.candidate.dispatch(OWNER, INPUT), second.dispatch(OWNER, INPUT)]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    expect(s.fetch).toHaveBeenCalledTimes(1);
  });

  it.each([200, 302, 401, 503])('does not equate HTTP %s with successful homework delivery', async status => {
    const s = setup();
    s.fetch.mockResolvedValueOnce(new Response('{}', { status, headers: { 'content-type': 'application/json' } }));
    if (status === 401) await expect(s.candidate.dispatch(OWNER, INPUT)).rejects.toMatchObject({ code: 'TRONCLASS_RECONNECT_REQUIRED' });
    else await expect(s.candidate.dispatch(OWNER, INPUT)).resolves.toMatchObject({ state: 'awaiting-confirmation' });
    const second = createTronClassFinalSubmissionCandidate(s.dependencies);
    await expect(second.dispatch(OWNER, INPUT)).rejects.toMatchObject({ code: 'TRONCLASS_CANDIDATE_ALREADY_DISPATCHED' });
    expect(s.fetch).toHaveBeenCalledTimes(1);
  });

  it('retains the original version for read-only recovery after a missing file readback', async () => {
    const s = setup();
    s.readHistory.mockResolvedValueOnce({ list: [{ ...row(), uploads: [] }] });
    await expect(s.candidate.dispatch(OWNER, INPUT)).resolves.toMatchObject({ state: 'awaiting-confirmation' });
    s.enabled.mockReturnValue(false);
    s.auth.binding.revision = 'd'.repeat(32);
    const second = createTronClassFinalSubmissionCandidate(s.dependencies);
    await expect(second.reconcile(OWNER, INPUT.operationId)).resolves.toMatchObject({ state: 'verified-new-version', submissionId: 90 });
    expect(s.fetch).toHaveBeenCalledTimes(1);
    expect(s.claim).toHaveBeenCalledTimes(1);
    expect(s.readHistory).toHaveBeenCalledTimes(2);
  });

  it('cannot reconcile a stored attempt under another student or owner', async () => {
    const s = setup();
    await s.candidate.dispatch(OWNER, INPUT);
    s.readHistory.mockClear();
    await expect(s.candidate.reconcile('firebase:other', INPUT.operationId)).rejects.toMatchObject({ code: 'TRONCLASS_OPERATION_CONFLICT' });
    s.auth.binding.userId = 31;
    await expect(s.candidate.reconcile(OWNER, INPUT.operationId)).rejects.toMatchObject({ code: 'TRONCLASS_RECONNECT_REQUIRED' });
    expect(s.readHistory).not.toHaveBeenCalled();
  });

  it('rejects changed stored content before reading a claimed version', async () => {
    const s = setup();
    await s.candidate.dispatch(OWNER, INPUT);
    s.attempts.get(INPUT.operationId)!.comment = 'tampered stored text';
    s.readHistory.mockClear();
    await expect(s.candidate.reconcile(OWNER, INPUT.operationId)).rejects.toMatchObject({ code: 'TRONCLASS_OPERATION_CONFLICT' });
    expect(s.readHistory).not.toHaveBeenCalled();
    expect(s.fetch).toHaveBeenCalledTimes(1);
  });

  it('does not return a late confirmation after the binding changes', async () => {
    const s = setup();
    s.readHistory.mockImplementationOnce(async () => {
      s.assertCurrent.mockRejectedValue(new NuniError(409, 'TRONCLASS_BINDING_CHANGED'));
      return { list: [row()] };
    });
    await expect(s.candidate.dispatch(OWNER, INPUT)).rejects.toMatchObject({ code: 'TRONCLASS_BINDING_CHANGED' });
    expect(s.fetch).toHaveBeenCalledTimes(1);
  });

  it.each(['initial', 'pre-post'] as const)('cancels the %s authorization source before any further write', async phase => {
    const s = setup();
    const caller = new AbortController();
    const sourceStopped = vi.fn();
    let started!: () => void;
    const sourceStarted = new Promise<void>(resolve => { started = resolve; });
    if (phase === 'pre-post') s.authorize.mockResolvedValueOnce(s.auth);
    s.authorize.mockImplementationOnce((_owner, _scope, signal) => {
      const pending = new Promise<TronClassCandidateAuthorization>((_resolve, reject) => {
        signal?.addEventListener('abort', () => {
          sourceStopped();
          reject(new DOMException('Cancelled', 'AbortError'));
        }, { once: true });
      });
      started();
      return pending;
    });
    const rejected = expect(s.candidate.dispatch(OWNER, INPUT, caller.signal))
      .rejects.toMatchObject({ code: 'TRONCLASS_CANDIDATE_TIMEOUT' });
    await sourceStarted;
    caller.abort();
    await rejected;
    expect(sourceStopped).toHaveBeenCalledTimes(1);
    const sourceSignal = s.authorize.mock.calls.at(-1)![2];
    expect(sourceSignal?.aborted).toBe(true);
    expect(sourceSignal).toBe(s.authorize.mock.calls[0][2]);
    expect(s.claim).toHaveBeenCalledTimes(phase === 'initial' ? 0 : 1);
    expect(s.fetch).not.toHaveBeenCalled();
    expect(s.rememberAcknowledgment).not.toHaveBeenCalled();
    expect(s.readHistory).not.toHaveBeenCalled();
  });

  it('aborts a stalled final request while retaining its durable claim', async () => {
    vi.useFakeTimers();
    const s = setup();
    s.fetch.mockImplementationOnce(() => new Promise<Response>(() => {}));
    const candidate = createTronClassFinalSubmissionCandidate({ ...s.dependencies, timeoutMs: 20 });
    const rejected = expect(candidate.dispatch(OWNER, INPUT)).rejects.toMatchObject({ code: 'TRONCLASS_CANDIDATE_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(20);
    await rejected;
    const second = createTronClassFinalSubmissionCandidate(s.dependencies);
    await expect(second.dispatch(OWNER, INPUT)).rejects.toMatchObject({ code: 'TRONCLASS_CANDIDATE_ALREADY_DISPATCHED' });
    expect(s.fetch).toHaveBeenCalledTimes(1);
  });
});

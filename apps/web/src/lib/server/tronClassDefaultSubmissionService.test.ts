// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The production authorization reader is server-only; Vitest runs outside
// Next's react-server condition while exercising this server-side factory.
vi.mock('server-only', () => ({}));

const runtime = vi.hoisted(() => ({
  getFirebaseAdmin: vi.fn(), createBinding: vi.fn(), createSource: vi.fn(), createAuthorization: vi.fn(),
  createAvailability: vi.fn(),
}));
vi.mock('./firebaseAdmin', () => ({ getFirebaseAdmin: runtime.getFirebaseAdmin }));
vi.mock('./tronClassBinding', () => ({ createTronClassBindingService: runtime.createBinding }));
vi.mock('./tronClassSubmissionSource', () => ({ createTronClassSubmissionSource: runtime.createSource }));
vi.mock('./tronClassPuAuthorization', () => ({ createTronClassPuAuthorizationReader: runtime.createAuthorization }));
vi.mock('./tronClassSubmissionAvailability', () => ({ createTronClassSubmissionAvailabilityReader: runtime.createAvailability }));

import { getDefaultTronClassSubmissionService } from './tronClassSubmission';
import type { TronClassSubmissionBinding, TronClassSubmissionSource } from './tronClassSubmissionSource';
import type { TronClassSubmissionAvailability } from '@campus/shared/src/tronClassSubmissionAvailability';

const ownerKey = 'platform:pa_default_service_fixture';
const scope = { courseId: 101, homeworkId: 202 };
const revision = 'a'.repeat(32);
const operationId = 'operation_default_fixture';
const fileId = 'attachment_default_fixture';

function setup() {
  const binding: TronClassSubmissionBinding = {
    schoolId: 'pu', revision, userId: 303, account: 'synthetic-account', userName: null,
    cookies: { session: 'private-synthetic-cookie' }, expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  };
  const bindings = { requireBinding: vi.fn(async () => binding), assertCurrent: vi.fn(async () => {}) };
  const db = {
    doc: vi.fn(() => ({ path: 'fixture', get: vi.fn(async () => ({ exists: false, data: () => undefined })) })),
    runTransaction: vi.fn(async () => { throw new Error('disabled writer must not create a ledger'); }),
  };
  const source: TronClassSubmissionSource = {
    contractVerified: false,
    getAssignment: vi.fn(async () => ({ ...scope, studentId: 303, title: '合成作業', description: '保留唯讀詳情',
      deadline: null, opensAt: null, permissionKnown: false, individual: true, canSubmit: false,
      isClosed: false, allowLate: false, allowsText: true, allowsAttachments: true,
      maxFiles: 4, maxFileBytes: 10 * 1024 * 1024, maxTotalBytes: 20 * 1024 * 1024,
      remainingAttempts: null, allowedContentTypes: ['text/plain'],
    })),
    uploadFile: vi.fn(async () => { throw new Error('legacy school upload must not be called'); }),
    submit: vi.fn(async () => { throw new Error('legacy school submit must not be called'); }),
    listSubmissions: vi.fn(async () => []),
  };
  runtime.getFirebaseAdmin.mockResolvedValue({ db });
  runtime.createBinding.mockReturnValue(bindings);
  runtime.createSource.mockReturnValue(source);
  const authorization = vi.fn(async () => { throw new Error('unverified writer must not probe tenant authorization'); });
  runtime.createAuthorization.mockReturnValue(authorization);
  const availability: TronClassSubmissionAvailability = {
    source: 'tronclass', ...scope, revision, fetchedAt: '2026-11-18T00:00:00.000Z', state: 'available',
    ordinary: { state: 'open', kind: 'first', remainingAttempts: 3 },
    makeUp: { state: 'none', updatedAt: null },
    resubmit: { state: 'none', updatedAt: null },
    draft: { state: 'none', submissionId: null, count: 0 },
  };
  const readAvailability = vi.fn(async () => structuredClone(availability));
  runtime.createAvailability.mockReturnValue(readAvailability);
  return { binding, bindings, db, source, authorization, availability, readAvailability };
}

beforeEach(() => vi.resetAllMocks());
afterEach(() => vi.unstubAllEnvs());

describe('production default public submission factory', () => {
  it.each(['false', 'true'])('keeps verified school writes disabled with the legacy env flag %s', async flag => {
    vi.stubEnv('TRONCLASS_HOMEWORK_WRITE_ENABLED', flag);
    const s = setup();
    const service = await getDefaultTronClassSubmissionService();
    const prepared = await service.prepare(ownerKey, scope);
    expect(prepared).toMatchObject({ ...scope, revision, title: '合成作業', description: '保留唯讀詳情', canSubmit: false });
    expect(prepared.rules.status).toBe('unknown');
    expect(prepared.receipt).toBeNull();
    expect(runtime.createAvailability).toHaveBeenCalledExactlyOnceWith({ bindings: s.bindings });
    expect(s.readAvailability).toHaveBeenCalledExactlyOnceWith(ownerKey, scope, revision, expect.any(AbortSignal), s.binding);
    expect(prepared.availability).toEqual(s.availability);
    // A real reader is wired into the factory, but its available school window
    // cannot grant nuni's still-unverified writer or trigger any school mutation.
    await expect(service.upload(ownerKey, { ...scope, revision, operationId, fileId, name: '作業.txt', contentType: 'text/plain',
      bytes: new TextEncoder().encode('合成內容') })).rejects.toMatchObject({ status: 503 });
    await expect(service.submit(ownerKey, { ...scope, revision, operationId, content: '合成內容', attachments: [], confirmed: true }))
      .rejects.toMatchObject({ status: 503 });
    expect(s.source.uploadFile).not.toHaveBeenCalled();
    expect(s.source.submit).not.toHaveBeenCalled();
    expect(runtime.createAuthorization).toHaveBeenCalledExactlyOnceWith({ bindings: s.bindings });
    expect(s.authorization).not.toHaveBeenCalled();
    expect(s.db.runTransaction).not.toHaveBeenCalled();
    expect(JSON.stringify(prepared)).not.toContain('private-synthetic-cookie');
  });

  it('does not convert missing durable storage into an in-memory write-capable service', async () => {
    setup();
    runtime.getFirebaseAdmin.mockResolvedValue(null);
    await expect(getDefaultTronClassSubmissionService()).rejects.toMatchObject({ status: 503, code: 'TRONCLASS_SUBMISSION_UNAVAILABLE' });
    expect(runtime.createBinding).not.toHaveBeenCalled();
    expect(runtime.createSource).not.toHaveBeenCalled();
    expect(runtime.createAuthorization).not.toHaveBeenCalled();
    expect(runtime.createAvailability).not.toHaveBeenCalled();
  });
});

// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FILE_ONLY_SUBMISSION_BODY } from '@campus/shared/src/assignmentFiles';
import { NuniError, type NuniAssignment, type NuniWorkspace } from '@campus/shared/src/nuni';
import {
  createAssignmentFileService,
  resetAssignmentFileStores,
  type AssignmentFileActor,
  type AssignmentFilePlatform,
} from './assignmentFileService';
import {
  createFakeAssignmentFileSql,
  createMemoryIndexStore,
  createSqlIndexStore,
  createTtlMemoryBlobStore,
  resolveAssignmentFileStores,
} from './assignmentFileStore';

const workspaceId = 'cw_11111111-1111-4111-8111-111111111111';
const assignmentId = 'cwa_22222222-2222-4222-8222-222222222222';
const studentId = 'pa_33333333-3333-4333-8333-333333333333';
const teacherId = 'pa_44444444-4444-4444-8444-444444444444';
const outsiderId = 'pa_55555555-5555-4555-8555-555555555555';
const secret = 'test-assignment-file-signing-secret-32ch';

function jpeg(size = 64) {
  const bytes = new Uint8Array(size);
  bytes.set([0xff, 0xd8, 0xff, 0xe0]);
  return bytes;
}

function actor(id: string): AssignmentFileActor {
  return { platformAccountId: id, session: { sessionHandle: `ps_${'a'.repeat(43)}`, expiresAt: Date.now() + 60_000 } };
}

function workspace(role: NuniWorkspace['memberRole']): NuniWorkspace {
  return { id: workspaceId, title: '資料庫', state: 'active', memberRole: role };
}

function assignment(overrides: Partial<NuniAssignment> = {}): NuniAssignment {
  return {
    id: assignmentId,
    workspaceId,
    title: '設計資料表',
    instructions: '說明主鍵。',
    state: 'open',
    createdAt: '2026-10-20T00:00:00.000Z',
    closedAt: null,
    dueAt: '2026-10-21T12:00:00.000Z',
    unitId: null,
    unitTitle: null,
    submissionCount: 0,
    mySubmission: null,
    ...overrides,
  };
}

function platform(options?: {
  role?: NuniWorkspace['memberRole'];
  item?: NuniAssignment;
  submit?: AssignmentFilePlatform['submitText'];
}): AssignmentFilePlatform {
  const item = options?.item ?? assignment();
  return {
    workspace: async (_actor) => workspace(options?.role ?? 'student'),
    assignment: async () => item,
    submitText:
      options?.submit ??
      (async (_actor, _w, _a, body) =>
        assignment({
          submissionCount: 1,
          mySubmission: {
            assignmentId,
            platformAccountId: studentId,
            displayName: '同學',
            body,
            state: 'submitted',
            submittedAt: '2026-10-21T13:00:00.000Z',
            teacherFeedback: null,
            reviewedAt: null,
          },
        })),
  };
}

function service(options?: Parameters<typeof platform>[0] & { now?: () => Date }) {
  let seq = 0;
  return createAssignmentFileService({
    platform: platform(options),
    secret,
    now: options?.now ?? (() => new Date('2026-10-21T13:00:00.000Z')),
    id: () => `11111111-1111-4111-8111-${String(++seq).padStart(12, '0')}`,
  });
}

beforeEach(() => resetAssignmentFileStores());
afterEach(() => {
  resetAssignmentFileStores();
  vi.unstubAllEnvs();
});

describe('assignment file service', () => {
  it('rejects non-students, closed assignments, bad types, and oversize files', async () => {
    const teacher = service({ role: 'owner-teacher' });
    await expect(
      teacher.createIntent(actor(teacherId), workspaceId, assignmentId, {
        originalName: 'shot.jpg',
        contentType: 'image/jpeg',
        byteSize: 64,
        idempotencyKey: 'intent-key-teacher',
      }),
    ).rejects.toMatchObject({ status: 403, code: 'CLASS_WORKSPACE_STUDENT_REQUIRED' });

    const closed = service({ item: assignment({ state: 'closed', closedAt: '2026-10-21T12:00:00.000Z' }) });
    await expect(
      closed.createIntent(actor(studentId), workspaceId, assignmentId, {
        originalName: 'shot.jpg',
        contentType: 'image/jpeg',
        byteSize: 64,
        idempotencyKey: 'intent-key-closed',
      }),
    ).rejects.toMatchObject({ status: 409, code: 'ASSIGNMENT_CLOSED' });

    const open = service();
    await expect(
      open.createIntent(actor(studentId), workspaceId, assignmentId, {
        originalName: 'notes.exe',
        contentType: 'application/octet-stream',
        byteSize: 64,
        idempotencyKey: 'intent-key-type',
      }),
    ).rejects.toMatchObject({ status: 422, code: 'ASSIGNMENT_FILE_TYPE_REJECTED' });
    await expect(
      open.createIntent(actor(studentId), workspaceId, assignmentId, {
        originalName: 'huge.jpg',
        contentType: 'image/jpeg',
        byteSize: 11 * 1024 * 1024,
        idempotencyKey: 'intent-key-size',
      }),
    ).rejects.toMatchObject({ status: 422, code: 'ASSIGNMENT_FILE_TOO_LARGE' });

    const outsiders = createAssignmentFileService({
      platform: {
        workspace: async () => {
          throw new NuniError(403, 'CLASS_WORKSPACE_FORBIDDEN');
        },
        assignment: async () => assignment(),
        submitText: async () => {
          throw new NuniError(403, 'CLASS_WORKSPACE_FORBIDDEN');
        },
      },
      secret,
    });
    await expect(
      outsiders.createIntent(actor(outsiderId), workspaceId, assignmentId, {
        originalName: 'shot.jpg',
        contentType: 'image/jpeg',
        byteSize: 64,
        idempotencyKey: 'intent-key-outsider',
      }),
    ).rejects.toMatchObject({ status: 403, code: 'CLASS_WORKSPACE_FORBIDDEN' });
  });

  it('accepts a late file while the assignment is still open and records 遲交', async () => {
    const api = service();
    const intent = await api.createIntent(actor(studentId), workspaceId, assignmentId, {
      originalName: 'shot.jpg',
      contentType: 'image/jpeg',
      byteSize: 64,
      idempotencyKey: 'intent-key-late-1',
    });
    await api.putContent(actor(studentId), workspaceId, assignmentId, intent.id, jpeg());
    const result = await api.submitFiles(actor(studentId), workspaceId, assignmentId, {
      fileIds: [intent.id],
      idempotencyKey: 'submit-key-late-1',
    });
    expect(result.mySubmission?.late).toBe(true);
    expect(result.mySubmission?.files?.[0]?.originalName).toBe('shot.jpg');
    expect(result.mySubmission?.body).toBe(FILE_ONLY_SUBMISSION_BODY);
  });

  it('replays the same idempotency key without creating a second submission', async () => {
    const submit = vi.fn<AssignmentFilePlatform['submitText']>(
      async (_actor, _w, _a, body) =>
        assignment({
          submissionCount: 1,
          mySubmission: {
            assignmentId,
            platformAccountId: studentId,
            displayName: '同學',
            body,
            state: 'submitted',
            submittedAt: '2026-10-21T13:00:00.000Z',
            teacherFeedback: null,
            reviewedAt: null,
          },
        }),
    );
    const api = service({ submit });
    const intent = await api.createIntent(actor(studentId), workspaceId, assignmentId, {
      originalName: 'shot.jpg',
      contentType: 'image/jpeg',
      byteSize: 64,
      idempotencyKey: 'intent-key-idem-1',
    });
    expect(
      await api.createIntent(actor(studentId), workspaceId, assignmentId, {
        originalName: 'shot.jpg',
        contentType: 'image/jpeg',
        byteSize: 64,
        idempotencyKey: 'intent-key-idem-1',
      }),
    ).toEqual(intent);
    await api.putContent(actor(studentId), workspaceId, assignmentId, intent.id, jpeg());
    const first = await api.submitFiles(actor(studentId), workspaceId, assignmentId, {
      fileIds: [intent.id],
      idempotencyKey: 'submit-key-idem-1',
    });
    const second = await api.submitFiles(actor(studentId), workspaceId, assignmentId, {
      fileIds: [intent.id],
      idempotencyKey: 'submit-key-idem-1',
    });
    expect(second).toEqual(first);
    expect(submit).toHaveBeenCalledTimes(1);
    await expect(
      api.submitFiles(actor(studentId), workspaceId, assignmentId, {
        body: 'another payload',
        fileIds: [intent.id],
        idempotencyKey: 'submit-key-idem-1',
      }),
    ).rejects.toMatchObject({ status: 409, code: 'IDEMPOTENCY_CONFLICT' });
  });

  it('lets a teacher read class files and hides them from another student', async () => {
    const api = service();
    const intent = await api.createIntent(actor(studentId), workspaceId, assignmentId, {
      originalName: 'shot.jpg',
      contentType: 'image/jpeg',
      byteSize: 64,
      idempotencyKey: 'intent-key-read-1',
    });
    await api.putContent(actor(studentId), workspaceId, assignmentId, intent.id, jpeg());
    const submitted = await api.submitFiles(actor(studentId), workspaceId, assignmentId, {
      fileIds: [intent.id],
      idempotencyKey: 'submit-key-read-1',
    });
    const teacherView = await api.hydrateSubmission(
      actor(teacherId),
      workspace('owner-teacher'),
      assignment(),
      submitted.mySubmission,
      teacherId,
    );
    expect(teacherView?.files?.[0]?.originalName).toBe('shot.jpg');
    await expect(
      api.hydrateSubmission(
        actor(outsiderId),
        workspace('student'),
        assignment(),
        submitted.mySubmission,
        outsiderId,
      ),
    ).rejects.toMatchObject({ status: 403, code: 'CLASS_WORKSPACE_FORBIDDEN' });
  });

  it('lets intent, PUT and submit succeed across different service instances sharing durable stores', async () => {
    const stores = {
      index: createSqlIndexStore(createFakeAssignmentFileSql()),
      blobs: createTtlMemoryBlobStore(),
    };
    const student = actor(studentId);
    const intentApi = createAssignmentFileService({
      stores,
      platform: platform(),
      secret,
      now: () => new Date('2026-10-21T13:00:00.000Z'),
      id: () => 'bbbbbbbb-1111-4111-8111-111111111111',
    });
    const putApi = createAssignmentFileService({
      stores,
      platform: platform(),
      secret,
      now: () => new Date('2026-10-21T13:00:00.000Z'),
    });
    const created = await intentApi.createIntent(student, workspaceId, assignmentId, {
      originalName: 'shot.jpg',
      contentType: 'image/jpeg',
      byteSize: 64,
      idempotencyKey: 'intent-key-multi-1',
    });
    await putApi.putContent(student, workspaceId, assignmentId, created.id, jpeg());
    const submitApi = createAssignmentFileService({
      stores,
      platform: platform(),
      secret,
      now: () => new Date('2026-10-21T13:00:00.000Z'),
    });
    const result = await submitApi.submitFiles(student, workspaceId, assignmentId, {
      fileIds: [created.id],
      idempotencyKey: 'submit-key-multi-1',
    });
    expect(result.mySubmission?.files?.[0]?.originalName).toBe('shot.jpg');
    const hydrated = await submitApi.hydrateSubmission(
      student,
      workspace('student'),
      assignment({
        submissionCount: 1,
        mySubmission: result.mySubmission,
      }),
      result.mySubmission,
      studentId,
    );
    expect(hydrated?.files?.[0]?.originalName).toBe('shot.jpg');
  });

  it('rejects PNG bytes sent as a jpg, a renamed MP4 HEIC, path traversal, and an expired signature', async () => {
    const api = service();
    const student = actor(studentId);
    await expect(
      api.createIntent(student, workspaceId, assignmentId, {
        originalName: '../secret.jpg',
        contentType: 'image/jpeg',
        byteSize: 8,
        idempotencyKey: 'intent-key-path',
      }),
    ).rejects.toMatchObject({ status: 422, code: 'ASSIGNMENT_FILE_NAME_INVALID' });

    const pngIntent = await api.createIntent(student, workspaceId, assignmentId, {
      originalName: 'shot.jpg',
      contentType: 'image/jpeg',
      byteSize: 8,
      idempotencyKey: 'intent-key-png-jpg',
    });
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    await expect(
      api.putContent(student, workspaceId, assignmentId, pngIntent.id, png),
    ).rejects.toMatchObject({ status: 422, code: 'ASSIGNMENT_FILE_TYPE_REJECTED' });

    const heicIntent = await api.createIntent(student, workspaceId, assignmentId, {
      originalName: 'clip.heic',
      contentType: 'image/heic',
      byteSize: 12,
      idempotencyKey: 'intent-key-fake-heic',
    });
    const mp4 = Uint8Array.from([0x00, 0x00, 0x00, 0x0c, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
    await expect(
      api.putContent(student, workspaceId, assignmentId, heicIntent.id, mp4),
    ).rejects.toMatchObject({ status: 422, code: 'ASSIGNMENT_FILE_TYPE_REJECTED' });

    const lateNow = { current: Date.parse('2026-10-21T13:00:00.000Z') };
    const timed = createAssignmentFileService({
      platform: platform(),
      secret,
      now: () => new Date(lateNow.current),
      id: () => 'cccccccc-1111-4111-8111-111111111111',
    });
    const intent = await timed.createIntent(student, workspaceId, assignmentId, {
      originalName: 'shot.jpg',
      contentType: 'image/jpeg',
      byteSize: 64,
      idempotencyKey: 'intent-key-expired',
    });
    const uploaded = await timed.putContent(student, workspaceId, assignmentId, intent.id, jpeg());
    lateNow.current += 11 * 60 * 1000;
    await expect(
      timed.readContent(
        workspaceId,
        assignmentId,
        intent.id,
        uploaded.downloadExp,
        uploaded.downloadSig,
      ),
    ).rejects.toMatchObject({ status: 403, code: 'ASSIGNMENT_FILE_EXPIRED' });
  });

  it('does not fake a production upload when Supabase Storage is missing, and writes the file index before text', async () => {
    const student = actor(studentId);
    const stores = {
      index: createMemoryIndexStore(),
      blobs: resolveAssignmentFileStores({ NODE_ENV: 'production' }).blobs,
    };
    const production = createAssignmentFileService({
      stores,
      platform: platform(),
      secret,
      now: () => new Date('2026-10-21T13:00:00.000Z'),
      id: () => 'dddddddd-1111-4111-8111-111111111111',
    });
    const intent = await production.createIntent(student, workspaceId, assignmentId, {
      originalName: 'shot.jpg',
      contentType: 'image/jpeg',
      byteSize: 64,
      idempotencyKey: 'intent-key-prod-blob',
    });
    await expect(
      production.putContent(student, workspaceId, assignmentId, intent.id, jpeg()),
    ).rejects.toMatchObject({ status: 503, code: 'ASSIGNMENT_FILE_UPLOAD_UNAVAILABLE' });
    expect(await stores.index.getFile(intent.id)).toMatchObject({ uploadedAt: null });

    const failingIndex = createMemoryIndexStore();
    const originalPut = failingIndex.putFile.bind(failingIndex);
    failingIndex.putFile = async (record) => {
      if (record.submittedAt) throw new Error('index down');
      await originalPut(record);
    };
    const submit = vi.fn();
    const api = createAssignmentFileService({
      stores: { index: failingIndex, blobs: createTtlMemoryBlobStore() },
      platform: platform({ submit }),
      secret,
      now: () => new Date('2026-10-21T13:00:00.000Z'),
      id: () => 'eeeeeeee-1111-4111-8111-111111111111',
    });
    const created = await api.createIntent(student, workspaceId, assignmentId, {
      originalName: 'shot.jpg',
      contentType: 'image/jpeg',
      byteSize: 64,
      idempotencyKey: 'intent-key-index-fail',
    });
    await api.putContent(student, workspaceId, assignmentId, created.id, jpeg());
    await expect(
      api.submitFiles(student, workspaceId, assignmentId, {
        fileIds: [created.id],
        idempotencyKey: 'submit-key-index-fail',
      }),
    ).rejects.toMatchObject({ status: 503, code: 'ASSIGNMENT_FILE_STORE_UNAVAILABLE' });
    expect(submit).not.toHaveBeenCalled();

    const hydrated = await api.hydrateSubmission(
      student,
      workspace('student'),
      assignment(),
      {
        assignmentId,
        platformAccountId: studentId,
        displayName: '同學',
        body: FILE_ONLY_SUBMISSION_BODY,
        state: 'submitted',
        submittedAt: '2026-10-21T13:00:00.000Z',
        teacherFeedback: null,
        reviewedAt: null,
      },
      studentId,
    );
    expect(hydrated).not.toBeNull();
    expect(hydrated?.body).toBe(FILE_ONLY_SUBMISSION_BODY);
    expect(hydrated?.files).toEqual([]);
  });

  it('creates a batch of intents sequentially so the file budget cannot race', async () => {
    const api = service();
    const student = actor(studentId);
    const intents = await api.createIntents(
      student,
      workspaceId,
      assignmentId,
      Array.from({ length: 8 }, (_, index) => ({
        originalName: `shot-${index}.jpg`,
        contentType: 'image/jpeg',
        byteSize: 64,
        idempotencyKey: `intent-batch-${index}-unique`,
      })),
    );
    expect(intents).toHaveLength(8);
    expect(intents.map((item) => item.originalName)).toEqual(
      Array.from({ length: 8 }, (_, index) => `shot-${index}.jpg`),
    );
    await expect(
      api.createIntent(student, workspaceId, assignmentId, {
        originalName: 'overflow.jpg',
        contentType: 'image/jpeg',
        byteSize: 64,
        idempotencyKey: 'intent-batch-overflow-1',
      }),
    ).rejects.toMatchObject({ status: 422, code: 'ASSIGNMENT_FILE_LIMIT' });
  });

  it('counts unuploaded staged intents toward the budget until they expire', async () => {
    const clock = { current: Date.parse('2026-10-21T13:00:00.000Z') };
    const api = service({ now: () => new Date(clock.current) });
    const student = actor(studentId);
    for (let index = 0; index < 8; index += 1) {
      await api.createIntent(student, workspaceId, assignmentId, {
        originalName: `pending-${index}.jpg`,
        contentType: 'image/jpeg',
        byteSize: 64,
        idempotencyKey: `intent-pending-${index}`,
      });
    }
    await expect(
      api.createIntent(student, workspaceId, assignmentId, {
        originalName: 'ninth.jpg',
        contentType: 'image/jpeg',
        byteSize: 64,
        idempotencyKey: 'intent-pending-ninth',
      }),
    ).rejects.toMatchObject({ status: 422, code: 'ASSIGNMENT_FILE_LIMIT' });
    clock.current += 30 * 60 * 1000 + 1;
    await expect(
      api.createIntent(student, workspaceId, assignmentId, {
        originalName: 'after-ttl.jpg',
        contentType: 'image/jpeg',
        byteSize: 64,
        idempotencyKey: 'intent-pending-after-ttl',
      }),
    ).resolves.toMatchObject({ originalName: 'after-ttl.jpg' });
  });

  it('keeps the first idempotent payload when a later write races', async () => {
    const index = createMemoryIndexStore();
    await index.putIdempotency(studentId, 'first-wins', { hash: 'h1', payload: { winner: 1 } });
    await index.putIdempotency(studentId, 'first-wins', { hash: 'h2', payload: { winner: 2 } });
    expect(await index.getIdempotency(studentId, 'first-wins')).toEqual({
      hash: 'h1',
      payload: { winner: 1 },
    });

    const sql = createSqlIndexStore(createFakeAssignmentFileSql());
    await sql.putIdempotency(studentId, 'first-wins', { hash: 'h1', payload: { winner: 1 } });
    await sql.putIdempotency(studentId, 'first-wins', { hash: 'h2', payload: { winner: 2 } });
    expect(await sql.getIdempotency(studentId, 'first-wins')).toEqual({
      hash: 'h1',
      payload: { winner: 1 },
    });

    const api = service();
    const student = actor(studentId);
    const first = await api.createIntent(student, workspaceId, assignmentId, {
      originalName: 'first.jpg',
      contentType: 'image/jpeg',
      byteSize: 64,
      idempotencyKey: 'intent-first-wins',
    });
    await expect(
      api.createIntent(student, workspaceId, assignmentId, {
        originalName: 'second.jpg',
        contentType: 'image/jpeg',
        byteSize: 64,
        idempotencyKey: 'intent-first-wins',
      }),
    ).rejects.toMatchObject({ status: 409, code: 'IDEMPOTENCY_CONFLICT' });
    expect(
      await api.createIntent(student, workspaceId, assignmentId, {
        originalName: 'first.jpg',
        contentType: 'image/jpeg',
        byteSize: 64,
        idempotencyKey: 'intent-first-wins',
      }),
    ).toEqual(first);
  });

  it('treats a dueAt without offset as Taipei time when marking 遲交', async () => {
    const api = service({
      item: assignment({ dueAt: '2026-10-21T20:59:00' }),
      now: () => new Date('2026-10-21T13:00:00.000Z'),
    });
    const student = actor(studentId);
    const intent = await api.createIntent(student, workspaceId, assignmentId, {
      originalName: 'shot.jpg',
      contentType: 'image/jpeg',
      byteSize: 64,
      idempotencyKey: 'intent-naive-due',
    });
    await api.putContent(student, workspaceId, assignmentId, intent.id, jpeg());
    const result = await api.submitFiles(student, workspaceId, assignmentId, {
      fileIds: [intent.id],
      idempotencyKey: 'submit-naive-due',
    });
    expect(result.mySubmission?.late).toBe(true);
  });
});

it.each(['memory', 'sql'] as const)(
  'withdraws a receipt, blocks its links and accepts a new submission (%s)',
  async (storage) => {
    let current = assignment({ dueAt: '2026-10-22T12:00:00.000Z' });
    let clock = new Date('2026-10-21T10:00:00.000Z');
    const index =
      storage === 'sql'
        ? createSqlIndexStore(createFakeAssignmentFileSql())
        : createMemoryIndexStore();
    const api = createAssignmentFileService({
      stores: { index, blobs: createTtlMemoryBlobStore() },
      secret,
      now: () => clock,
      platform: {
        workspace: async () => workspace('student'),
        assignment: async () => current,
        submitText: async (_actor, _workspace, _assignment, body) => {
          current = assignment({
            ...current,
            submissionCount: 1,
            mySubmission: {
              assignmentId,
              platformAccountId: studentId,
              displayName: '同學',
              body,
              state: 'submitted',
              submittedAt: clock.toISOString(),
              teacherFeedback: null,
              reviewedAt: null,
            },
          });
          return current;
        },
      },
    });
    const student = actor(studentId);
    const intent = await api.createIntent(student, workspaceId, assignmentId, {
      originalName: '報告.jpg',
      contentType: 'image/jpeg',
      byteSize: 64,
      idempotencyKey: 'withdraw-intent-key',
    });
    await api.putContent(student, workspaceId, assignmentId, intent.id, jpeg());
    const submitted = await api.submitFiles(student, workspaceId, assignmentId, {
      fileIds: [intent.id],
      idempotencyKey: 'withdraw-submit-key',
    });
    const file = submitted.mySubmission!.files![0];
    const input = {
      submittedAt: submitted.mySubmission!.submittedAt,
      idempotencyKey: 'withdraw-receipt-key',
    };
    await expect(
      api.withdrawSubmission(student, workspaceId, assignmentId, {
        ...input,
        submittedAt: '2026-10-20T00:00:00.000Z',
      }),
    ).rejects.toMatchObject({ code: 'ASSIGNMENT_SUBMISSION_CHANGED' });
    expect(
      (await api.withdrawSubmission(student, workspaceId, assignmentId, input)).mySubmission,
    ).toBeNull();
    expect(
      (await api.withdrawSubmission(student, workspaceId, assignmentId, input)).mySubmission,
    ).toBeNull();
    expect(
      await api.hydrateSubmission(
        student,
        workspace('student'),
        current,
        current.mySubmission,
        studentId,
      ),
    ).toBeNull();
    expect(
      await api.hydrateSubmission(
        actor(teacherId),
        workspace('co-teacher'),
        current,
        current.mySubmission,
        teacherId,
      ),
    ).toBeNull();
    await expect(
      api.readContent(workspaceId, assignmentId, file.id, file.downloadExp, file.downloadSig),
    ).rejects.toMatchObject({ status: 404 });
    clock = new Date('2026-10-21T11:00:00.000Z');
    const revised = await api.submitFiles(student, workspaceId, assignmentId, {
      body: '改交文字說明',
      fileIds: [],
      idempotencyKey: 'resubmit-text-key',
    });
    expect(revised.mySubmission?.files).toEqual([]);
    expect(await index.listVisible(assignmentId, studentId)).toEqual([]);
    expect(
      (
        await api.hydrateSubmission(
          student,
          workspace('student'),
          current,
          current.mySubmission,
          studentId,
        )
      )?.body,
    ).toBe('改交文字說明');
    clock = new Date('2026-10-23T00:00:00.000Z');
    await expect(
      api.submitFiles(student, workspaceId, assignmentId, {
        body: '截止後修改',
        fileIds: [],
        idempotencyKey: 'late-revision-key',
      }),
    ).rejects.toMatchObject({ code: 'ASSIGNMENT_REVISION_CLOSED' });
    await expect(
      api.withdrawSubmission(student, workspaceId, assignmentId, {
        submittedAt: revised.mySubmission!.submittedAt,
        idempotencyKey: 'late-withdraw-key',
      }),
    ).rejects.toMatchObject({ code: 'ASSIGNMENT_REVISION_CLOSED' });
  },
);

it('rejects another student reading a receipt and a teacher withdrawing one', async () => {
  const receipt = (
    await platform().submitText(actor(studentId), workspaceId, assignmentId, '內容', 'receipt-key')
  ).mySubmission!;
  await expect(
    service().hydrateSubmission(
      actor(outsiderId),
      workspace('student'),
      assignment(),
      receipt,
      outsiderId,
    ),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    service({ role: 'co-teacher' }).withdrawSubmission(
      actor(teacherId),
      workspaceId,
      assignmentId,
      { submittedAt: receipt.submittedAt, idempotencyKey: 'teacher-withdraw-key' },
    ),
  ).rejects.toMatchObject({ status: 403 });
});

it('restores the previous file receipt after a failed revision and replaces it on retry', async () => {
  let current = assignment({ dueAt: '2099-10-31T12:00:00Z' });
  let fail = false;
  let tick = 0;
  const index = createMemoryIndexStore();
  const api = createAssignmentFileService({
    secret, stores: { index, blobs: createTtlMemoryBlobStore() },
    now: () => new Date(Date.parse('2026-10-21T10:00:00Z') + tick),
    platform: {
      workspace: async () => workspace('student'), assignment: async () => current,
      submitText: async (_actor, _workspace, _assignment, body) => {
        if (fail) throw new NuniError(503, 'REQUEST_FAILED');
        current = { ...current, submissionCount: 1, mySubmission: {
          assignmentId, platformAccountId: studentId, displayName: '同學', body,
          state: 'submitted', submittedAt: new Date(Date.parse('2026-10-21T10:00:00Z') + tick).toISOString(),
          teacherFeedback: null, reviewedAt: null,
        } };
        return current;
      },
    },
  });
  const student = actor(studentId);
  async function upload(key: string) {
    const file = await api.createIntent(student, workspaceId, assignmentId, {
      originalName: `${key}.jpg`, contentType: 'image/jpeg', byteSize: 64, idempotencyKey: `${key}-intent-key`,
    });
    await api.putContent(student, workspaceId, assignmentId, file.id, jpeg());
    return file.id;
  }
  const original = await upload('original');
  const first = await api.submitFiles(student, workspaceId, assignmentId, { fileIds: [original], idempotencyKey: 'original-submit-key' });
  tick += 1000;
  fail = true;
  await expect(api.submitFiles(student, workspaceId, assignmentId, { fileIds: [original], idempotencyKey: 'revision-failure-key' })).rejects.toMatchObject({ status: 503 });
  expect((await index.getFile(original))?.submittedAt).toBe(first.mySubmission!.submittedAt);
  const replacement = await upload('replacement');
  await expect(api.submitFiles(student, workspaceId, assignmentId, { fileIds: [replacement], idempotencyKey: 'replace-submit-key' })).rejects.toMatchObject({ status: 503 });
  expect((await index.listVisible(assignmentId, studentId)).map(file => file.id)).toEqual([original]);
  expect((await index.getFile(replacement))?.submittedAt).toBeNull();
  fail = false;
  const revised = await api.submitFiles(student, workspaceId, assignmentId, { fileIds: [replacement], idempotencyKey: 'replace-submit-key' });
  expect(revised.mySubmission!.files!.map(file => file.id)).toEqual([replacement]);
  const old = first.mySubmission!.files![0];
  await expect(api.readContent(workspaceId, assignmentId, old.id, old.downloadExp, old.downloadSig)).rejects.toMatchObject({ status: 404 });
});

it.each(['memory', 'sql'] as const)('recovers confirmed attachment alignment after the deadline across service restarts (%s)', async mode => {
  const index = mode === 'sql' ? createSqlIndexStore(createFakeAssignmentFileSql()) : createMemoryIndexStore();
  const stores = { index, blobs: createTtlMemoryBlobStore() };
  let clock = new Date('2026-10-21T11:59:58.000Z');
  let current = assignment();
  const submit = vi.fn(async (_actor, _workspace, _assignment, body: string) => {
    current = assignment({ submissionCount: 1, mySubmission: {
      assignmentId, platformAccountId: studentId, displayName: '同學', body,
      state: 'submitted', submittedAt: '2026-10-21T11:59:59.000Z', teacherFeedback: null, reviewedAt: null,
    } });
    return current;
  });
  const upstream = { ...platform({ submit }), assignment: async () => current };
  const make = () => createAssignmentFileService({ secret, stores, platform: upstream, now: () => clock });
  let api = make();
  const student = actor(studentId);
  const intent = await api.createIntent(student, workspaceId, assignmentId, {
    originalName: 'shot.jpg', contentType: 'image/jpeg', byteSize: 64, idempotencyKey: 'recover-intent',
  });
  await api.putContent(student, workspaceId, assignmentId, intent.id, jpeg());
  const put = index.putFile.bind(index);
  let unavailable = true;
  index.putFile = async record => {
    if (unavailable && record.submittedAt === '2026-10-21T11:59:59.000Z') throw new Error('alignment unavailable');
    return put(record);
  };
  const input = { body: '原操作', fileIds: [intent.id], idempotencyKey: 'recover-submit' };
  await expect(api.submitFiles(student, workspaceId, assignmentId, input)).rejects.toMatchObject({ status: 503 });
  await expect(api.hydrateSubmission(student, workspace('student'), current, current.mySubmission, studentId))
    .rejects.toMatchObject({ status: 503 });
  clock = new Date('2026-10-21T12:00:00.001Z');
  unavailable = false;
  api = make();
  await expect(api.submitFiles(student, workspaceId, assignmentId, { ...input, body: '修改原操作' }))
    .rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  await expect(api.submitFiles(student, workspaceId, assignmentId, { ...input, idempotencyKey: 'new-operation' }))
    .rejects.toMatchObject({ code: 'ASSIGNMENT_REVISION_CLOSED' });
  const receipt = await api.submitFiles(student, workspaceId, assignmentId, input);
  expect(submit).toHaveBeenCalledTimes(1);
  expect(receipt.mySubmission?.files?.map(file => file.id)).toEqual([intent.id]);
  const hydrated = await api.hydrateSubmission(student, workspace('student'), receipt, receipt.mySubmission, studentId);
  expect(hydrated?.files?.map(file => file.id)).toEqual([intent.id]);
  expect((await index.getFile(intent.id))?.submittedAt).toBe(receipt.mySubmission?.submittedAt);
});

it('uses visible counts for successive withdrawals and a submission by another student', async () => {
  const index = createMemoryIndexStore();
  const stores = { index, blobs: createTtlMemoryBlobStore() };
  const submittedAt = '2026-10-21T11:00:00.000Z';
  const make = (accountId: string) => createAssignmentFileService({ secret, stores,
    now: () => new Date('2026-10-21T11:30:00.000Z'),
    platform: platform({ item: assignment({ submissionCount: 2, mySubmission: {
      assignmentId, platformAccountId: accountId, displayName: '同學', body: '作業', state: 'submitted',
      submittedAt, teacherFeedback: null, reviewedAt: null,
    } }), submit: async () => assignment({ submissionCount: 3 }) }),
  });
  const first = await make(studentId).withdrawSubmission(actor(studentId), workspaceId, assignmentId,
    { submittedAt, idempotencyKey: 'count-withdraw-first' });
  expect(first.submissionCount).toBe(1);
  const secondApi = make(outsiderId);
  const second = await secondApi.withdrawSubmission(actor(outsiderId), workspaceId, assignmentId,
    { submittedAt, idempotencyKey: 'count-withdraw-second' });
  expect(second.submissionCount).toBe(0);
  expect(second.submissionCount).toBe(await secondApi.visibleSubmissionCount(assignment({ submissionCount: 2 })));
  const third = await make(teacherId).submitFiles(actor(teacherId), workspaceId, assignmentId,
    { body: '新繳交', fileIds: [], idempotencyKey: 'count-submit-third' });
  expect(third.submissionCount).toBe(1);
});

it.each(
  ['memory', 'sql'].flatMap((mode) =>
    [false, true].flatMap((withFiles) =>
      [false, true].map((afterDeadline) => ({ mode, withFiles, afterDeadline })),
    ),
  ),
)(
  'rejects replaced recovery $mode files=$withFiles deadline=$afterDeadline',
  async ({ mode, withFiles, afterDeadline }) => {
    const index =
      mode === 'sql'
        ? createSqlIndexStore(createFakeAssignmentFileSql())
        : createMemoryIndexStore();
    const stores = { index, blobs: createTtlMemoryBlobStore() };
    let clock = new Date('2026-10-21T11:59:58.000Z');
    let current = assignment();
    const submit = vi.fn(async (_actor, _workspace, _assignment, body: string) => {
      current = assignment({
        submissionCount: 1,
        mySubmission: {
          assignmentId,
          platformAccountId: studentId,
          displayName: '同學',
          body,
          state: 'submitted',
          submittedAt: new Date(clock.getTime() + 100).toISOString(),
          teacherFeedback: null,
          reviewedAt: null,
        },
      });
      return current;
    });
    const upstream = { ...platform({ submit }), assignment: async () => current };
    const make = () =>
      createAssignmentFileService({ secret, stores, platform: upstream, now: () => clock });
    let api = make();
    const student = actor(studentId);
    const intent = await api.createIntent(student, workspaceId, assignmentId, {
      originalName: 'shot.jpg',
      contentType: 'image/jpeg',
      byteSize: 64,
      idempotencyKey: 'recover-intent',
    });
    const oldDownload = await api.putContent(student, workspaceId, assignmentId, intent.id, jpeg());
    const put = index.putFile.bind(index);
    let unavailable = true;
    index.putFile = async (record) => {
      if (unavailable && record.submittedAt === '2026-10-21T11:59:58.100Z')
        throw new Error('alignment unavailable');
      return put(record);
    };
    const input = { body: '原操作', fileIds: [intent.id], idempotencyKey: 'recover-submit' };
    await expect(api.submitFiles(student, workspaceId, assignmentId, input)).rejects.toMatchObject({
      status: 503,
    });
    await expect(
      api.hydrateSubmission(
        student,
        workspace('student'),
        current,
        current.mySubmission,
        studentId,
      ),
    ).rejects.toMatchObject({ status: 503 });
    unavailable = false;
    clock = new Date('2026-10-21T11:59:59.000Z');
    const replacement = await api.createIntent(student, workspaceId, assignmentId, {
      originalName: 'new.jpg',
      contentType: 'image/jpeg',
      byteSize: 64,
      idempotencyKey: 'new-intent',
    });
    await api.putContent(student, workspaceId, assignmentId, replacement.id, jpeg());
    const receipt = await api.submitFiles(student, workspaceId, assignmentId, {
      body: 'new B',
      fileIds: withFiles ? [replacement.id] : [],
      idempotencyKey: 'new-submit',
    });
    const before = await index.getFile(intent.id);
    const newerBefore = await index.getFile(replacement.id);
    if (afterDeadline) clock = new Date('2026-10-21T12:00:00.001Z');
    api = make();
    await expect(api.submitFiles(student, workspaceId, assignmentId, input)).rejects.toMatchObject({
      status: 409,
      code: 'ASSIGNMENT_SUBMISSION_SUPERSEDED',
    });
    expect(await index.getFile(intent.id)).toEqual(before);
    expect(await index.getFile(replacement.id)).toEqual(newerBefore);
    expect(current.mySubmission?.body).toBe('new B');
    expect(submit).toHaveBeenCalledTimes(2);
    const hydrated = await api.hydrateSubmission(
      student,
      workspace('student'),
      current,
      current.mySubmission,
      studentId,
    );
    expect(hydrated?.files?.map((file) => file.id)).toEqual(withFiles ? [replacement.id] : []);
    await expect(
      api.readContent(
        workspaceId,
        assignmentId,
        intent.id,
        oldDownload.downloadExp!,
        oldDownload.downloadSig!,
      ),
    ).rejects.toMatchObject({ status: 404 });
    // A stale index row must not make a replaced version downloadable.
    await index.putFile({ ...before!, supersededAt: null });
    await expect(api.readContent(workspaceId, assignmentId, intent.id, oldDownload.downloadExp!, oldDownload.downloadSig!))
      .rejects.toMatchObject({ status: 404 });
    expect(receipt.mySubmission?.body).toBe('new B');
  },
);

it.each(['memory', 'sql'] as const)('fences stale alignment and rollback writes after a newer version (%s)', async mode => {
  const index = mode === 'sql' ? createSqlIndexStore(createFakeAssignmentFileSql()) : createMemoryIndexStore();
  const api = createAssignmentFileService({ secret, stores: { index, blobs: createTtlMemoryBlobStore() }, platform: platform(), now: () => new Date('2026-10-21T11:00:00Z') });
  const intent = await api.createIntent(actor(studentId), workspaceId, assignmentId, {
    originalName: 'old.jpg', contentType: 'image/jpeg', byteSize: 64, idempotencyKey: 'fenced-intent',
  });
  const original = (await index.getFile(intent.id))!;
  const oldVersion = '2026-10-21T11:00:01.000Z';
  const newVersion = '2026-10-21T11:00:02.000Z';
  await index.advanceVersion(assignmentId, studentId, oldVersion);
  await index.advanceVersion(assignmentId, studentId, newVersion);
  await index.advanceVersion(assignmentId, studentId, oldVersion);
  expect(await index.currentVersion(assignmentId, studentId)).toBe(newVersion);
  await expect(index.putFile({ ...original, submittedAt: oldVersion, supersededAt: null }, oldVersion))
    .rejects.toMatchObject({ code: 'ASSIGNMENT_SUBMISSION_SUPERSEDED' });
  await expect(index.putFile(original, oldVersion)).rejects.toMatchObject({ code: 'ASSIGNMENT_SUBMISSION_SUPERSEDED' });
  expect(await index.getFile(intent.id)).toEqual(original);
});

it('recovers an upstream confirmation whose first persistence failed', async () => {
  const index = createMemoryIndexStore();
  let current = assignment();
  let written = false;
  const submit = vi.fn(async (_actor, _workspace, _assignment, body: string) => {
    if (!written) {
      written = true;
      current = assignment({ submissionCount: 1, mySubmission: {
        assignmentId, platformAccountId: studentId, displayName: '同學', body,
        state: 'submitted', submittedAt: '2026-10-21T11:00:01.000Z', teacherFeedback: null, reviewedAt: null,
      } });
    }
    return current;
  });
  const remember = index.putIdempotency.bind(index);
  let fail = true;
  index.putIdempotency = async (actorId, key, row) => {
    if (key.startsWith('submit-confirmation:') && fail) {
      fail = false;
      throw new NuniError(503, 'ASSIGNMENT_FILE_STORE_UNAVAILABLE');
    }
    return remember(actorId, key, row);
  };
  let clock = new Date('2026-10-21T11:00:00Z');
  const api = createAssignmentFileService({ secret, stores: { index, blobs: createTtlMemoryBlobStore() },
    platform: { ...platform({ submit }), assignment: async () => current }, now: () => clock });
  const input = { body: '原操作', fileIds: [], idempotencyKey: 'confirmation-persist-retry' };
  await expect(api.submitFiles(actor(studentId), workspaceId, assignmentId, input)).rejects.toMatchObject({ status: 503 });
  clock = new Date('2026-10-21T12:01:00Z');
  const result = await api.submitFiles(actor(studentId), workspaceId, assignmentId, input);
  expect(result.mySubmission?.body).toBe('原操作');
  expect(submit).toHaveBeenNthCalledWith(2, expect.anything(), workspaceId, assignmentId, '原操作', 'confirmation-persist-retry:text');
});

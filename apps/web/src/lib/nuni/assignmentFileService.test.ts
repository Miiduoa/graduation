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
afterEach(() => resetAssignmentFileStores());

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
    const teacherView = api.hydrateSubmission(
      actor(teacherId),
      workspace('owner-teacher'),
      assignment(),
      submitted.mySubmission,
      teacherId,
    );
    expect(teacherView?.files?.[0]?.originalName).toBe('shot.jpg');
    expect(() =>
      api.hydrateSubmission(
        actor(outsiderId),
        workspace('student'),
        assignment(),
        submitted.mySubmission,
        outsiderId,
      ),
    ).toThrowError(/CLASS_WORKSPACE_FORBIDDEN/);
  });
});

import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  ASSIGNMENT_FILE_URL_TTL_MS,
  FILE_ONLY_SUBMISSION_BODY,
  assertAssignmentFileBudget,
  assertAssignmentFileCounts,
  assertAssignmentFileMagic,
  assertAssignmentFileSize,
  assignmentFileIntentCountsTowardQuota,
  assignmentFileSubmitEnabled,
  assignmentSubmissionLate,
  assignmentCanRevise,
  classifyAssignmentFile,
  sanitizeAssignmentFileName,
} from '@campus/shared/src/assignmentFiles';
import {
  NuniError,
  createNuniClasses,
  nuniId,
  type NuniAssignment,
  type NuniRole,
  type NuniSubmission,
  type NuniSubmissionFile,
  type NuniWorkspace,
} from '@campus/shared/src/nuni';
import type { PlatformSession } from './server';
import {
  defaultAssignmentFileStores,
  resetAssignmentFileStores,
  resolveAssignmentFileStores,
  type AssignmentFileRuntimeStores,
  type FileRecord,
  type SqlQuery,
} from './assignmentFileStore';

export type AssignmentFileActor = {
  platformAccountId: string;
  session: PlatformSession;
};

export type AssignmentFileIntent = {
  id: string;
  originalName: string;
  contentType: string;
  byteSize: number;
  kind: FileRecord['kind'];
  uploadPath: string;
};

export type AssignmentFilePlatform = {
  workspace(actor: AssignmentFileActor, workspaceId: string): Promise<NuniWorkspace>;
  assignment(actor: AssignmentFileActor, workspaceId: string, assignmentId: string): Promise<NuniAssignment>;
  submitText(
    actor: AssignmentFileActor,
    workspaceId: string,
    assignmentId: string,
    body: string,
    idempotencyKey: string,
  ): Promise<NuniAssignment>;
};

function nowIso(now: () => Date) {
  return now().toISOString();
}

function fileId(nowId: () => string) {
  return `cwf_${nowId()}`;
}

function sha256(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex');
}

function signingKey(secret: string) {
  return createHash('sha256').update(`assignment-file:${secret}`).digest();
}

function sign(secret: string, parts: string[]) {
  return createHmac('sha256', signingKey(secret)).update(parts.join('|')).digest('base64url');
}

function equal(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function downloadDescriptor(
  file: FileRecord,
  secret: string,
  now: () => Date,
): NuniSubmissionFile {
  const exp = String(now().getTime() + ASSIGNMENT_FILE_URL_TTL_MS);
  const downloadPath = `class-workspaces/${file.workspaceId}/assignments/${file.assignmentId}/files/${file.id}/content`;
  return {
    id: file.id,
    originalName: file.originalName,
    contentType: file.contentType,
    byteSize: file.byteSize,
    kind: file.kind,
    downloadPath,
    downloadExp: exp,
    downloadSig: sign(secret, [downloadPath, exp, file.platformAccountId]),
  };
}

function withFiles(
  assignment: NuniAssignment,
  files: NuniSubmissionFile[],
  late: boolean | undefined,
): NuniAssignment {
  if (!assignment.mySubmission) return assignment;
  return {
    ...assignment,
    mySubmission: {
      ...assignment.mySubmission,
      ...(late !== undefined ? { late } : {}),
      files,
    },
  };
}

function receiptKey(workspaceId: string, assignmentId: string, submittedAt: string) {
  return `submit-receipt:${sha256(Buffer.from(JSON.stringify([workspaceId, assignmentId, new Date(submittedAt).toISOString()])))}`;
}

function teacherRole(role: NuniRole) {
  return role === 'owner-teacher' || role === 'co-teacher';
}

export function createAssignmentFileService(options?: {
  stores?: AssignmentFileRuntimeStores;
  query?: SqlQuery;
  env?: Record<string, string | undefined>;
  platform: AssignmentFilePlatform;
  secret: string;
  now?: () => Date;
  id?: () => string;
}) {
  const env = options?.env ?? process.env;
  const stores =
    options?.stores ??
    (options?.query || env.NODE_ENV === 'production'
      ? resolveAssignmentFileStores(env, options?.query)
      : defaultAssignmentFileStores());
  const now = options?.now ?? (() => new Date());
  const id = options?.id ?? (() => randomUUID());
  if (!options?.secret || !options.platform) throw new NuniError(503, 'CONFIGURATION_REQUIRED');
  const secret = options.secret;
  const platform = options.platform;

  async function requireStudent(actor: AssignmentFileActor, workspaceId: string, assignmentId: string) {
    const [workspace, assignment] = await Promise.all([
      platform.workspace(actor, workspaceId),
      platform.assignment(actor, workspaceId, assignmentId),
    ]);
    if (workspace.memberRole !== 'student') throw new NuniError(403, 'CLASS_WORKSPACE_STUDENT_REQUIRED');
    if (workspace.state !== 'active' || assignment.state !== 'open')
      throw new NuniError(409, 'ASSIGNMENT_CLOSED');
    return { workspace, assignment };
  }

  async function replay(actor: AssignmentFileActor, key: string, hash: string) {
    const row = await stores.index.getIdempotency(actor.platformAccountId, key);
    if (!row) return null;
    if (row.hash !== hash) throw new NuniError(409, 'IDEMPOTENCY_CONFLICT');
    return row.payload;
  }

  async function remember(actor: AssignmentFileActor, key: string, hash: string, payload: unknown) {
    await stores.index.putIdempotency(actor.platformAccountId, key, { hash, payload });
    const stored = await stores.index.getIdempotency(actor.platformAccountId, key);
    if (!stored) throw new NuniError(503, 'ASSIGNMENT_FILE_STORE_UNAVAILABLE');
    if (stored.hash !== hash) throw new NuniError(409, 'IDEMPOTENCY_CONFLICT');
    return stored.payload;
  }

  async function visibleSubmissionCount(assignment: NuniAssignment) {
    return Math.max(0, assignment.submissionCount - await stores.index.countWithdrawn(assignment.id));
  }

  return {
    async createIntent(
      actor: AssignmentFileActor,
      workspaceId: string,
      assignmentId: string,
      input: { originalName: string; contentType: string; byteSize: number; idempotencyKey: string },
    ): Promise<AssignmentFileIntent> {
      const { assignment } = await requireStudent(actor, workspaceId, assignmentId);
      const originalName = sanitizeAssignmentFileName(input.originalName);
      const classified = classifyAssignmentFile(originalName, input.contentType);
      assertAssignmentFileSize(classified.kind, input.byteSize);
      const hash = sha256(
        Buffer.from(
          JSON.stringify({
            workspaceId,
            assignmentId,
            originalName,
            contentType: classified.contentType,
            byteSize: input.byteSize,
          }),
        ),
      );
      const existing = await replay(actor, input.idempotencyKey, hash);
      if (existing) return existing as AssignmentFileIntent;
      const current = (await stores.index.listStaged(assignment.id, actor.platformAccountId)).filter(
        (file) => assignmentFileIntentCountsTowardQuota(file, now().getTime()),
      );
      const nextImages =
        current.filter((file) => file.kind === 'image').length + (classified.kind === 'image' ? 1 : 0);
      const nextDocs =
        current.filter((file) => file.kind === 'file').length + (classified.kind === 'file' ? 1 : 0);
      assertAssignmentFileBudget(nextImages, nextDocs);
      const record: FileRecord = {
        id: fileId(id),
        workspaceId,
        assignmentId,
        platformAccountId: actor.platformAccountId,
        originalName,
        contentType: classified.contentType,
        byteSize: input.byteSize,
        sha256: '',
        kind: classified.kind,
        storageKey: `${workspaceId}/${assignmentId}/${actor.platformAccountId}/${randomUUID()}`,
        createdAt: nowIso(now),
        uploadedAt: null,
        submittedAt: null,
        supersededAt: null,
        late: false,
      };
      await stores.index.putFile(record);
      const payload = {
        id: record.id,
        originalName: record.originalName,
        contentType: record.contentType,
        byteSize: record.byteSize,
        kind: record.kind,
        uploadPath: `class-workspaces/${workspaceId}/assignments/${assignmentId}/files/${record.id}/content`,
      };
      return (await remember(actor, input.idempotencyKey, hash, payload)) as AssignmentFileIntent;
    },

    async createIntents(
      actor: AssignmentFileActor,
      workspaceId: string,
      assignmentId: string,
      files: { originalName: string; contentType: string; byteSize: number; idempotencyKey: string }[],
    ): Promise<AssignmentFileIntent[]> {
      if (files.length < 1 || files.length > 10) throw new NuniError(422, 'INVALID_INPUT');
      const intents: AssignmentFileIntent[] = [];
      for (const file of files) {
        intents.push(await this.createIntent(actor, workspaceId, assignmentId, file));
      }
      return intents;
    },

    async putContent(
      actor: AssignmentFileActor,
      workspaceId: string,
      assignmentId: string,
      fileRecordId: string,
      bytes: Uint8Array,
    ) {
      await requireStudent(actor, workspaceId, assignmentId);
      const record = await stores.index.getFile(fileRecordId);
      if (
        !record ||
        record.workspaceId !== workspaceId ||
        record.assignmentId !== assignmentId ||
        record.platformAccountId !== actor.platformAccountId
      )
        throw new NuniError(404, 'NOT_FOUND');
      if (record.submittedAt) throw new NuniError(409, 'ASSIGNMENT_FILE_ALREADY_SUBMITTED');
      if (bytes.byteLength !== record.byteSize) throw new NuniError(422, 'ASSIGNMENT_FILE_SIZE_REJECTED');
      assertAssignmentFileMagic(record.kind, record.contentType, bytes);
      record.sha256 = sha256(bytes);
      record.uploadedAt = nowIso(now);
      await stores.blobs.put(record.storageKey, bytes, record.contentType);
      const stored = await stores.blobs.get(record.storageKey);
      if (!stored || stored.byteLength !== bytes.byteLength)
        throw new NuniError(503, 'ASSIGNMENT_FILE_UPLOAD_UNAVAILABLE');
      await stores.index.putFile(record);
      return downloadDescriptor(record, secret, now);
    },

    async submitFiles(
      actor: AssignmentFileActor,
      workspaceId: string,
      assignmentId: string,
      input: { body?: string; fileIds: string[]; idempotencyKey: string },
    ): Promise<NuniAssignment> {
      const { assignment } = await requireStudent(actor, workspaceId, assignmentId);
      const fileIds = [...new Set(input.fileIds.map((value) => nuniId(value, 'cwf')))];
      const hash = sha256(Buffer.from(JSON.stringify({ workspaceId, assignmentId, body: input.body ?? '', fileIds })));
      const existing = await replay(actor, input.idempotencyKey, hash);
      if (existing) return existing as NuniAssignment;
      const operationKey = `submit-operation:${sha256(Buffer.from(input.idempotencyKey))}`;
      const confirmationKey = `submit-confirmation:${sha256(Buffer.from(input.idempotencyKey))}`;
      type Operation = {
        assignment: NuniAssignment;
        previous: FileRecord[];
        originals: FileRecord[];
        pending: FileRecord[];
        text: string;
        submittedAt: string;
      };
      const saved = await replay(actor, operationKey, hash) as Operation | null;
      // A saved operation was authorized before its deadline; only new operations need the revision check.
      if (saved) return finish(saved);
      if (assignment.mySubmission && !await stores.index.isWithdrawn(assignmentId, actor.platformAccountId, assignment.mySubmission.submittedAt)
        && !assignmentCanRevise(assignment.dueAt, now().getTime())) throw new NuniError(409, 'ASSIGNMENT_REVISION_CLOSED');
      const records = [];
      for (const value of fileIds) {
        const record = await stores.index.getFile(value);
        if (
          !record ||
          record.workspaceId !== workspaceId ||
          record.assignmentId !== assignmentId ||
          record.platformAccountId !== actor.platformAccountId ||
          !record.uploadedAt || record.supersededAt !== null
        )
          throw new NuniError(422, 'ASSIGNMENT_FILE_REQUIRED');
        records.push(record);
      }
      const images = records.filter((file) => file.kind === 'image').length;
      const documents = records.filter((file) => file.kind === 'file').length;
      const body = (input.body ?? '').trim();
      if (!records.length && !body) throw new NuniError(422, 'ASSIGNMENT_FILE_REQUIRED');
      if (records.length) assertAssignmentFileCounts(images, documents);
      const submittedAt = nowIso(now);
      const text = body || (records.length ? FILE_ONLY_SUBMISSION_BODY : '');
      const previous = await stores.index.listVisible(assignmentId, actor.platformAccountId);
      const snapshots = new Map([...previous, ...records].map(record => [record.id, { ...record }]));
      const pending = records.map((record) => ({
        ...record,
        submittedAt,
        late: assignmentSubmissionLate(assignment.dueAt, submittedAt),
        supersededAt: null,
      }));
      const operation: Operation = { assignment, previous, originals: [...snapshots.values()], pending, text, submittedAt };
      await remember(actor, operationKey, hash, operation);
      return finish(operation);

      async function finish(operation: Operation): Promise<NuniAssignment> {
        const { assignment, previous, originals, pending, text, submittedAt } = operation;
        let confirmed = await replay(actor, confirmationKey, hash) as NuniAssignment | null;
        if (!confirmed) {
          try {
            for (const record of previous) await stores.index.putFile({ ...record, supersededAt: submittedAt });
            for (const record of pending) await stores.index.putFile(record);
            const indexed = await stores.index.listVisible(assignmentId, actor.platformAccountId);
            if (pending.some(record => !indexed.some(file => file.id === record.id)))
              throw new NuniError(503, 'ASSIGNMENT_FILE_STORE_UNAVAILABLE');
          } catch {
            for (const record of originals) await stores.index.putFile(record);
            throw new NuniError(503, 'ASSIGNMENT_FILE_STORE_UNAVAILABLE');
          }
          try {
            confirmed = await platform.submitText(actor, workspaceId, assignmentId, text, `${input.idempotencyKey}:text`);
          } catch (error) {
            for (const record of originals) await stores.index.putFile(record);
            throw error;
          }
        }
        await remember(actor, confirmationKey, hash, confirmed);
        const confirmedAt = confirmed.mySubmission?.submittedAt ?? submittedAt;
        // Persist the expected receipt before alignment so reads fail closed during an incomplete repair.
        await remember(actor, receiptKey(workspaceId, assignmentId, confirmedAt), hash, pending.map(record => record.id));
        try {
          for (const record of previous) await stores.index.putFile({ ...record, supersededAt: confirmedAt });
          for (const record of pending) await stores.index.putFile({
            ...record, submittedAt: confirmedAt,
            late: assignmentSubmissionLate(assignment.dueAt, confirmedAt), supersededAt: null,
          });
        } catch {
          throw new NuniError(503, 'ASSIGNMENT_FILE_STORE_UNAVAILABLE');
        }
        const visible = await stores.index.listVisible(assignmentId, actor.platformAccountId);
        const files = visible.filter(file => pending.some(record => record.id === file.id))
          .map(file => downloadDescriptor(file, secret, now));
        const payload = withFiles({ ...confirmed, submissionCount: await visibleSubmissionCount(confirmed) }, files,
          assignmentSubmissionLate(assignment.dueAt, confirmedAt));
        if (pending.length && (!payload.mySubmission || files.length !== pending.length))
          throw new NuniError(503, 'ASSIGNMENT_FILE_STORE_UNAVAILABLE');
        return await remember(actor, input.idempotencyKey, hash, payload) as NuniAssignment;
      }
    },

    visibleSubmissionCount,

    async withdrawSubmission(
      actor: AssignmentFileActor, workspaceId: string, assignmentId: string,
      input: { submittedAt: string; idempotencyKey: string },
    ): Promise<NuniAssignment> {
      const { assignment } = await requireStudent(actor, workspaceId, assignmentId);
      const hash = sha256(Buffer.from(JSON.stringify({ workspaceId, assignmentId, withdraw: input.submittedAt })));
      const existing = await replay(actor, input.idempotencyKey, hash);
      if (existing) return existing as NuniAssignment;
      if (!assignmentCanRevise(assignment.dueAt, now().getTime())) throw new NuniError(409, 'ASSIGNMENT_REVISION_CLOSED');
      const receipt = assignment.mySubmission;
      if (!receipt || receipt.platformAccountId !== actor.platformAccountId || receipt.submittedAt !== input.submittedAt)
        throw new NuniError(409, 'ASSIGNMENT_SUBMISSION_CHANGED');
      await stores.index.withdraw(assignmentId, actor.platformAccountId, receipt.submittedAt);
      const payload = { ...assignment, mySubmission: null, submissionCount: await visibleSubmissionCount(assignment) };
      return await remember(actor, input.idempotencyKey, hash, payload) as NuniAssignment;
    },

    async hydrateSubmission(
      actor: AssignmentFileActor,
      workspace: NuniWorkspace,
      assignment: NuniAssignment,
      submission: NuniSubmission | null,
      viewerAccountId: string,
    ): Promise<NuniSubmission | null> {
      if (!submission) return submission;
      const canRead =
        submission.platformAccountId === viewerAccountId || teacherRole(workspace.memberRole);
      if (!canRead || viewerAccountId !== actor.platformAccountId) throw new NuniError(403, 'CLASS_WORKSPACE_FORBIDDEN');
      if (await stores.index.isWithdrawn(assignment.id, submission.platformAccountId, submission.submittedAt)) return null;
      const stored = await stores.index.listVisible(assignment.id, submission.platformAccountId);
      const files = stored.filter(file => file.submittedAt !== null && Date.parse(file.submittedAt) === Date.parse(submission.submittedAt)).map((file) => downloadDescriptor(file, secret, now));
      const expected = await stores.index.getIdempotency(submission.platformAccountId,
        receiptKey(assignment.workspaceId, assignment.id, submission.submittedAt));
      if (expected && (expected.payload as string[]).some(fileId => !files.some(file => file.id === fileId)))
        throw new NuniError(503, 'ASSIGNMENT_FILE_STORE_UNAVAILABLE');
      const computedLate =
        assignmentSubmissionLate(assignment.dueAt, submission.submittedAt) ||
        stored.some((file) => file.late);
      const late = submission.late ?? computedLate;
      return { ...submission, late, files };
    },

    async readContent(
      workspaceId: string,
      assignmentId: string,
      fileRecordId: string,
      exp: string,
      sig: string,
    ) {
      const record = await stores.index.getFile(fileRecordId);
      if (
        !record ||
        record.workspaceId !== workspaceId ||
        record.assignmentId !== assignmentId ||
        !record.uploadedAt || record.supersededAt !== null ||
        (record.submittedAt !== null && await stores.index.isWithdrawn(assignmentId, record.platformAccountId, record.submittedAt))
      )
        throw new NuniError(404, 'NOT_FOUND');
      const downloadPath = `class-workspaces/${workspaceId}/assignments/${assignmentId}/files/${fileRecordId}/content`;
      const expected = sign(secret, [downloadPath, exp, record.platformAccountId]);
      if (!equal(expected, sig)) throw new NuniError(403, 'ASSIGNMENT_FILE_SIGNATURE_INVALID');
      if (!/^\d+$/.test(exp) || Number(exp) < now().getTime())
        throw new NuniError(403, 'ASSIGNMENT_FILE_EXPIRED');
      const bytes = await stores.blobs.get(record.storageKey);
      if (!bytes) throw new NuniError(404, 'NOT_FOUND');
      return { bytes, contentType: record.contentType, originalName: record.originalName };
    },
  };
}

export function assignmentFilePlatformFromClasses(
  classes: ReturnType<typeof createNuniClasses>,
): AssignmentFilePlatform {
  return {
    workspace: (_actor, workspaceId) => classes.get(workspaceId),
    assignment: async (_actor, workspaceId, assignmentId) => {
      const items = await classes.assignments(workspaceId);
      const item = items.find((entry) => entry.id === assignmentId);
      if (!item) throw new NuniError(404, 'NOT_FOUND');
      return item;
    },
    submitText: (_actor, workspaceId, assignmentId, body, idempotencyKey) =>
      classes.submit(workspaceId, assignmentId, body, idempotencyKey),
  };
}

export { assignmentFileSubmitEnabled, resetAssignmentFileStores };

import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  ASSIGNMENT_FILE_URL_TTL_MS,
  FILE_ONLY_SUBMISSION_BODY,
  assertAssignmentFileBudget,
  assertAssignmentFileCounts,
  assertAssignmentFileMagic,
  assertAssignmentFileSize,
  assignmentFileSubmitEnabled,
  assignmentSubmissionLate,
  classifyAssignmentFile,
  sanitizeAssignmentFileName,
  type AssignmentFileKind,
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

export type AssignmentFileActor = {
  platformAccountId: string;
  session: PlatformSession;
};

type FileRecord = {
  id: string;
  workspaceId: string;
  assignmentId: string;
  platformAccountId: string;
  originalName: string;
  contentType: string;
  byteSize: number;
  sha256: string;
  kind: AssignmentFileKind;
  storageKey: string;
  createdAt: string;
  uploadedAt: string | null;
  submittedAt: string | null;
  supersededAt: string | null;
  late: boolean;
};

type IdempotencyRow = { hash: string; payload: unknown };

export type AssignmentFileStores = {
  blobs: Map<string, Uint8Array>;
  files: Map<string, FileRecord>;
  idempotency: Map<string, IdempotencyRow>;
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

const memoryStores: AssignmentFileStores = {
  blobs: new Map(),
  files: new Map(),
  idempotency: new Map(),
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

function visibleFiles(store: AssignmentFileStores, assignmentId: string, accountId: string) {
  return [...store.files.values()].filter(
    (file) =>
      file.assignmentId === assignmentId &&
      file.platformAccountId === accountId &&
      file.submittedAt &&
      !file.supersededAt,
  );
}

function stagedFiles(store: AssignmentFileStores, assignmentId: string, accountId: string) {
  return [...store.files.values()].filter(
    (file) =>
      file.assignmentId === assignmentId &&
      file.platformAccountId === accountId &&
      file.uploadedAt &&
      !file.submittedAt &&
      !file.supersededAt,
  );
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

function teacherRole(role: NuniRole) {
  return role === 'owner-teacher' || role === 'co-teacher';
}

async function persistBlob(storageKey: string, bytes: Uint8Array) {
  const dir = process.env.ASSIGNMENT_FILE_STORE_DIR?.trim();
  if (!dir) {
    memoryStores.blobs.set(storageKey, bytes);
    return;
  }
  const full = path.join(dir, storageKey);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, bytes);
}

async function readBlob(storageKey: string): Promise<Uint8Array | null> {
  const dir = process.env.ASSIGNMENT_FILE_STORE_DIR?.trim();
  if (!dir) return memoryStores.blobs.get(storageKey) ?? null;
  try {
    return await readFile(path.join(dir, storageKey));
  } catch {
    return null;
  }
}

async function persistSupabase(storageKey: string, bytes: Uint8Array, contentType: string) {
  const base = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!base || !key) return false;
  const response = await fetch(`${base.replace(/\/$/, '')}/storage/v1/object/assignment-submissions/${storageKey}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      apikey: key,
      'Content-Type': contentType,
      'x-upsert': 'true',
    },
    body: Buffer.from(bytes),
  });
  if (!response.ok) throw new NuniError(503, 'ASSIGNMENT_FILE_UPLOAD_UNAVAILABLE');
  return true;
}

async function readSupabase(storageKey: string): Promise<Uint8Array | null> {
  const base = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!base || !key) return null;
  const response = await fetch(
    `${base.replace(/\/$/, '')}/storage/v1/object/assignment-submissions/${storageKey}`,
    { headers: { Authorization: `Bearer ${key}`, apikey: key } },
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new NuniError(503, 'ASSIGNMENT_FILE_UPLOAD_UNAVAILABLE');
  return new Uint8Array(await response.arrayBuffer());
}

export function resetAssignmentFileStores(stores = memoryStores) {
  stores.blobs.clear();
  stores.files.clear();
  stores.idempotency.clear();
}

export function createAssignmentFileService(options?: {
  stores?: AssignmentFileStores;
  platform: AssignmentFilePlatform;
  secret: string;
  now?: () => Date;
  id?: () => string;
}) {
  const stores = options?.stores ?? memoryStores;
  const now = options?.now ?? (() => new Date());
  const id = options?.id ?? (() => randomUUID());
  const secret = options?.secret;
  const platform = options?.platform;
  if (!secret || !platform) throw new NuniError(503, 'CONFIGURATION_REQUIRED');

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

  async function requireMember(actor: AssignmentFileActor, workspaceId: string, assignmentId: string) {
    const [workspace, assignment] = await Promise.all([
      platform.workspace(actor, workspaceId),
      platform.assignment(actor, workspaceId, assignmentId),
    ]);
    return { workspace, assignment };
  }

  function replay(actor: AssignmentFileActor, key: string, hash: string) {
    const row = stores.idempotency.get(`${actor.platformAccountId}:${key}`);
    if (!row) return null;
    if (row.hash !== hash) throw new NuniError(409, 'IDEMPOTENCY_CONFLICT');
    return row.payload;
  }

  function remember(actor: AssignmentFileActor, key: string, hash: string, payload: unknown) {
    stores.idempotency.set(`${actor.platformAccountId}:${key}`, { hash, payload });
  }

  return {
    async createIntent(
      actor: AssignmentFileActor,
      workspaceId: string,
      assignmentId: string,
      input: { originalName: string; contentType: string; byteSize: number; idempotencyKey: string },
    ) {
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
      const existing = replay(actor, input.idempotencyKey, hash);
      if (existing) return existing;
      const current = stagedFiles(stores, assignment.id, actor.platformAccountId);
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
      stores.files.set(record.id, record);
      const payload = {
        id: record.id,
        originalName: record.originalName,
        contentType: record.contentType,
        byteSize: record.byteSize,
        kind: record.kind,
        uploadPath: `class-workspaces/${workspaceId}/assignments/${assignmentId}/files/${record.id}/content`,
      };
      remember(actor, input.idempotencyKey, hash, payload);
      return payload;
    },

    async putContent(
      actor: AssignmentFileActor,
      workspaceId: string,
      assignmentId: string,
      fileRecordId: string,
      bytes: Uint8Array,
    ) {
      await requireStudent(actor, workspaceId, assignmentId);
      const record = stores.files.get(fileRecordId);
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
      if (!(await persistSupabase(record.storageKey, bytes, record.contentType))) {
        await persistBlob(record.storageKey, bytes);
      }
      stores.files.set(record.id, record);
      return downloadDescriptor(record, secret, now);
    },

    async submitFiles(
      actor: AssignmentFileActor,
      workspaceId: string,
      assignmentId: string,
      input: { body?: string; fileIds: string[]; idempotencyKey: string },
    ) {
      const { assignment } = await requireStudent(actor, workspaceId, assignmentId);
      const fileIds = [...new Set(input.fileIds.map((value) => nuniId(value, 'cwf')))];
      const hash = sha256(Buffer.from(JSON.stringify({ body: input.body ?? '', fileIds })));
      const existing = replay(actor, input.idempotencyKey, hash);
      if (existing) return existing;
      const records = fileIds.map((value) => {
        const record = stores.files.get(value);
        if (
          !record ||
          record.workspaceId !== workspaceId ||
          record.assignmentId !== assignmentId ||
          record.platformAccountId !== actor.platformAccountId ||
          !record.uploadedAt
        )
          throw new NuniError(422, 'ASSIGNMENT_FILE_REQUIRED');
        return record;
      });
      const images = records.filter((file) => file.kind === 'image').length;
      const documents = records.filter((file) => file.kind === 'file').length;
      const body = (input.body ?? '').trim();
      if (!records.length && !body) throw new NuniError(422, 'ASSIGNMENT_FILE_REQUIRED');
      if (records.length) assertAssignmentFileCounts(images, documents);
      const submittedAt = nowIso(now);
      const late = assignmentSubmissionLate(assignment.dueAt, submittedAt);
      const text = body || (records.length ? FILE_ONLY_SUBMISSION_BODY : '');
      const confirmed = await platform.submitText(
        actor,
        workspaceId,
        assignmentId,
        text,
        `${input.idempotencyKey}:text`,
      );
      for (const previous of visibleFiles(stores, assignmentId, actor.platformAccountId)) {
        previous.supersededAt = submittedAt;
        stores.files.set(previous.id, previous);
      }
      for (const record of records) {
        record.submittedAt = confirmed.mySubmission?.submittedAt ?? submittedAt;
        record.late = assignmentSubmissionLate(assignment.dueAt, record.submittedAt);
        record.supersededAt = null;
        stores.files.set(record.id, record);
      }
      const files = records.map((file) => downloadDescriptor(file, secret, now));
      const payload = withFiles(confirmed, files, late || files.some((file) => file && recordLate(file.id)));
      remember(actor, input.idempotencyKey, hash, payload);
      return payload;

      function recordLate(idValue: string) {
        return stores.files.get(idValue)?.late === true;
      }
    },

    hydrateSubmission(
      actor: AssignmentFileActor,
      workspace: NuniWorkspace,
      assignment: NuniAssignment,
      submission: NuniSubmission | null,
      viewerAccountId: string,
    ): NuniSubmission | null {
      if (!submission) return submission;
      const canRead =
        submission.platformAccountId === viewerAccountId || teacherRole(workspace.memberRole);
      if (!canRead) throw new NuniError(403, 'CLASS_WORKSPACE_FORBIDDEN');
      const files = visibleFiles(stores, assignment.id, submission.platformAccountId).map((file) =>
        downloadDescriptor(file, secret, now),
      );
      const computedLate =
        assignmentSubmissionLate(assignment.dueAt, submission.submittedAt) ||
        files.some((file) => stores.files.get(file.id)?.late === true);
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
      const record = stores.files.get(fileRecordId);
      if (
        !record ||
        record.workspaceId !== workspaceId ||
        record.assignmentId !== assignmentId ||
        !record.uploadedAt
      )
        throw new NuniError(404, 'NOT_FOUND');
      const downloadPath = `class-workspaces/${workspaceId}/assignments/${assignmentId}/files/${fileRecordId}/content`;
      const expected = sign(secret, [downloadPath, exp, record.platformAccountId]);
      if (!equal(expected, sig)) throw new NuniError(403, 'ASSIGNMENT_FILE_SIGNATURE_INVALID');
      if (!/^\d+$/.test(exp) || Number(exp) < now().getTime())
        throw new NuniError(403, 'ASSIGNMENT_FILE_EXPIRED');
      const bytes = (await readSupabase(record.storageKey)) ?? (await readBlob(record.storageKey));
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

export { assignmentFileSubmitEnabled };

import { NextRequest, NextResponse } from 'next/server';
import { MAX_ASSIGNMENT_DOCUMENT_BYTES } from '@campus/shared/src/assignmentFiles';
import {
  NuniError,
  createNuniClasses,
  nuniId,
  nuniRecord,
  parseNuniPrincipal,
  type NuniAssignment,
  type NuniSubmission,
  type NuniWorkspace,
} from '@campus/shared/src/nuni';
import {
  assignmentFilePlatformFromClasses,
  assignmentFileSubmitEnabled,
  createAssignmentFileService,
  type AssignmentFileActor,
} from './assignmentFileService';
import {
  boundedBytes,
  boundedJson,
  binaryResponse,
  jsonResponse,
  platformRequest,
  readPlatformAuthorization,
  requireSameOrigin,
  requireSession,
  type PlatformSession,
} from './server';

const WORKSPACE = /^cw_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ASSIGNMENT = /^cwa_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FILE = /^cwf_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isAssignmentFileQuery(segments: string[]) {
  return (
    segments.length === 7 &&
    segments[0] === 'class-workspaces' &&
    WORKSPACE.test(segments[1] || '') &&
    segments[2] === 'assignments' &&
    ASSIGNMENT.test(segments[3] || '') &&
    segments[4] === 'files' &&
    FILE.test(segments[5] || '') &&
    segments[6] === 'content'
  );
}

export function isAssignmentFileMutation(method: string, segments: string[]) {
  if (segments[0] !== 'class-workspaces' || !WORKSPACE.test(segments[1] || '')) return false;
  if (method === 'POST' && segments.length === 6 && segments[2] === 'assignments' && ASSIGNMENT.test(segments[3] || '') && segments[4] === 'files' && segments[5] === 'intents')
    return true;
  if (method === 'POST' && segments.length === 5 && segments[2] === 'assignments' && ASSIGNMENT.test(segments[3] || '') && ['submit', 'submit-files', 'withdraw-submission'].includes(segments[4]))
    return true;
  if (method === 'PUT' && isAssignmentFileQuery(segments)) return true;
  return false;
}

function classesFor(session: PlatformSession) {
  let principal: Promise<string> | undefined;
  return createNuniClasses(
    (resource, input, query) => platformRequest(resource, session, input, query),
    () =>
      (principal ??= platformRequest('sessions/current', session).then(
        (value) => parseNuniPrincipal(value).platformAccountId,
      )),
  );
}

async function actorFor(request: NextRequest): Promise<AssignmentFileActor> {
  const platform = readPlatformAuthorization(request);
  if (platform) {
    const principal = parseNuniPrincipal(await platformRequest('sessions/current', platform));
    return { platformAccountId: principal.platformAccountId, session: platform };
  }
  const session = requireSession(request);
  const principal = parseNuniPrincipal(await platformRequest('sessions/current', session));
  return { platformAccountId: principal.platformAccountId, session };
}

function serviceFor(actor: AssignmentFileActor) {
  const secret =
    process.env.ASSIGNMENT_FILE_SIGNING_SECRET?.trim() || process.env.BFF_SESSION_SECRET?.trim();
  if (!secret || secret.length < 32) throw new NuniError(503, 'CONFIGURATION_REQUIRED');
  return createAssignmentFileService({
    platform: assignmentFilePlatformFromClasses(classesFor(actor.session)),
    secret,
  });
}

function field(input: Record<string, unknown>, name: string, min: number, max: number): string {
  const value = input[name];
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max)
    throw new NuniError(422, 'INVALID_INPUT');
  return value.trim();
}

export async function handleAssignmentFileRequest(
  request: NextRequest,
  segments: string[],
): Promise<NextResponse | null> {
  const fileQuery = isAssignmentFileQuery(segments);
  const mutating = isAssignmentFileMutation(request.method, segments);
  if (!fileQuery && !mutating) return null;
  if (!assignmentFileSubmitEnabled()) {
    // Preserve the existing text submission path when attachments are disabled.
    if (mutating && request.method === 'POST' && segments[4] === 'submit') return null;
    throw new NuniError(404, 'NOT_FOUND');
  }
  if (mutating && !readPlatformAuthorization(request)) requireSameOrigin(request);
  if (request.method === 'GET' && fileQuery) {
    const keys = Array.from(request.nextUrl.searchParams.keys());
    if (
      keys.some((key) => key !== 'exp' && key !== 'sig' && key !== 'download') ||
      request.nextUrl.searchParams.getAll('exp').length !== 1 ||
      request.nextUrl.searchParams.getAll('sig').length !== 1 ||
      request.nextUrl.searchParams.getAll('download').length > 1
    )
      throw new NuniError(400, 'INVALID_INPUT');
    const download = request.nextUrl.searchParams.get('download');
    if (download !== null && download !== '1') throw new NuniError(400, 'INVALID_INPUT');
    const secret =
      process.env.ASSIGNMENT_FILE_SIGNING_SECRET?.trim() || process.env.BFF_SESSION_SECRET?.trim();
    if (!secret || secret.length < 32) throw new NuniError(503, 'CONFIGURATION_REQUIRED');
    const service = createAssignmentFileService({
      platform: {
        workspace: async () => {
          throw new NuniError(404, 'NOT_FOUND');
        },
        assignment: async () => {
          throw new NuniError(404, 'NOT_FOUND');
        },
        submitText: async () => {
          throw new NuniError(404, 'NOT_FOUND');
        },
      },
      secret,
    });
    const file = await service.readContent(
      segments[1],
      segments[3],
      segments[5],
      request.nextUrl.searchParams.get('exp') ?? '',
      request.nextUrl.searchParams.get('sig') ?? '',
    );
    return binaryResponse(file.bytes, file.contentType, file.originalName, download === '1');
  }
  const actor = await actorFor(request);
  const service = serviceFor(actor);
  if (request.method === 'PUT' && fileQuery) {
    const bytes = await boundedBytes(request, MAX_ASSIGNMENT_DOCUMENT_BYTES);
    return jsonResponse(await service.putContent(actor, segments[1], segments[3], segments[5], bytes));
  }
  let input: Record<string, unknown>;
  try {
    input = nuniRecord(await boundedJson(request, 64 * 1024));
  } catch (error) {
    if (error instanceof NuniError && error.status === 413) throw error;
    throw new NuniError(400, 'INVALID_INPUT');
  }
  const idempotencyKey = field(input, 'idempotencyKey', 8, 100);
  if (segments[4] === 'withdraw-submission') {
    return jsonResponse(await service.withdrawSubmission(actor, segments[1], segments[3], {
      submittedAt: field(input, 'submittedAt', 1, 50), idempotencyKey,
    }));
  }
  if (segments[5] === 'intents') {
    if (Array.isArray(input.files)) {
      if (input.files.length < 1 || input.files.length > 10) throw new NuniError(422, 'INVALID_INPUT');
      const files = input.files.map((entry, index) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry))
          throw new NuniError(422, 'INVALID_INPUT');
        const file = entry as Record<string, unknown>;
        const byteSize = file.byteSize;
        if (!Number.isSafeInteger(byteSize)) throw new NuniError(422, 'INVALID_INPUT');
        const key = file.idempotencyKey === undefined ? `${idempotencyKey}:${index}` : field(file, 'idempotencyKey', 8, 100);
        return {
          originalName: field(file, 'originalName', 1, 200),
          contentType: field(file, 'contentType', 1, 120),
          byteSize: Number(byteSize),
          idempotencyKey: key,
        };
      });
      return jsonResponse({ intents: await service.createIntents(actor, segments[1], segments[3], files) }, 201);
    }
    const byteSize = input.byteSize;
    if (!Number.isSafeInteger(byteSize)) throw new NuniError(422, 'INVALID_INPUT');
    return jsonResponse(
      await service.createIntent(actor, segments[1], segments[3], {
        originalName: field(input, 'originalName', 1, 200),
        contentType: field(input, 'contentType', 1, 120),
        byteSize: Number(byteSize),
        idempotencyKey,
      }),
      201,
    );
  }
  if (segments[4] === 'submit-files' || segments[4] === 'submit') {
    if (segments[4] === 'submit') input.fileIds = [];
    if (!Array.isArray(input.fileIds) || input.fileIds.length > 10)
      throw new NuniError(422, 'INVALID_INPUT');
    const fileIds = input.fileIds.map((value) => {
      try {
        return nuniId(value, 'cwf');
      } catch {
        throw new NuniError(422, 'INVALID_INPUT');
      }
    });
    const body = input.body === undefined ? undefined : field(input, 'body', 0, 8000);
    return jsonResponse(
      await service.submitFiles(actor, segments[1], segments[3], {
        body: body === '' ? undefined : body,
        fileIds,
        idempotencyKey,
      }),
    );
  }
  throw new NuniError(404, 'NOT_FOUND');
}

export async function hydrateAssignmentFiles(
  request: NextRequest,
  workspace: NuniWorkspace,
  assignments: NuniAssignment[],
): Promise<NuniAssignment[]> {
  const actor = await actorFor(request);
  const service = serviceFor(actor);
  return Promise.all(
    assignments.map(async (item) => ({
      ...item,
      submissionCount: await service.visibleSubmissionCount(item),
      mySubmission: await service.hydrateSubmission(
        actor,
        workspace,
        item,
        item.mySubmission,
        actor.platformAccountId,
      ),
    })),
  );
}

export async function hydrateSubmissionFiles(
  request: NextRequest,
  workspace: NuniWorkspace,
  assignment: NuniAssignment,
  submissions: NuniSubmission[],
): Promise<NuniSubmission[]> {
  const actor = await actorFor(request);
  const service = serviceFor(actor);
  const hydrated: NuniSubmission[] = [];
  for (const entry of submissions) {
    const item = await service.hydrateSubmission(
      actor,
      workspace,
      assignment,
      entry,
      actor.platformAccountId,
    );
    if (item) hydrated.push(item);
  }
  return hydrated;
}

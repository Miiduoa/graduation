import { CourseAccessError, courseMetadata, courseRecord, parseCourseCandidate, sameCourseScope } from '@campus/shared/src/courseAccess';
import { parseCourseRequest, parseCourseRequests, parseCourseWorkspace, isCourseAccessPath } from '@campus/shared/src/courseAccessClient';
import { NextRequest, NextResponse } from 'next/server';
import { handleFood, isFoodResource } from './food';
import { handlePersonalImportSync } from './personalImportSync';
import {
  createNuniClasses,
  NuniError,
  nuniRecord,
  parseNuniPrincipal,
} from '@campus/shared/src/nuni';
import {
  parseMerchantApplication,
  parseMerchantOverview,
  parseMerchantWorkspaces,
  validateMerchantApplicationInput,
} from '@campus/shared/src/nuniMerchant';
import {
  createMerchantOperations,
  validateMerchantAvailabilityInput,
} from '@campus/shared/src/nuniMerchantOperations';
import {
  parseNuniMemberships,
  parseMembershipRequestReceipt,
  validateMembershipRequestInput,
} from '@campus/shared/src/nuniAccount';
import {
  SESSION_COOKIE,
  boundedJson,
  equalSecret,
  errorResponse,
  jsonResponse,
  nuniEnabled,
  platformRequest,
  publicOrigin,
  readPlatformAuthorization,
  readSession,
  requireSameOrigin,
  requireSession,
  revokeSession,
  sessionContext,
  setCookie,
} from './server';
import {
  handleAssignmentFileRequest,
  hydrateAssignmentFiles,
  hydrateSubmissionFiles,
  isAssignmentFileMutation,
  isAssignmentFileQuery,
} from './assignmentFileRoutes';
import { assignmentFileSubmitEnabled } from './assignmentFileService';
import { isSchoolStudentIdLoginEnabled } from '@/lib/server/schoolStudentIdLoginEnabled';
import { isSchoolLoginOffered } from '@/lib/server/schoolLoginConfig';

const SIGN_IN_OPTIONS_SCHOOL_ID = /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;

function signInOptionsSchoolId(request: NextRequest): string | null {
  const keys = Array.from(request.nextUrl.searchParams.keys());
  if (keys.some((key) => key !== 'schoolId') || request.nextUrl.searchParams.getAll('schoolId').length > 1) {
    throw new NuniError(400, 'INVALID_INPUT');
  }
  const schoolId = request.nextUrl.searchParams.get('schoolId');
  if (schoolId === null) return null;
  if (!SIGN_IN_OPTIONS_SCHOOL_ID.test(schoolId)) throw new NuniError(400, 'INVALID_INPUT');
  return schoolId;
}

function studentIdSignInOption(request: NextRequest): boolean {
  if (!isSchoolStudentIdLoginEnabled()) return false;
  const schoolId = signInOptionsSchoolId(request);
  return isSchoolLoginOffered(schoolId ?? 'pu');
}

const WORKSPACE = /^cw_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ASSIGNMENT = /^cwa_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const QUIZ = /^cwq_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const UNIT = /^cwu_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ACCOUNT = /^pa_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CLASSROOM_SESSION = /^cws_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function field(input: Record<string, unknown>, name: string, min: number, max: number): string {
  const value = input[name];
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max)
    throw new NuniError(422, 'INVALID_INPUT');
  return value.trim();
}

function unitInput(input: Record<string, unknown>): { unitId?: string } {
  if (input.unitId === undefined) return {};
  if (typeof input.unitId !== 'string' || !UNIT.test(input.unitId))
    throw new NuniError(422, 'INVALID_INPUT');
  return { unitId: input.unitId };
}

function onlyKeys(input: Record<string, unknown>, keys: string[]) {
  if (Object.keys(input).some((key) => !keys.includes(key)))
    throw new NuniError(422, 'INVALID_INPUT');
}

function inviteMaxUses(input: Record<string, unknown>): number {
  if (input.maxUses === undefined) return 30;
  if (
    typeof input.maxUses !== 'number' ||
    !Number.isInteger(input.maxUses) ||
    input.maxUses < 1 ||
    input.maxUses > 100
  )
    throw new NuniError(422, 'INVALID_INPUT');
  return input.maxUses;
}

function dueDate(input: Record<string, unknown>): string | null {
  if (input.dueAt === null || input.dueAt === undefined) return null;
  const value = input.dueAt;
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(
      value,
    ) ||
    !Number.isFinite(Date.parse(value))
  )
    throw new NuniError(422, 'INVALID_INPUT');
  // Date.parse normalizes impossible calendar dates; reject those before forwarding.
  const calendar = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  if (calendar.toISOString().slice(0, 10) !== value.slice(0, 10))
    throw new NuniError(422, 'INVALID_INPUT');
  return value;
}

export async function handleNuni(request: NextRequest, segments: string[]): Promise<NextResponse> {
  try {
    const path = segments.join('/');
    if (!nuniEnabled() && path !== 'session' && path !== 'logout') {
      // Existing sessions still need verification and revocation when courses are disabled.
      if (request.method === 'GET' && path === 'sign-in-options') {
        return jsonResponse({ google: false, studentId: studentIdSignInOption(request) });
      }
      throw new NuniError(404, 'NOT_FOUND');
    }
    const method = request.method;
    if (method !== 'GET' && method !== 'POST' && method !== 'PUT')
      throw new NuniError(405, 'METHOD_NOT_ALLOWED');
    const fileEnabled = assignmentFileSubmitEnabled();
    const fileMutation = fileEnabled && isAssignmentFileMutation(method, segments);
    const fileContent = fileEnabled && isAssignmentFileQuery(segments);
    if (
      method === 'PUT' &&
      !fileMutation &&
      !(
        segments.length === 4 &&
        segments[0] === 'merchant-workspaces' &&
        segments[3] === 'settings'
      )
    )
      throw new NuniError(405, 'METHOD_NOT_ALLOWED');
    const isMaterialsPage =
      method === 'GET' &&
      segments.length === 4 &&
      segments[0] === 'class-workspaces' &&
      segments[2] === 'materials' &&
      segments[3] === 'page';
    if (isMaterialsPage &&
      (Array.from(request.nextUrl.searchParams.keys()).some((key) => key !== 'cursor') ||
        request.nextUrl.searchParams.getAll('cursor').length > 1))
      throw new NuniError(400, 'INVALID_INPUT');
    if (
      request.nextUrl.search &&
      !isFoodResource(segments) &&
      !isMaterialsPage &&
      !(method === 'GET' && fileContent) &&
      !(method === 'GET' && path === 'sign-in-options')
    )
      throw new NuniError(400, 'INVALID_INPUT');
    if (method !== 'GET' && !(fileMutation && readPlatformAuthorization(request)))
      requireSameOrigin(request);
    const fileResponse = await handleAssignmentFileRequest(request, segments);
    if (fileResponse) return fileResponse;
    if (isFoodResource(segments)) return await handleFood(request, segments);
    if (path === 'personal-imports/read' || path === 'personal-imports/write')
      return await handlePersonalImportSync(request, path.endsWith('/read') ? 'read' : 'write');
    if (method === 'GET' && path === 'sign-in-options') {
      publicOrigin();
      const googleReady =
        process.env.PLATFORM_GOOGLE_LOGIN_ENABLED === 'true' &&
        !!process.env.PLATFORM_GOOGLE_CLIENT_SECRET?.trim() &&
        (process.env.BFF_SESSION_SECRET?.trim().length ?? 0) >= 32;
      const result = nuniRecord(await platformRequest('providers'));
      if (!Array.isArray(result.kinds) || result.kinds.some((kind) => typeof kind !== 'string'))
        throw new NuniError(502, 'INVALID_RESPONSE');
      return jsonResponse({
        google: googleReady && result.kinds.includes('google-consumer'),
        studentId: studentIdSignInOption(request),
      });
    }
    if (method === 'GET' && path === 'session') {
      const session = readSession(request);
      if (!session) return jsonResponse({ authenticated: false });
      if (session.pendingLogout)
        return jsonResponse({
          authenticated: false,
          pendingLogout: true,
          context: sessionContext(session),
        });
      try {
        const principal = parseNuniPrincipal(await platformRequest('sessions/current', session));
        return jsonResponse({
          authenticated: true,
          ...principal,
          context: sessionContext(session),
          ...(assignmentFileSubmitEnabled() ? { assignmentFileSubmit: true } : {}),
        });
      } catch (error) {
        if (error instanceof NuniError && error.status === 401)
          return jsonResponse({ authenticated: false });
        throw error;
      }
    }
    if (method === 'POST' && path === 'logout') {
      const session = readSession(request);
      if (!session) return jsonResponse({ authenticated: false });
      if (!equalSecret(request.headers.get('x-campus-session'), sessionContext(session)))
        throw new NuniError(409, 'SESSION_CHANGED');
      try {
        await revokeSession(session);
      } catch (error) {
        const response = errorResponse(error);
        setCookie(response, SESSION_COOKIE, { ...session, pendingLogout: true }, session.expiresAt);
        return response;
      }
      const response = jsonResponse({ authenticated: false });
      setCookie(response, SESSION_COOKIE, null);
      return response;
    }
    if (path === 'memberships') {
      const session = requireSession(request);
      if (method === 'POST') {
        const input = validateMembershipRequestInput(await boundedJson(request, 2048));
        const receipt = parseMembershipRequestReceipt(
          await platformRequest('memberships', session, input),
        );
        return jsonResponse(receipt, receipt.created ? 201 : 200);
      }
      return jsonResponse({
        memberships: parseNuniMemberships(await platformRequest('memberships', session)),
      });
    }
    if (
      ['merchant-onboarding-programs', 'merchant-applications', 'merchant-workspaces'].includes(
        path,
      )
    ) {
      const session = requireSession(request);
      if (method === 'GET') {
        const result = await platformRequest(path, session);
        if (path === 'merchant-workspaces')
          return jsonResponse({ workspaces: parseMerchantWorkspaces(result) });
        if (path === 'merchant-onboarding-programs')
          return jsonResponse({
            programs: parseMerchantOverview({ ...nuniRecord(result), applications: [] }).programs,
          });
        return jsonResponse({
          applications: parseMerchantOverview({ ...nuniRecord(result), programs: [] }).applications,
        });
      }
      if (path !== 'merchant-applications') throw new NuniError(405, 'METHOD_NOT_ALLOWED');
      const input = validateMerchantApplicationInput(await boundedJson(request, 16 * 1024));
      const result = parseMerchantApplication(await platformRequest(path, session, input));
      if (
        result.tenantId !== input.tenantId ||
        result.brandName !== input.brandName ||
        result.locationName !== input.locationName
      )
        throw new NuniError(502, 'INVALID_RESPONSE');
      return jsonResponse(result, 201);
    }
    if (segments[0] === 'course-access') {
      if (method !== 'POST' || !isCourseAccessPath(path)) throw new NuniError(404, 'NOT_FOUND');
      const session = requireSession(request);
      const input = courseRecord(await boundedJson(request, 8192));
      const result = await platformRequest(path, session, input);
      if (path === 'course-access/workspace-course') {
        if (typeof input.workspaceId !== 'string' || typeof input.schoolId !== 'string')
          throw new NuniError(422, 'INVALID_INPUT');
        return jsonResponse(parseCourseWorkspace(result, input.workspaceId, input.schoolId));
      }
      if (path === 'course-access/match') {
        const scope = courseMetadata(input), response = courseRecord(result);
        if (!Array.isArray(response.candidates) || response.candidates.length > 200 || typeof response.truncated !== 'boolean')
          throw new NuniError(502, 'INVALID_RESPONSE');
        const candidates = response.candidates.map(parseCourseCandidate);
        if (candidates.some(item => !sameCourseScope(item, scope)) || new Set(candidates.map(item => item.id)).size !== candidates.length)
          throw new NuniError(502, 'INVALID_RESPONSE');
        return jsonResponse({ candidates, truncated: response.truncated });
      }
      if (path === 'course-access/requests' || path === 'course-access/reviews') {
        const response = parseCourseRequests(result);
        if (path.endsWith('/reviews') && response.requests.some(item => item.metadata.schoolId !== input.schoolId))
          throw new NuniError(502, 'INVALID_RESPONSE');
        // Never return reviewer-only identity fields on the applicant endpoint.
        if (path.endsWith('/requests')) response.requests = response.requests.map(({ applicantId: _applicantId, ...item }) => item);
        return jsonResponse(response);
      }
      const response = parseCourseRequest(result);
      if ((segments.length === 4 && response.id !== segments[2]) ||
          (path.endsWith('/student-requests') && (response.kind !== 'student' || response.courseId !== input.courseId)) ||
          (path.endsWith('/teacher-requests') && (response.kind !== 'teacher' || response.workspaceId !== input.workspaceId)))
        throw new NuniError(502, 'INVALID_RESPONSE');
      return jsonResponse(response);
    }
    if (segments[0] === 'merchant-workspaces' && segments.length > 1) {
      const session = requireSession(request);
      const operations = createMerchantOperations((resource, input, verb) =>
        platformRequest(resource, session, input, undefined, verb),
      );
      const identity = { tenantId: segments[1], locationId: segments[2] };
      if (method === 'GET' && segments.length === 3)
        return jsonResponse(await operations.get(identity.tenantId, identity.locationId));
      if (segments.length !== 4) throw new NuniError(404, 'NOT_FOUND');
      const action = segments[3];
      if (method === 'PUT' && action === 'settings')
        return jsonResponse(
          await operations.updateSettings(
            identity.tenantId,
            identity.locationId,
            await boundedJson(request, 4096),
          ),
        );
      if (method === 'POST' && action === 'initial-menu')
        return jsonResponse(
          await operations.createInitialMenu(
            identity.tenantId,
            identity.locationId,
            await boundedJson(request, 512 * 1024),
          ),
          201,
        );
      if (method === 'POST' && action === 'activate') {
        const body = nuniRecord(await boundedJson(request, 1024));
        if (Object.keys(body).length) throw new NuniError(422, 'INVALID_INPUT');
        return jsonResponse(await operations.activate(identity.tenantId, identity.locationId));
      }
      if (method === 'POST' && action === 'availability')
        return jsonResponse(
          await operations.setAvailability(
            identity.tenantId,
            identity.locationId,
            validateMerchantAvailabilityInput(await boundedJson(request, 1024)).acceptingOrders,
          ),
        );
      throw new NuniError(405, 'METHOD_NOT_ALLOWED');
    }
    if (segments[0] !== 'class-workspaces') throw new NuniError(404, 'NOT_FOUND');
    const filteredAssignmentRead = method === 'GET' && segments[2] === 'assignments';
    const session =
      (fileEnabled || filteredAssignmentRead ? readPlatformAuthorization(request) : null) ?? requireSession(request);
    let principal: Promise<string> | undefined;
    const classes = createNuniClasses(
      (resource, input, query) => platformRequest(resource, session, input, query),
      () =>
        (principal ??= platformRequest('sessions/current', session).then(
          (value) => parseNuniPrincipal(value).platformAccountId,
        )),
    );
    const id = segments[1];
    const activityId = segments[3];
    const isAssignment = segments[2] === 'assignments' && ASSIGNMENT.test(activityId || '');
    const isQuiz = segments[2] === 'quizzes' && QUIZ.test(activityId || '');
    if (method === 'GET') {
      if (segments.length === 1) return jsonResponse({ workspaces: await classes.list() });
      if (!WORKSPACE.test(id || '')) throw new NuniError(404, 'NOT_FOUND');
      if (segments.length === 2) return jsonResponse(await classes.get(id));
      if (isMaterialsPage)
        return jsonResponse(
          await classes.materialsPage(id, request.nextUrl.searchParams.get('cursor') ?? undefined),
        );
      if (segments.length === 3) {
        if (segments[2] === 'units') return jsonResponse({ units: await classes.units(id) });
        if (segments[2] === 'materials')
          return jsonResponse({ materials: await classes.materials(id) });
        if (segments[2] === 'assignments') {
          const items = await classes.assignments(id);
          const workspace = await classes.get(id);
          return jsonResponse({
            assignments: await hydrateAssignmentFiles(request, workspace, items),
          });
        }
        if (segments[2] === 'quizzes') return jsonResponse({ quizzes: await classes.quizzes(id) });
        if (
          segments[2] === 'members' ||
          segments[2] === 'affiliation' ||
          segments[2] === 'affiliation-applications' ||
          segments[2] === 'classroom-sessions'
        )
          return jsonResponse(await platformRequest(path, session));
      }
      if (
        segments.length === 5 &&
        segments[2] === 'classroom-sessions' &&
        CLASSROOM_SESSION.test(segments[3] || '') &&
        segments[4] === 'roster'
      )
        return jsonResponse(await platformRequest(path, session));
      if (segments.length === 5 && isAssignment && segments[4] === 'submissions') {
        const submissions = await classes.submissions(id, activityId);
        const [workspace, assignments] = await Promise.all([classes.get(id), classes.assignments(id)]);
        const assignment = assignments.find((item) => item.id === activityId);
        if (!assignment) throw new NuniError(404, 'NOT_FOUND');
        return jsonResponse({
          submissions: await hydrateSubmissionFiles(request, workspace, assignment, submissions),
        });
      }
      if (segments.length === 5 && isQuiz && segments[4] === 'responses')
        return jsonResponse({ responses: await classes.quizResponses(id, activityId) });
    } else {
      const createWorkspace = segments.length === 1;
      const joinWorkspace = segments.length === 2 && id === 'join';
      const createResource =
        segments.length === 3 &&
        ['invites', 'units', 'materials', 'assignments', 'quizzes'].includes(segments[2]);
      const classroomCreate = segments.length === 3 && segments[2] === 'classroom-sessions';
      const affiliationApply =
        segments.length === 3 && segments[2] === 'affiliation-applications';
      const classroomAction =
        segments.length === 5 &&
        segments[2] === 'classroom-sessions' &&
        CLASSROOM_SESSION.test(segments[3] || '') &&
        ['check-in', 'end', 'makeup-requests', 'makeup'].includes(segments[4]);
      const activityAction =
        segments.length === 5 &&
        (isAssignment || isQuiz) &&
        ['submit', 'close'].includes(segments[4]);
      const feedbackAction =
        segments.length === 7 &&
        ((isAssignment && segments[4] === 'submissions') ||
          (isQuiz && segments[4] === 'responses')) &&
        ACCOUNT.test(segments[5] || '') &&
        segments[6] === 'feedback';
      if (
        !createWorkspace &&
        !joinWorkspace &&
        (!WORKSPACE.test(id || '') ||
          (!createResource &&
            !classroomCreate &&
            !affiliationApply &&
            !classroomAction &&
            !activityAction &&
            !feedbackAction))
      )
        throw new NuniError(404, 'NOT_FOUND');
      let input: Record<string, unknown>;
      try {
        input = nuniRecord(await boundedJson(request, 64 * 1024));
      } catch (error) {
        if (error instanceof NuniError && error.status === 413) throw error;
        throw new NuniError(400, 'INVALID_INPUT');
      }
      // Closing is deliberately not presented as an idempotent backend operation.
      if (activityAction && segments[4] === 'close') {
        if (Object.keys(input).length > 0) throw new NuniError(422, 'INVALID_INPUT');
        return jsonResponse(
          isAssignment
            ? await classes.closeAssignment(id, activityId)
            : await classes.closeQuiz(id, activityId),
        );
      }
      if (classroomAction && (segments[4] === 'end' || segments[4] === 'makeup-requests')) {
        if (Object.keys(input).length > 0) throw new NuniError(422, 'INVALID_INPUT');
        return jsonResponse(await platformRequest(path, session, {}, undefined, 'POST'));
      }
      if (classroomAction && segments[4] === 'check-in') {
        onlyKeys(input, ['code']);
        if (
          input.code !== undefined &&
          (typeof input.code !== 'string' || input.code.length < 1 || input.code.length > 40)
        )
          throw new NuniError(422, 'INVALID_INPUT');
        return jsonResponse(await platformRequest(path, session, input, undefined, 'POST'));
      }
      if (classroomAction && segments[4] === 'makeup') {
        onlyKeys(input, ['platformAccountId', 'decision']);
        if (
          !ACCOUNT.test(String(input.platformAccountId || '')) ||
          (input.decision !== 'accept' && input.decision !== 'reject')
        )
          throw new NuniError(422, 'INVALID_INPUT');
        return jsonResponse(await platformRequest(path, session, input, undefined, 'POST'));
      }
      const idempotencyKey = field(input, 'idempotencyKey', 8, 100);
      if (classroomCreate) {
        onlyKeys(input, ['title', 'idempotencyKey', 'unitId']);
        return jsonResponse(
          await platformRequest(
            path,
            session,
            {
              title: field(input, 'title', 1, 160),
              idempotencyKey,
              ...unitInput(input),
            },
            undefined,
            'POST',
          ),
          201,
        );
      }
      if (affiliationApply) {
        onlyKeys(input, ['tenantId', 'sectionId', 'justification', 'idempotencyKey']);
        if (
          input.sectionId !== undefined &&
          input.sectionId !== null &&
          typeof input.sectionId !== 'string'
        )
          throw new NuniError(422, 'INVALID_INPUT');
        return jsonResponse(
          await platformRequest(
            path,
            session,
            {
              tenantId: field(input, 'tenantId', 1, 80),
              justification: field(input, 'justification', 1, 2000),
              idempotencyKey,
              ...(input.sectionId === undefined ? {} : { sectionId: input.sectionId }),
            },
            undefined,
            'POST',
          ),
          201,
        );
      }
      if (createWorkspace)
        return jsonResponse(
          await classes.create(field(input, 'title', 2, 120), idempotencyKey),
          201,
        );
      if (joinWorkspace)
        return jsonResponse(await classes.join(field(input, 'code', 6, 24), idempotencyKey));
      if (createResource) {
        if (segments[2] === 'invites') {
          onlyKeys(input, ['idempotencyKey', 'maxUses']);
          return jsonResponse(await classes.invite(id, idempotencyKey, inviteMaxUses(input)), 201);
        }
        if (segments[2] === 'units')
          return jsonResponse(
            await classes.createUnit(id, { title: field(input, 'title', 1, 80), idempotencyKey }),
            201,
          );
        if (segments[2] === 'materials')
          return jsonResponse(
            await classes.createMaterial(id, {
              title: field(input, 'title', 1, 160),
              body: field(input, 'body', 1, 8000),
              ...unitInput(input),
              idempotencyKey,
            }),
            201,
          );
        if (segments[2] === 'assignments')
          return jsonResponse(
            await classes.createAssignment(id, {
              title: field(input, 'title', 1, 160),
              instructions: field(input, 'instructions', 1, 8000),
              dueAt: dueDate(input),
              ...unitInput(input),
              idempotencyKey,
            }),
            201,
          );
        if (segments[2] === 'quizzes')
          return jsonResponse(
            await classes.createQuiz(id, {
              title: field(input, 'title', 1, 160),
              prompt: field(input, 'prompt', 1, 4000),
              dueAt: dueDate(input),
              ...unitInput(input),
              idempotencyKey,
            }),
            201,
          );
      }
      if (feedbackAction) {
        const feedback = field(input, 'feedback', 1, 4000);
        return jsonResponse(
          isAssignment
            ? await classes.assignmentFeedback(
                id,
                activityId,
                segments[5],
                feedback,
                idempotencyKey,
              )
            : await classes.quizFeedback(id, activityId, segments[5], feedback, idempotencyKey),
        );
      }
      if (activityAction && segments[4] === 'submit')
        return jsonResponse(
          isAssignment
            ? await classes.submit(id, activityId, field(input, 'body', 1, 8000), idempotencyKey)
            : await classes.submitQuiz(
                id,
                activityId,
                field(input, 'answer', 1, 2000),
                idempotencyKey,
              ),
        );
    }
    throw new NuniError(404, 'NOT_FOUND');
  } catch (error) {
    return errorResponse(error instanceof CourseAccessError ? new NuniError(error.statusCode, error.code) : error);
  }
}

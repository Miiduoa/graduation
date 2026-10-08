import { NextRequest, NextResponse } from 'next/server';
import {
  createNuniClasses,
  NuniError,
  nuniRecord,
  parseNuniPrincipal,
} from '@campus/shared/src/nuni';
import {
  SESSION_COOKIE,
  boundedJson,
  equalSecret,
  errorResponse,
  jsonResponse,
  nuniEnabled,
  platformRequest,
  publicOrigin,
  readSession,
  requireSameOrigin,
  requireSession,
  revokeSession,
  sessionContext,
  setCookie,
} from './server';

const WORKSPACE = /^cw_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ASSIGNMENT = /^cwa_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const QUIZ = /^cwq_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const UNIT = /^cwu_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ACCOUNT = /^pa_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

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
    if (!nuniEnabled()) throw new NuniError(404, 'NOT_FOUND');
    const method = request.method;
    if (method !== 'GET' && method !== 'POST') throw new NuniError(405, 'METHOD_NOT_ALLOWED');
    if (request.nextUrl.search) throw new NuniError(400, 'INVALID_INPUT');
    if (method === 'POST') requireSameOrigin(request);
    const path = segments.join('/');
    if (method === 'GET' && path === 'sign-in-options') {
      publicOrigin();
      if (
        process.env.PLATFORM_GOOGLE_LOGIN_ENABLED !== 'true' ||
        !process.env.PLATFORM_GOOGLE_CLIENT_SECRET?.trim() ||
        (process.env.BFF_SESSION_SECRET?.trim().length ?? 0) < 32
      ) {
        return jsonResponse({ google: false });
      }
      const result = nuniRecord(await platformRequest('providers'));
      if (!Array.isArray(result.kinds)) throw new NuniError(502, 'INVALID_RESPONSE');
      return jsonResponse({ google: result.kinds.includes('google-consumer') });
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
    if (segments[0] !== 'class-workspaces') throw new NuniError(404, 'NOT_FOUND');
    const session = requireSession(request);
    let principal: Promise<string> | undefined;
    const classes = createNuniClasses(
      (resource, input) => platformRequest(resource, session, input),
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
      if (segments.length === 3) {
        if (segments[2] === 'units') return jsonResponse({ units: await classes.units(id) });
        if (segments[2] === 'materials')
          return jsonResponse({ materials: await classes.materials(id) });
        if (segments[2] === 'assignments')
          return jsonResponse({ assignments: await classes.assignments(id) });
        if (segments[2] === 'quizzes') return jsonResponse({ quizzes: await classes.quizzes(id) });
      }
      if (segments.length === 5 && isAssignment && segments[4] === 'submissions')
        return jsonResponse({ submissions: await classes.submissions(id, activityId) });
      if (segments.length === 5 && isQuiz && segments[4] === 'responses')
        return jsonResponse({ responses: await classes.quizResponses(id, activityId) });
    } else {
      const createWorkspace = segments.length === 1;
      const joinWorkspace = segments.length === 2 && id === 'join';
      const createResource =
        segments.length === 3 &&
        ['invites', 'units', 'materials', 'assignments', 'quizzes'].includes(segments[2]);
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
        (!WORKSPACE.test(id || '') || (!createResource && !activityAction && !feedbackAction))
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
      const idempotencyKey = field(input, 'idempotencyKey', 8, 100);
      if (createWorkspace)
        return jsonResponse(
          await classes.create(field(input, 'title', 2, 120), idempotencyKey),
          201,
        );
      if (joinWorkspace)
        return jsonResponse(await classes.join(field(input, 'code', 6, 24), idempotencyKey));
      if (createResource) {
        if (segments[2] === 'invites')
          return jsonResponse(await classes.invite(id, idempotencyKey), 201);
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
    return errorResponse(error);
  }
}

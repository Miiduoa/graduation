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

function field(input: Record<string, unknown>, name: string, min: number, max: number): string {
  const value = input[name];
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max)
    throw new NuniError(422, 'INVALID_INPUT');
  return value.trim();
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
    const classes = createNuniClasses((resource, input) =>
      platformRequest(resource, session, input),
    );
    const id = segments[1];
    const assignmentId = segments[3];
    if (method === 'GET') {
      if (segments.length === 1) return jsonResponse({ workspaces: await classes.list() });
      if (!WORKSPACE.test(id || '')) throw new NuniError(404, 'NOT_FOUND');
      if (segments.length === 2) return jsonResponse(await classes.get(id));
      if (segments.length === 3 && segments[2] === 'assignments')
        return jsonResponse({ assignments: await classes.assignments(id) });
      if (
        segments.length === 5 &&
        segments[2] === 'assignments' &&
        ASSIGNMENT.test(assignmentId || '') &&
        segments[4] === 'submissions'
      ) {
        return jsonResponse({ submissions: await classes.submissions(id, assignmentId) });
      }
    } else {
      let input: Record<string, unknown>;
      try {
        input = nuniRecord(await boundedJson(request, 64 * 1024));
      } catch (error) {
        if (error instanceof NuniError && error.status === 413) throw error;
        throw new NuniError(400, 'INVALID_INPUT');
      }
      const idempotencyKey = field(input, 'idempotencyKey', 8, 100);
      if (segments.length === 1)
        return jsonResponse(
          await classes.create(field(input, 'title', 2, 120), idempotencyKey),
          201,
        );
      if (segments.length === 2 && id === 'join')
        return jsonResponse(await classes.join(field(input, 'code', 6, 24), idempotencyKey));
      if (!WORKSPACE.test(id || '')) throw new NuniError(404, 'NOT_FOUND');
      if (segments.length === 3 && segments[2] === 'invites')
        return jsonResponse(await classes.invite(id, idempotencyKey), 201);
      if (segments.length === 3 && segments[2] === 'assignments') {
        if (
          input.dueAt !== null &&
          (typeof input.dueAt !== 'string' ||
            !/^\d{4}-\d{2}-\d{2}T/.test(input.dueAt) ||
            !Number.isFinite(Date.parse(input.dueAt)))
        )
          throw new NuniError(422, 'INVALID_INPUT');
        return jsonResponse(
          await classes.createAssignment(id, {
            title: field(input, 'title', 1, 160),
            instructions: field(input, 'instructions', 1, 8000),
            dueAt: input.dueAt as string | null,
            idempotencyKey,
          }),
          201,
        );
      }
      if (
        segments.length === 5 &&
        segments[2] === 'assignments' &&
        ASSIGNMENT.test(assignmentId || '') &&
        segments[4] === 'submit'
      ) {
        return jsonResponse(
          await classes.submit(id, assignmentId, field(input, 'body', 1, 8000), idempotencyKey),
        );
      }
    }
    throw new NuniError(404, 'NOT_FOUND');
  } catch (error) {
    return errorResponse(error);
  }
}

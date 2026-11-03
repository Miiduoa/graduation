import type { NextRequest } from 'next/server';
import { NuniError, nuniRecord } from '@campus/shared/src/nuni';
import {
  boundedJson,
  errorResponse,
  jsonResponse,
  requireSameOrigin,
  requireSession,
  type PlatformSession,
} from './server';

export type PublicAgentAction =
  | 'preview'
  | 'prepareGroq'
  | 'confirm'
  | 'execute'
  | 'route'
  | 'read'
  | 'status'
  | 'reconcile'
  | 'ack';
export type PublicAgentTransport = (input: {
  action: PublicAgentAction;
  session: PlatformSession;
  body: Record<string, unknown>;
  signal: AbortSignal;
}) => Promise<unknown>;

/**
 * Unregistered BFF assembly seam. The host must inject both an authenticated,
 * single-attempt transport and a task-specific response projector. This factory
 * never chooses an upstream URL, and is disabled unless explicitly assembled.
 */
export function createPlatformPublicAgentGateway(options: {
  enabled?: boolean;
  transport: PublicAgentTransport;
  project: (action: PublicAgentAction, value: unknown, input: Record<string, unknown>) => unknown;
  timeoutMs?: number;
}) {
  const timeoutMs = options.timeoutMs ?? 15_000;
  if (
    typeof options.transport !== 'function' ||
    typeof options.project !== 'function' ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 30_000
  ) {
    throw new NuniError(503, 'PUBLIC_AGENT_NOT_CONFIGURED');
  }
  return async (request: NextRequest, action: string) => {
    try {
      if (options.enabled !== true) throw new NuniError(404, 'NOT_FOUND');
      if (
        ![
          'preview',
          'prepareGroq',
          'confirm',
          'execute',
          'route',
          'read',
          'status',
          'reconcile',
          'ack',
        ].includes(action)
      )
        throw new NuniError(404, 'NOT_FOUND');
      if (request.method !== 'POST') throw new NuniError(405, 'METHOD_NOT_ALLOWED');
      if (request.nextUrl.search) throw new NuniError(400, 'INVALID_INPUT');
      requireSameOrigin(request);
      const session = requireSession(request);
      let body: Record<string, unknown>;
      try {
        body = nuniRecord(await boundedJson(request, 8192));
      } catch (error) {
        if (error instanceof NuniError && ['BODY_TOO_LARGE', 'READ_TIMEOUT'].includes(error.code))
          throw error;
        throw new NuniError(422, 'INVALID_INPUT');
      }
      // Explicit boundaries prevent browser-provided identity or endpoint options.
      const names =
        action === 'preview' || action === 'prepareGroq'
          ? ['schoolId', 'query', 'requestId']
          : action === 'confirm'
            ? ['approved', 'request']
            : action === 'execute'
              ? ['confirmationId', 'request']
              : action === 'route'
                ? ['approved', 'operationId', 'request', 'fromId', 'toId']
                : action === 'status'
                  ? ['task', 'schoolId']
                  : action === 'reconcile'
                    ? ['task', 'schoolId', 'operationId']
                    : action === 'ack'
                      ? ['task', 'schoolId', 'operationId', 'approved']
                      : ['task', 'data'];
      if (
        Object.keys(body).length !== names.length ||
        Object.keys(body).some((key) => !names.includes(key))
      )
        throw new NuniError(422, 'INVALID_INPUT');
      if (
        (action === 'confirm' || action === 'ack' || action === 'route') &&
        body.approved !== true
      )
        throw new NuniError(409, 'PUBLIC_AGENT_CONFIRMATION_REQUIRED');
      const abort = new AbortController();
      let reject!: (error: NuniError) => void;
      const stopped = new Promise<never>((_, fail) => {
        reject = fail;
      });
      const cancel = () => {
        abort.abort();
        reject(new NuniError(503, 'PUBLIC_AGENT_OUTCOME_UNKNOWN'));
      };
      request.signal.addEventListener('abort', cancel, { once: true });
      if (request.signal.aborted) cancel();
      const timer = setTimeout(cancel, timeoutMs);
      try {
        // Exactly one invocation. The injected implementation must also disable network retry.
        const taskAction = action as PublicAgentAction;
        const value = await Promise.race([
          Promise.resolve().then(() => {
            if (abort.signal.aborted) throw new NuniError(503, 'PUBLIC_AGENT_OUTCOME_UNKNOWN');
            return options.transport({ action: taskAction, session, body, signal: abort.signal });
          }),
          stopped,
        ]);
        if (abort.signal.aborted) throw new NuniError(503, 'PUBLIC_AGENT_OUTCOME_UNKNOWN');
        // Fail closed if host has not provided the exact response contract.
        let safe: unknown;
        try {
          safe = options.project(taskAction, value, body);
        } catch {
          throw new NuniError(502, 'PUBLIC_AGENT_INVALID_RESPONSE');
        }
        if (safe === undefined) throw new NuniError(502, 'PUBLIC_AGENT_INVALID_RESPONSE');
        return jsonResponse(safe);
      } catch (error) {
        if (
          error instanceof NuniError &&
          [
            'PUBLIC_AGENT_INVALID_INPUT',
            'PUBLIC_AGENT_CONFIRMATION_REQUIRED',
            'PUBLIC_AGENT_DESTINATION_UNCLEAR',
            'PUBLIC_AGENT_FREE_QUOTA_UNAVAILABLE',
            'PUBLIC_AGENT_OPEN_OPERATION',
            'PUBLIC_AGENT_OPERATION_NOT_FOUND',
            'PUBLIC_AGENT_OUTCOME_UNKNOWN',
            'PUBLIC_AGENT_SESSION_INVALID',
            'PUBLIC_AGENT_SESSION_EXPIRED',
            'PUBLIC_AGENT_SOURCE_CHANGED',
            'PUBLIC_AGENT_INVALID_RESPONSE',
          ].includes(error.code)
        )
          throw error;
        // A disconnected POST can already have reached the executor. Never retry it.
        throw new NuniError(503, 'PUBLIC_AGENT_OUTCOME_UNKNOWN');
      } finally {
        clearTimeout(timer);
        request.signal.removeEventListener('abort', cancel);
      }
    } catch (error) {
      return errorResponse(error);
    }
  };
}

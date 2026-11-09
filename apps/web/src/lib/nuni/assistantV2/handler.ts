import { withOperationSignal } from './operation';
import { randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { createPlanProtection, validatePlanProtection, type PlanProtection } from '@/lib/assistantPlanProtection';
import {
  boundedJson,
  jsonResponse,
  nuniEnabled,
  requireSameOrigin,
  requireSession,
  sessionContext,
} from '../server';
import { beginProposal, cardIssuer, machineId, confirm, reconcile, revoke, issueRoute, routeOwner, routeTarget } from './actions';
import { createAdapter } from './adapter';
import { bounded, hash, history, id, object, text, V2Error, type Obj } from './contracts';
import { createProviderModel, fallbackReady, PROVIDER_USER_MESSAGES, providerUserMessage } from './groq';
import { run, safeCode } from './runner';
const active = new Set<string>();
const hits = new Map<string, number[]>();
let minute = 0,
  requests = 0,
  tokens = 0,
  day = 0,
  dailyRequests = 0,
  dailyTokens = 0;
const provider = createProviderModel();
const PLAN_PROTECTION_MESSAGES: Record<string, string> = {
  INVALID_PLAN_PROTECTION: '保留項目設定無效，請重新選擇要保留的原提議內容。',
  PLAN_ALREADY_PRESERVED: '已選擇保留全部項目，不需要重新預覽；原提議沒有變更。',
  PLAN_PROTECTION_MISMATCH: '新提議未完整保留指定項目，這次預覽已停止。請調整修改條件後重新預覽。',
  PLAN_REVISION_TIME_CONFLICT: '修改後的時段有重疊，這次沒有提供可確認的安排。請調整修改條件後重新預覽；不會自動移動時間或省略行程。',
  PLAN_REVISION_INCOMPLETE: '有行程無法完成預覽，這次沒有提供可確認的安排。請核對日期、時間與修改條件後重新預覽。',
};
function quota(now: number, amount: number) {
  if (Math.floor(now / 60000) !== minute) {
    minute = Math.floor(now / 60000);
    requests = 0;
    tokens = 0;
  }
  if (Math.floor(now / 86400000) !== day) {
    day = Math.floor(now / 86400000);
    dailyRequests = 0;
    dailyTokens = 0;
  }
  if (
    requests >= 24 ||
    tokens + amount > 7000 ||
    dailyRequests >= 800 ||
    dailyTokens + amount > 160000
  )
    throw new V2Error(429, 'LOCAL_QUOTA_EXCEEDED', 60);
  requests++;
  dailyRequests++;
  tokens += amount;
  dailyTokens += amount;
}
export async function handleV2(request: NextRequest, action: string) {
  const requestId = randomUUID();
  const stage = ['capability', 'ask', 'confirm', 'cancel', 'reconcile'].includes(action) ? action : 'unknown';
  const started = Date.now();
  let logged = false;
  const log = (r: Obj) => {
    logged = true;
    console.info(JSON.stringify(r));
  };
  try {
    if (
      !nuniEnabled() ||
      process.env.CAMPUS_ASSISTANT_ENABLED !== 'true' ||
      process.env.CAMPUS_ASSISTANT_V2_ENABLED !== 'true'
    )
      throw new V2Error(404, 'NOT_FOUND');
    if (!['capability', 'ask', 'confirm', 'cancel', 'reconcile'].includes(action))
      throw new V2Error(404, 'NOT_FOUND');
    if (request.method !== (action === 'capability' ? 'GET' : 'POST'))
      throw new V2Error(405, 'METHOD_NOT_ALLOWED');
    if (request.nextUrl.search) throw new V2Error(400, 'INVALID_INPUT');
    if (request.method !== 'GET') requireSameOrigin(request);
    const session = requireSession(request);
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(55000)]);
    if (action === 'capability') {
      await createAdapter(session, 'pu', signal).principal();
      return jsonResponse({
        enabled: true,
        version: 2,
        ready: Boolean(process.env.GROQ_API_KEY || fallbackReady()),
        fallback: fallbackReady(),
        simulation: false,
      });
    }
    const raw = object(
      await boundedJson(request, 16384),
      action === 'ask'
        ? ['schoolId', 'conversationId', 'question', 'history', 'consent', 'preferredInstance', 'routeToken', 'planProtection']
        : ['schoolId', 'conversationId', 'token', 'args'],
    );
    const schoolId = id(raw.schoolId),
      conversationId = id(raw.conversationId);
    if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(schoolId) || schoolId === 'personal')
      throw new V2Error(422, 'INVALID_INPUT');
    const secret = process.env.BFF_SESSION_SECRET?.trim() || '';
    const target = action === 'reconcile' ? undefined : action === 'ask'
      ? raw.routeToken === undefined ? undefined : routeTarget(raw.routeToken, { session: sessionContext(session), conversationId, schoolId }, secret)
      : cardIssuer({ token: raw.token, args: raw.args }, secret);
    if (process.env.FLY_MACHINE_ID && target && target !== process.env.FLY_MACHINE_ID) {
      if (request.headers.has('fly-replay-failed')) throw new V2Error(409, 'CONFIRMATION_REVOKED');
      const response = jsonResponse({ error: 'INSTANCE_REPLAY_REQUIRED' }, 409);
      response.headers.set('fly-replay', `instance=${target}`);
      return response;
    }
    const source = createAdapter(session, schoolId, signal),
      principal = await source.principal();
    const binding = {
      account: principal.platformAccountId,
      session: sessionContext(session),
      conversationId,
      schoolId,
    };
    let protection: PlanProtection | undefined;
    if (action === 'ask') {
      if (raw.routeToken !== undefined) routeOwner(raw.routeToken, binding, secret);
      if (raw.planProtection !== undefined) {
        try {
          const input = object(raw.planProtection, ['originalEvents', 'protectedIndices']);
          protection = createPlanProtection(input.originalEvents, input.protectedIndices);
        } catch {
          throw new V2Error(422, 'INVALID_PLAN_PROTECTION');
        }
        if (protection.protectedIndices.length === protection.originalEvents.length)
          throw new V2Error(422, 'PLAN_ALREADY_PRESERVED');
      }
      // Missing credentials can only bootstrap a fresh server-generated binding.
      // They can never issue a replacement for a client-selected old binding.
      if (raw.routeToken === undefined) {
        if (raw.consent !== true) throw new V2Error(422, 'CONSENT_REQUIRED');
        text(raw.question, 1000);
        history(raw.history);
        const fresh = { ...binding, conversationId: randomUUID() };
        return jsonResponse({ bootstrap: true, conversationId: fresh.conversationId, routeToken: issueRoute(fresh, secret) });
      }
    }
    const writes = process.env.CAMPUS_ASSISTANT_V2_WRITES_ENABLED === 'true';
    if (action === 'cancel')
      return jsonResponse(
        await bounded(
          (child) => withOperationSignal(child, () =>
            revoke(binding, { token: raw.token, args: raw.args }, secret, Date.now(), source.adapter),
          ), signal, 12000,
        ),
      );
    if (action === 'reconcile')
      return jsonResponse(
        await bounded(
          (child) => withOperationSignal(child, () =>
            reconcile(binding, { token: raw.token, args: raw.args }, secret, Date.now(), source.adapter, writes),
          ), signal, 12000,
        ),
      );
    if (action === 'confirm')
      return jsonResponse(
        await bounded(
          (child) =>
            withOperationSignal(child, () =>
              confirm(
                binding,
                { token: raw.token, args: raw.args },
                secret,
                Date.now(),
                source.adapter,
                writes,
              ),
            ),
          signal,
          12000,
        ),
      );
    if (raw.consent !== true) throw new V2Error(422, 'CONSENT_REQUIRED');
    const question = text(raw.question, 1000),
      memory = history(raw.history);
    const key = hash(principal.platformAccountId),
      sessionKey = hash(session.sessionHandle);
    const now = Date.now();
    for (const [k, times] of hits) {
      if (!times.some((t) => t > now - 3600000)) hits.delete(k);
    }
    const recent = (hits.get(key) || []).filter((t) => t > now - 3600000);
    if (active.has(sessionKey)) throw new V2Error(429, 'ASSISTANT_BUSY', 5);
    if (recent.length >= 10 || recent.filter((t) => t > now - 60000).length >= 3)
      throw new V2Error(429, 'LOCAL_ACCOUNT_LIMIT', 60);
    hits.set(key, [...recent, now]);
    active.add(sessionKey);
    try {
      const result = await run({
        question,
        history: memory,
        binding,
        adapter: source.adapter,
        secret,
        writes,
        signal,
        planRevision: protection !== undefined,
        log,
        model: async (input) => {
          const amount =
            Buffer.byteLength(JSON.stringify({ messages: input.messages, tools: input.tools })) +
            input.max_completion_tokens +
            128;
          quota(Date.now(), amount);
          try {
            const result = await provider(input);
            tokens += result.usage.total_tokens - amount;
            dailyTokens += result.usage.total_tokens - amount;
            return result;
          } catch (error) {
            requests = Math.max(0, requests - 1);
            dailyRequests = Math.max(0, dailyRequests - 1);
            tokens = Math.max(0, tokens - amount);
            dailyTokens = Math.max(0, dailyTokens - amount);
            throw error;
          }
        },
      }).catch(error => {
        // A failed revision may already have issued internal cards.
        if (protection) beginProposal(binding, Date.now());
        throw error;
      });
      // A partial ordinary answer can be useful; a partial replacement would
      // silently drop intent. Reuse the tool's checked failure, never infer
      // conflicts from model prose or recompute a competing schedule policy.
      if (protection && (result.stopReason || result.steps.some(step => step.status === 'error'))) {
        const code = result.steps.some(step => step.status === 'error' && step.summary === 'EVENT_CONFLICT')
          ? 'PLAN_REVISION_TIME_CONFLICT' : 'PLAN_REVISION_INCOMPLETE';
        beginProposal(binding, Date.now());
        log({ event: 'assistant.failed', version: 2, stage, requestId, status: 422,
          errorClass: code, durationMs: Date.now() - started, simulation: false });
        throw new V2Error(422, code);
      }
      if (protection &&
        (!Array.isArray(result.cards) || result.cards.length === 0 || result.cards.some(card => card.tool !== 'propose_personal_event') ||
        !validatePlanProtection(protection, result.cards.map(card => card.args)).ok)) {
        // Retire the entire rejected candidate before returning any response.
        // Its signed arguments are never repaired or released to the caller.
        const code = protection.protectedIndices.length ? 'PLAN_PROTECTION_MISMATCH' : 'PLAN_REVISION_INCOMPLETE';
        beginProposal(binding, Date.now());
        log({ event: 'assistant.failed', version: 2, stage, requestId, status: 422,
          errorClass: code, durationMs: Date.now() - started, simulation: false });
        throw new V2Error(422, code);
      }
      return jsonResponse({
        ...result,
        ...(process.env.FLY_MACHINE_ID ? { issuer: machineId(process.env.FLY_MACHINE_ID) } : {}),
      });
    } finally {
      active.delete(sessionKey);
    }
  } catch (error) {
    const e = error as { status?: number; code?: string; retryAfter?: number };
    const status = e.status || 503,
      code = safeCode(error);
    if (!logged)
      log({
        event: 'assistant.failed',
        version: 2,
        stage,
        requestId,
        status,
        errorClass: code,
        durationMs: Date.now() - started,
        simulation: false,
      });
    const response = jsonResponse(
      {
        error: code,
        ...(PLAN_PROTECTION_MESSAGES[code]
          ? { message: PLAN_PROTECTION_MESSAGES[code] }
          : code === 'EVENT_START_PASSED'
          ? { message: '這個時段已經開始，請重新安排時間。' }
          : PROVIDER_USER_MESSAGES[code] ? { message: providerUserMessage(code) } : {}),
      },
      status,
    );
    if (e.retryAfter) response.headers.set('Retry-After', String(e.retryAfter));
    return response;
  } finally {
    if (!logged)
      log({
        event: 'assistant.completed',
        version: 2,
        stage,
        requestId,
        status: 200,
        durationMs: Date.now() - started,
        simulation: false,
      });
  }
}

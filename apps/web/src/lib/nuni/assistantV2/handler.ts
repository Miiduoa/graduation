import { withOperationSignal } from './operation';
import { randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';
import {
  boundedJson,
  jsonResponse,
  nuniEnabled,
  requireSameOrigin,
  requireSession,
  sessionContext,
} from '../server';
import { confirm, revoke } from './actions';
import { createAdapter } from './adapter';
import { bounded, hash, history, id, object, text, V2Error, type Obj } from './contracts';
import { groqModel } from './groq';
import { run, safeCode } from './runner';
const active = new Set<string>();
const hits = new Map<string, number[]>();
let minute = 0,
  requests = 0,
  tokens = 0,
  day = 0,
  dailyRequests = 0,
  dailyTokens = 0;
const provider = groqModel(process.env.GROQ_API_KEY);
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
  const stage = ['capability', 'ask', 'confirm', 'cancel'].includes(action) ? action : 'unknown';
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
    if (!['capability', 'ask', 'confirm', 'cancel'].includes(action))
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
        ready: Boolean(process.env.GROQ_API_KEY),
        simulation: false,
      });
    }
    const raw = object(
      await boundedJson(request, 16384),
      action === 'ask'
        ? ['schoolId', 'conversationId', 'question', 'history', 'consent']
        : ['schoolId', 'conversationId', 'token', 'args'],
    );
    const schoolId = id(raw.schoolId),
      conversationId = id(raw.conversationId);
    if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(schoolId) || schoolId === 'personal')
      throw new V2Error(422, 'INVALID_INPUT');
    const source = createAdapter(session, schoolId, signal),
      principal = await source.principal();
    const binding = {
      account: principal.platformAccountId,
      session: sessionContext(session),
      conversationId,
      schoolId,
    };
    const secret = process.env.BFF_SESSION_SECRET?.trim() || '';
    const writes = process.env.CAMPUS_ASSISTANT_V2_WRITES_ENABLED === 'true';
    if (action === 'cancel')
      return jsonResponse(
        revoke(binding, { token: raw.token, args: raw.args }, secret, Date.now()),
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
        log,
        model: async (input) => {
          const amount =
            Buffer.byteLength(JSON.stringify({ messages: input.messages, tools: input.tools })) +
            input.max_completion_tokens +
            128;
          quota(Date.now(), amount);
          const result = await provider(input);
          tokens += result.usage.total_tokens - amount;
          dailyTokens += result.usage.total_tokens - amount;
          return result;
        },
      });
      return jsonResponse(result);
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
    const response = jsonResponse({ error: code }, status);
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

import https from 'node:https';
import type { ClientRequest, IncomingMessage } from 'node:http';
import { NuniError } from '@campus/shared/src/nuni';
import { createPuRelayFetch, type FetchLike } from './puEdgeRelay';
import type { TronClassAssignment, TronClassHomeworkScope, TronClassSubmissionBinding } from './tronClassSubmissionSource';
import { buildTronClassNewSubmission, parseTronClassSubmissionAcknowledgment } from './tronClassSubmissionProtocol';

const ORIGIN = 'https://tronclass.pu.edu.tw';
const MAX_REQUEST_BYTES = 128 * 1024;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const TIMEOUT_MS = 15_000;
type RequestFn = (options: https.RequestOptions, callback: (response: IncomingMessage) => void) => ClientRequest;

/** Source-derived checks required by the controlled, text-only candidate. */
export type TronClassCandidateAuthorization = {
  binding: TronClassSubmissionBinding;
  assignment: TronClassAssignment;
  mode: 'normal';
  historyComplete: boolean;
  priorSubmissionIds: number[];
  userSubmitCount: number;
  ordinaryWindowConfirmed: boolean;
  prerequisitesConfirmed: boolean;
};

function fail(status: number, code: string): never { throw new NuniError(status, code); }
function invalid(): never { return fail(400, 'TRONCLASS_PROTOCOL_INVALID_INPUT'); }
function unconfirmed(): never { return fail(502, 'TRONCLASS_CANDIDATE_UNCONFIRMED'); }
const id = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

function checkedTarget(raw: string): URL {
  let url: URL;
  try { url = new URL(raw); } catch { return invalid(); }
  const match = /^\/api\/course\/activities\/([1-9]\d{0,15})\/submissions$/.exec(url.pathname);
  if (!match || !id(Number(match[1])) || raw !== `${ORIGIN}${url.pathname}`) return invalid();
  return url;
}

function checkedBody(body: RequestInit['body']): string {
  if (typeof body !== 'string' || Buffer.byteLength(body, 'utf8') > MAX_REQUEST_BYTES) return invalid();
  let data: Record<string, unknown>;
  try { data = JSON.parse(body); } catch { return invalid(); }
  const keys = ['comment', 'uploads', 'slides', 'is_draft', 'mode', 'other_resources', 'uploads_in_rich_text'];
  if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).length !== keys.length ||
    Object.keys(data).some(key => !keys.includes(key)) || typeof data.comment !== 'string' || !data.comment.trim() ||
    data.is_draft !== false || data.mode !== 'normal' ||
    !['uploads', 'slides', 'other_resources', 'uploads_in_rich_text'].every(key => Array.isArray(data[key]) && data[key].length === 0)) return invalid();
  return body;
}

function responseHeaders(input: IncomingMessage['headers']): Headers {
  const out = new Headers();
  // A candidate never updates the persisted session from a write response.
  for (const name of ['content-type', 'content-length', 'content-encoding']) {
    const value = input[name];
    if (value !== undefined) out.set(name, Array.isArray(value) ? value.join(', ') : value);
  }
  return out;
}

function checkedLength(headers: Headers): number | null {
  const raw = headers.get('content-length');
  if (raw === null) return null;
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) > MAX_RESPONSE_BYTES) return unconfirmed();
  return Number(raw);
}

/** Fixed POST endpoint, bounded buffering, no redirects or retries. */
export function createTronClassCandidateFetch(request: RequestFn = https.request): FetchLike {
  return (raw, init = {}) => new Promise((resolve, reject) => {
    let target: URL;
    let body: string;
    try {
      target = checkedTarget(raw);
      if (init.method !== 'POST' || init.redirect !== 'manual') invalid();
      body = checkedBody(init.body);
    } catch (error) { reject(error); return; }
    if (init.signal?.aborted) { reject(new NuniError(504, 'TRONCLASS_CANDIDATE_TIMEOUT')); return; }
    let req: ClientRequest | undefined;
    let settled = false;
    const finish = (error?: unknown, response?: Response) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      init.signal?.removeEventListener('abort', abort);
      if (error) { reject(error); req?.destroy(); }
      else resolve(response!);
    };
    const abort = () => finish(new NuniError(504, 'TRONCLASS_CANDIDATE_TIMEOUT'));
    const timer = setTimeout(abort, TIMEOUT_MS);
    timer.unref?.();
    try {
      const headers: Record<string, string> = {};
      new Headers(init.headers).forEach((value, key) => { headers[key] = value; });
      headers['content-length'] = String(Buffer.byteLength(body, 'utf8'));
      req = request({ protocol: 'https:', hostname: target.hostname, servername: target.hostname,
        family: 4, method: 'POST', path: target.pathname, headers }, upstream => {
        upstream.on('error', () => finish(new NuniError(502, 'TRONCLASS_CANDIDATE_UNCONFIRMED')));
        upstream.on('aborted', () => finish(new NuniError(502, 'TRONCLASS_CANDIDATE_UNCONFIRMED')));
        upstream.on('close', () => { if (!settled) finish(new NuniError(502, 'TRONCLASS_CANDIDATE_UNCONFIRMED')); });
        try {
          const status = upstream.statusCode ?? 0;
          const out = responseHeaders(upstream.headers);
          if (status !== 200 && status !== 201) {
            finish(undefined, new Response(null, { status, headers: out }));
            req?.destroy();
            return;
          }
          const expectedLength = checkedLength(out);
          let length = 0;
          const chunks: Buffer[] = [];
          upstream.on('data', (chunk: Buffer | Uint8Array) => {
            if (settled) return;
            length += chunk.byteLength;
            if (length > MAX_RESPONSE_BYTES) { finish(new NuniError(502, 'TRONCLASS_CANDIDATE_UNCONFIRMED')); return; }
            chunks.push(Buffer.from(chunk));
          });
          upstream.on('end', () => {
            if (settled) return;
            if (expectedLength !== null && expectedLength !== length) { finish(new NuniError(502, 'TRONCLASS_CANDIDATE_UNCONFIRMED')); return; }
            try { finish(undefined, new Response(Buffer.concat(chunks), { status, headers: out })); }
            catch { finish(new NuniError(502, 'TRONCLASS_CANDIDATE_UNCONFIRMED')); }
          });
        } catch { finish(new NuniError(502, 'TRONCLASS_CANDIDATE_UNCONFIRMED')); }
      });
      req.on('error', () => finish(new NuniError(502, 'TRONCLASS_CANDIDATE_UNCONFIRMED')));
      init.signal?.addEventListener('abort', abort, { once: true });
      if (init.signal?.aborted) { abort(); return; }
      req.write(body);
      req.end();
    } catch { finish(new NuniError(502, 'TRONCLASS_CANDIDATE_UNCONFIRMED')); }
  });
}

function headersFor(binding: TronClassSubmissionBinding): Headers {
  const pairs = Object.entries(binding.cookies);
  if (!pairs.length || pairs.length > 64) return invalid();
  const cookie = pairs.map(([key, value]) => {
    if (!/^[A-Za-z0-9!#$%&'*+.^_|~-]{1,128}$/.test(key) || typeof value !== 'string' ||
      !/^[\x21-\x7e]*$/.test(value) || /[;\\",]/.test(value)) return invalid();
    return `${key}=${value}`;
  }).join('; ');
  if (cookie.length > 32 * 1024) return invalid();
  const headers = new Headers({ Cookie: cookie, Accept: 'application/json', 'Content-Type': 'application/json',
    'Accept-Encoding': 'identity', Origin: ORIGIN, Referer: `${ORIGIN}/` });
  // Only the publicly documented Angular default is implemented. The caller
  // must verify this policy on the controlled tenant; absence is not approval.
  const rawToken = binding.cookies['XSRF-TOKEN'];
  if (!rawToken) fail(503, 'TRONCLASS_CANDIDATE_CSRF_UNVERIFIED');
  let token: string;
  try { token = decodeURIComponent(rawToken); } catch { return invalid(); }
  if (!token || token.length > 4096 || !/^[\x21-\x7e]+$/.test(token)) return invalid();
  headers.set('X-XSRF-TOKEN', token);
  return headers;
}

function checkedAuthorization(value: TronClassCandidateAuthorization, scope: TronClassHomeworkScope, now: number) {
  if (!Number.isFinite(now)) fail(503, 'TRONCLASS_CANDIDATE_UNCONFIRMED');
  const binding = value?.binding;
  const assignment = value?.assignment;
  if (!binding || binding.schoolId !== 'pu' || !id(binding.userId) || !/^[a-f0-9]{32}$/.test(binding.revision) ||
    !Number.isFinite(Date.parse(binding.expiresAt)) || Date.parse(binding.expiresAt) <= now) fail(401, 'TRONCLASS_RECONNECT_REQUIRED');
  if (!assignment || assignment.courseId !== scope.courseId || assignment.homeworkId !== scope.homeworkId ||
    assignment.studentId !== binding.userId || assignment.permissionKnown !== true || assignment.individual !== true ||
    assignment.canSubmit !== true || assignment.isClosed !== false || assignment.allowsText !== true ||
    (assignment.remainingAttempts !== null && (!Number.isSafeInteger(assignment.remainingAttempts) || assignment.remainingAttempts <= 0)) ||
    value.mode !== 'normal' || value.historyComplete !== true || !Array.isArray(value.priorSubmissionIds) ||
    value.priorSubmissionIds.length !== 0 || value.userSubmitCount !== 0 ||
    value.ordinaryWindowConfirmed !== true || value.prerequisitesConfirmed !== true) fail(409, 'TRONCLASS_SUBMISSION_BLOCKED');
  for (const [at, before] of [[assignment.opensAt, true], [assignment.deadline, false]] as const) {
    if (at !== null && (!Number.isFinite(Date.parse(at)) || (before ? Date.parse(at) > now : Date.parse(at) < now))) {
      fail(409, 'TRONCLASS_SUBMISSION_BLOCKED');
    }
  }
}

async function readJson(response: Response, signal: AbortSignal): Promise<unknown> {
  const type = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  const encoding = response.headers.get('content-encoding');
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const cancel = () => { void reader?.cancel().catch(() => {}); };
  try {
    if (!response.body || type !== 'application/json' || (encoding && encoding !== 'identity')) return unconfirmed();
    const expectedLength = checkedLength(response.headers);
    reader = response.body.getReader();
    signal.addEventListener('abort', cancel, { once: true });
    let length = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      if (signal.aborted) fail(504, 'TRONCLASS_CANDIDATE_TIMEOUT');
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > MAX_RESPONSE_BYTES) return unconfirmed();
      chunks.push(next.value);
    }
    if (expectedLength !== null && expectedLength !== length) return unconfirmed();
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return unconfirmed(); }
  } finally {
    signal.removeEventListener('abort', cancel);
    if (reader) { void reader.cancel().catch(() => {}); reader.releaseLock(); }
    else void response.body?.cancel().catch(() => {});
  }
}

/**
 * Controlled verification only; no public route or default provider uses this.
 * A real authorization reader and durable operation claim are still required
 * before integrating it. An acknowledgment is never a submission receipt.
 */
export function createTronClassTextSubmissionCandidate(dependencies: {
  enabled?: () => boolean;
  authorize: (ownerKey: string, scope: TronClassHomeworkScope) => Promise<TronClassCandidateAuthorization>;
  assertCurrent: (ownerKey: string, revision: string) => Promise<void>;
  fetch?: FetchLike;
  now?: () => number;
  timeoutMs?: number;
}) {
  const enabled = dependencies.enabled ?? (() => false);
  const now = dependencies.now ?? Date.now;
  const fetchSchool = dependencies.fetch ?? createPuRelayFetch({ directFetch: createTronClassCandidateFetch() });
  const timeoutMs = dependencies.timeoutMs ?? TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 30_000) invalid();
  let attempted = false;
  return Object.freeze({
    contractVerified: false as const,
    async dispatch(ownerKey: string, input: TronClassHomeworkScope & { content: string }, signal?: AbortSignal) {
      if (!enabled()) fail(503, 'TRONCLASS_CANDIDATE_DISABLED');
      if (attempted) fail(409, 'TRONCLASS_CANDIDATE_ALREADY_DISPATCHED');
      if (typeof ownerKey !== 'string' || !ownerKey || ownerKey.length > 300 || !input || !id(input.courseId) || !id(input.homeworkId) ||
        Object.keys(input).some(key => !['courseId', 'homeworkId', 'content'].includes(key))) invalid();
      const scope = Object.freeze({ courseId: input.courseId, homeworkId: input.homeworkId });
      const request = buildTronClassNewSubmission({ activityId: scope.homeworkId, content: input.content, uploadIds: [] });
      const body = checkedBody(JSON.stringify(request.body));
      const controller = new AbortController();
      const abort = () => controller.abort();
      const timedOut = () => new NuniError(504, 'TRONCLASS_CANDIDATE_TIMEOUT');
      let rejectDeadline: (() => void) | undefined;
      const deadline = new Promise<never>((_, reject) => {
        rejectDeadline = () => reject(timedOut());
        controller.signal.addEventListener('abort', rejectDeadline, { once: true });
      });
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) controller.abort();
      const timer = setTimeout(abort, timeoutMs);
      const checkCancelled = () => { if (controller.signal.aborted) throw timedOut(); };
      const operation = async () => {
        checkCancelled();
        const authorization = await dependencies.authorize(ownerKey, scope);
        checkCancelled();
        checkedAuthorization(authorization, scope, now());
        // Capture the checked identity and source rules before the next await.
        const binding = { ...authorization.binding, cookies: { ...authorization.binding.cookies } };
        const checked = { ...authorization, binding,
          assignment: { ...authorization.assignment, allowedContentTypes: [...authorization.assignment.allowedContentTypes] },
          priorSubmissionIds: [...authorization.priorSubmissionIds] };
        const headers = headersFor(binding);
        await dependencies.assertCurrent(ownerKey, binding.revision);
        checkCancelled();
        if (!enabled()) fail(503, 'TRONCLASS_CANDIDATE_DISABLED');
        // Reaching the deadline during an awaited identity check must not send
        // an ordinary-window request using an earlier eligibility decision.
        checkedAuthorization(checked, scope, now());
        // Concurrent calls on this candidate cannot both dispatch after await.
        if (attempted) fail(409, 'TRONCLASS_CANDIDATE_ALREADY_DISPATCHED');
        attempted = true;
        const response = await fetchSchool(`${ORIGIN}${request.schoolPath}`, {
          method: request.method, body, headers, redirect: 'manual', cache: 'no-store', signal: controller.signal,
        });
        checkCancelled();
        if (response.status !== 200 && response.status !== 201) {
          void response.body?.cancel().catch(() => {});
          if (response.status === 401 || response.status === 403) fail(401, 'TRONCLASS_RECONNECT_REQUIRED');
          return unconfirmed();
        }
        const raw = await readJson(response, controller.signal);
        checkCancelled();
        await dependencies.assertCurrent(ownerKey, binding.revision);
        checkCancelled();
        return parseTronClassSubmissionAcknowledgment(raw, {
          courseId: scope.courseId, activityId: scope.homeworkId, studentId: binding.userId, priorSubmissionIds: [],
        });
      };
      try { return await Promise.race([operation(), deadline]); }
      catch (error) {
        controller.abort();
        if (error instanceof NuniError) throw error;
        return unconfirmed();
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        if (rejectDeadline) controller.signal.removeEventListener('abort', rejectDeadline);
      }
    },
  });
}

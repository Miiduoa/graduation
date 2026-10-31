import { createHash } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { NuniError, parseNuniPrincipal } from '@campus/shared/src/nuni';
import { buildPersonalImportAiPrompt } from '@campus/shared/src/imports/aiRecognition';
import { isPersonalImportCloudInputMasked, isPersonalImportCloudMaskSafe, maskPersonalImportCloudInput, PERSONAL_IMPORT_CLOUD_MAX_TEXT } from '@campus/shared/src/imports/aiCloud';
import type { PersonalImportOptions } from '@campus/shared/src/imports/types';
import { boundedJson, platformRequest, readPlatformAuthorization, requireSameOrigin, requireSession, type PlatformSession } from '../nuni/server';
import { getFirebaseAdmin } from './firebaseAdmin';

export const PERSONAL_IMPORT_CLOUD_DAILY_LIMIT = 60;
export const PERSONAL_IMPORT_CLOUD_GLOBAL_DAILY_LIMIT = 2_000;
export const PERSONAL_IMPORT_CLOUD_ACCOUNT_MINUTE_LIMIT = 10;
const RATE_WINDOW_MS = 60_000;
export const PERSONAL_IMPORT_CLOUD_SERVER_TIMEOUT_MS = 20_000;
export const PERSONAL_IMPORT_CLOUD_MODEL = '@cf/qwen/qwen3-30b-a3b-fp8';

type QuotaReference = { path: string };
type QuotaStore = {
  doc: (path: string) => QuotaReference;
  runTransaction: <T>(fn: (transaction: {
    get: (ref: QuotaReference) => Promise<{ data: () => Record<string, unknown> | undefined }>;
    set: (ref: QuotaReference, data: Record<string, unknown>) => unknown;
  }) => Promise<T>) => Promise<T>;
};
type CloudConfig = { accountId: string; token: string };
type QuotaLimits = { globalDaily: number; accountMinute: number };
export type PersonalImportCloudDependencies = {
  config?: CloudConfig;
  getQuotaStore?: () => Promise<QuotaStore | null>;
  verifySession?: (session: PlatformSession, signal: AbortSignal) => Promise<unknown>;
  fetcher?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
};

const response = (status: number, body: unknown, extra: Record<string, string> = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store, private', Vary: 'Cookie, X-Campus-Session, Authorization', ...extra },
});

function configuredLimit(value: string | undefined, fallback: number): number {
  if (!value?.trim() || !/^\d+$/u.test(value.trim())) return fallback;
  const limit = Number(value);
  return Number.isSafeInteger(limit) ? limit : fallback;
}

export async function reservePersonalImportCloudQuota(db: QuotaStore, principal: string, now: number, limits: QuotaLimits = {
  globalDaily: PERSONAL_IMPORT_CLOUD_GLOBAL_DAILY_LIMIT,
  accountMinute: PERSONAL_IMPORT_CLOUD_ACCOUNT_MINUTE_LIMIT,
}): Promise<boolean> {
  const day = new Date(now + 8 * 3600_000).toISOString().slice(0, 10);
  const id = createHash('sha256').update(`personal-import:${principal}`).digest('hex');
  const reference = db.doc(`_personalImportAiUsage/${id}`);
  const globalReference = db.doc('_personalImportAiUsage/_global');
  return db.runTransaction(async (transaction) => {
    const previous = (await transaction.get(reference)).data();
    const globalPrevious = (await transaction.get(globalReference)).data();
    // 跨午夜延遲完成的舊請求不得把新一天的計數覆寫回去。
    if ([previous, globalPrevious].some((value) => typeof value?.day === 'string' && value.day > day)) return false;
    const used = previous?.day === day ? previous.count : 0;
    const globalUsed = globalPrevious?.day === day ? globalPrevious.count : 0;
    // 損壞的計數不能重設成零，以免繞過當日上限。
    if (typeof used !== 'number' || !Number.isSafeInteger(used) || used < 0 || used >= PERSONAL_IMPORT_CLOUD_DAILY_LIMIT) return false;
    if (typeof globalUsed !== 'number' || !Number.isSafeInteger(globalUsed) || globalUsed < 0 || globalUsed >= limits.globalDaily) return false;
    // 舊文件可能尚無短期計數；已有欄位損壞或時間倒退時停止雲端呼叫。
    const timestamps = previous?.timestamps === undefined ? [] : previous.timestamps;
    if (!Array.isArray(timestamps) || timestamps.length > PERSONAL_IMPORT_CLOUD_DAILY_LIMIT ||
      timestamps.some((value) => typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > now)) return false;
    const recent = (timestamps as number[]).filter((value) => value > now - RATE_WINDOW_MS);
    if (recent.length >= Math.min(limits.accountMinute, PERSONAL_IMPORT_CLOUD_DAILY_LIMIT)) return false;
    transaction.set(reference, { day, count: used + 1, timestamps: [...recent, now] });
    transaction.set(globalReference, { day, count: globalUsed + 1 });
    return true;
  });
}

function outputSchema() {
  const strings = ['title', 'academicYear', 'semester', 'courseCode', 'teacher', 'className', 'location', 'periodLabel', 'startTime', 'endTime', 'grade', 'date', 'endDate'];
  return {
    type: 'object', additionalProperties: false, required: ['complete', 'rows'],
    properties: {
      complete: { type: 'boolean' },
      rows: { type: 'array', maxItems: 80, items: {
        type: 'object', additionalProperties: false, required: ['title', 'evidence', 'uncertainFields'],
        properties: {
          ...Object.fromEntries(strings.map((name) => [name, { type: ['string', 'null'] }])),
          dayOfWeek: { type: ['integer', 'null'], minimum: 1, maximum: 7 },
          startPeriod: { type: ['string', 'null'] }, endPeriod: { type: ['string', 'null'] },
          credits: { type: ['number', 'null'] }, allDay: { type: ['boolean', 'null'] },
          evidence: { type: 'string' }, uncertainFields: { type: 'array', items: { type: 'string' } },
        },
      } },
    },
  };
}

function modelOutput(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const envelope = value as Record<string, unknown>;
  if (envelope.success === false || !envelope.result || typeof envelope.result !== 'object') return null;
  const result = envelope.result as Record<string, unknown>;
  let output = result.response;
  // 部分模型採用 chat.completion 外層；只讀 content，不讀 reasoning_content。
  if (output === undefined && Array.isArray(result.choices)) {
    const choice = result.choices[0] as { message?: { content?: unknown } } | undefined;
    output = choice?.message?.content;
  }
  const raw = typeof output === 'string' ? output : output && typeof output === 'object' ? JSON.stringify(output) : '';
  return raw.trim() && raw.length <= 80_000 ? raw : null;
}

export async function handlePersonalImportCloud(request: NextRequest, dependencies: PersonalImportCloudDependencies = {}): Promise<Response> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  request.signal.addEventListener('abort', cancel, { once: true });
  if (request.signal.aborted) controller.abort();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<Response>((resolve) => {
    timer = setTimeout(() => { controller.abort(); resolve(response(504, { code: 'timeout', message: '雲端整理逾時，請改用本機整理。' })); }, dependencies.timeoutMs ?? PERSONAL_IMPORT_CLOUD_SERVER_TIMEOUT_MS);
  });
  const operation = async (): Promise<Response> => {
    try {
      if (request.method !== 'POST') return response(405, { code: 'invalid-input' });
      const nativeSession = readPlatformAuthorization(request);
      if (!nativeSession) requireSameOrigin(request);
      const session = nativeSession ?? requireSession(request);
      const principal = parseNuniPrincipal(await (dependencies.verifySession ?? ((current) => platformRequest('sessions/current', current)))(session, controller.signal));
      if (controller.signal.aborted) return response(504, { code: 'timeout' });
      const config = dependencies.config ?? { accountId: process.env.CF_AI_ACCOUNT_ID?.trim() ?? '', token: process.env.CF_AI_API_TOKEN?.trim() ?? '' };
      if (!config.accountId || !config.token) return response(503, { code: 'disabled', message: '雲端整理尚未啟用。' });
      const raw = await boundedJson(request, 48_000);
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return response(422, { code: 'invalid-input' });
      const input = raw as Record<string, unknown>;
      if (Object.keys(input).some((key) => !['text', 'kind', 'columnContext'].includes(key)) ||
        typeof input.text !== 'string' || !input.text.trim() ||
        !['timetable', 'grades', 'events'].includes(String(input.kind)) ||
        (input.columnContext !== undefined && typeof input.columnContext !== 'string')) return response(422, { code: 'invalid-input' });
      const context = typeof input.columnContext === 'string' ? input.columnContext : '';
      if (input.text.length + context.length > PERSONAL_IMPORT_CLOUD_MAX_TEXT) return response(413, { code: 'invalid-input' });
      if (!isPersonalImportCloudMaskSafe(input.text, context)) return response(422, { code: 'invalid-input', message: '這份表格無法安全遮罩個資，請改用本機整理。' });
      const { sourceText, columnContext } = maskPersonalImportCloudInput(input.text, context);
      if (!isPersonalImportCloudInputMasked(sourceText, columnContext)) return response(422, { code: 'invalid-input' });
      if (sourceText.length + columnContext.length > PERSONAL_IMPORT_CLOUD_MAX_TEXT) return response(413, { code: 'invalid-input' });
      const db = await (dependencies.getQuotaStore ?? (async () => (await getFirebaseAdmin())?.db as unknown as QuotaStore ?? null))();
      if (!db) return response(503, { code: 'unavailable', message: '雲端整理暫時無法使用。' });
      if (controller.signal.aborted) return response(504, { code: 'timeout' });
      const limits = {
        globalDaily: configuredLimit(process.env.PERSONAL_IMPORT_CLOUD_GLOBAL_DAILY_LIMIT, PERSONAL_IMPORT_CLOUD_GLOBAL_DAILY_LIMIT),
        accountMinute: configuredLimit(process.env.PERSONAL_IMPORT_CLOUD_ACCOUNT_MINUTE_LIMIT, PERSONAL_IMPORT_CLOUD_ACCOUNT_MINUTE_LIMIT),
      };
      if (!await reservePersonalImportCloudQuota(db, principal.platformAccountId, (dependencies.now ?? Date.now)(), limits)) return response(429, { code: 'quota', message: '雲端整理已達使用上限，請改用本機整理。' }, { 'Retry-After': '60' });
      if (controller.signal.aborted) return response(504, { code: 'timeout' });
      const prompt = [
        buildPersonalImportAiPrompt(sourceText, { kind: input.kind as PersonalImportOptions['kind'], schoolId: 'personal', academicYear: '', semester: '' }),
        '標記為「已遮罩」的值不得當作姓名或課程資料。只輸出指定 JSON，不輸出推理過程。 /no_think',
        ...(columnContext ? ['下方只提供欄名與表格脈絡，不新增資料列；evidence 仍只能引用 SOURCE_DATA。', `COLUMN_CONTEXT_DATA=${JSON.stringify(columnContext)}`] : []),
      ].join('\n');
      const upstream = await (dependencies.fetcher ?? fetch)(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(config.accountId)}/ai/run/${PERSONAL_IMPORT_CLOUD_MODEL}`, {
        method: 'POST', redirect: 'error', cache: 'no-store', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.token}` },
        body: JSON.stringify({ messages: [{ role: 'user', content: prompt }], stream: false, max_tokens: 4096, temperature: 0, response_format: { type: 'json_schema', json_schema: outputSchema() } }),
      });
      if (!upstream.ok) {
        void upstream.body?.cancel().catch(() => {});
        return response(upstream.status === 429 ? 429 : 503, { code: upstream.status === 429 ? 'quota' : 'unavailable' });
      }
      const output = modelOutput(await boundedJson(upstream, 384_000));
      return output ? response(200, { provider: 'cloud', output, sourceText, columnContext }) : response(502, { code: 'unavailable' });
    } catch (error) {
      if (controller.signal.aborted) return response(504, { code: 'timeout' });
      if (error instanceof NuniError && [401, 403, 409].includes(error.status)) return response(error.status, { code: 'unauthenticated', message: '請登入後再使用雲端整理。' });
      if (error instanceof NuniError && error.status === 413) return response(413, { code: 'invalid-input' });
      return response(503, { code: 'unavailable', message: '雲端整理暫時無法使用。' });
    }
  };
  try { return await Promise.race([operation(), deadline]); }
  finally { clearTimeout(timer); request.signal.removeEventListener('abort', cancel); }
}

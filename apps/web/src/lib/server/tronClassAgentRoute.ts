import type { NextRequest } from 'next/server';
import { NuniError } from '@campus/shared/src/nuni';
import { boundedJson } from '../nuni/server';
import { createTronClassAgentService, type TronClassAgentDependencies } from './tronClassAgent';
import { authenticateTronClassActor } from './tronClassIntegrationAuth';
import { createUidRateLimiter } from './uidRateLimit';

export type TronClassAgentRouteDependencies = Omit<TronClassAgentDependencies, 'beforeResult'> & {
  authenticate?: typeof authenticateTronClassActor;
  rateLimit?: (ownerKey: string) => void;
};

const requestLimiter = createUidRateLimiter({ requestsPerMinute: 30 });
const readLimiter = createUidRateLimiter({ requestsPerMinute: 6 });
const MESSAGES: Record<string, string> = {
  SIGN_IN_REQUIRED: '請先登入 nuni，再讓 Agent 處理 TronClass 資料。',
  SESSION_CHANGED: '登入帳號已變更，請重新開啟對話。',
  TRONCLASS_NOT_CONNECTED: '請先連接你的 TronClass 帳號。',
  TRONCLASS_RECONNECT_REQUIRED: 'TronClass 登入已到期，請重新連線。',
  TRONCLASS_BINDING_CHANGED: 'TronClass 連線已變更，請重新查詢。',
  TRONCLASS_AGENT_PERMISSION_REQUIRED: '請先開啟這項 TronClass Agent 權限，再重新提出請求。',
  TRONCLASS_AGENT_PERMISSION_CHANGED: 'Agent 權限已變更，這次結果未顯示；請重新查詢。',
  TRONCLASS_COURSE_NOT_FOUND: '目前帳號無法讀取這門課，請重新選擇。',
  TRONCLASS_HOMEWORK_NOT_FOUND: '目前帳號無法確認這份作業，請重新選擇。',
  TRONCLASS_READ_TIMEOUT: 'TronClass 回應較慢，請稍後重新查詢。',
  TRONCLASS_DISABLED: 'TronClass 連線目前暫停，請稍後再試。',
  TRONCLASS_INVALID_INPUT: '請以 TronClass 課程、作業、公告或教材提出查詢，再選擇對應項目。',
};

function response(status: number, value: unknown) {
  return new Response(JSON.stringify(value), { status, headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, private',
    Vary: 'Cookie, X-Campus-Session, Authorization',
    'X-Content-Type-Options': 'nosniff',
  } });
}
function only(input: Record<string, unknown>, keys: string[]) {
  if (Object.keys(input).some((key) => !keys.includes(key))) throw new NuniError(422, 'TRONCLASS_INVALID_INPUT');
}
function id(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) throw new NuniError(422, 'TRONCLASS_INVALID_INPUT');
  return value;
}

export async function handleTronClassAgent(request: NextRequest, dependencies: TronClassAgentRouteDependencies = {}): Promise<Response> {
  try {
    if (process.env.TRONCLASS_INTEGRATION_ENABLED === 'false') throw new NuniError(503, 'TRONCLASS_DISABLED');
    if (request.method !== 'POST') throw new NuniError(405, 'METHOD_NOT_ALLOWED');
    const authenticate = dependencies.authenticate ?? authenticateTronClassActor;
    const actor = await authenticate(request);
    (dependencies.rateLimit ?? requestLimiter.check)(actor.ownerKey);
    if (request.nextUrl.search || request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
      throw new NuniError(422, 'TRONCLASS_INVALID_INPUT');
    }
    const body = await boundedJson(request, 8 * 1024);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new NuniError(422, 'TRONCLASS_INVALID_INPUT');
    const input = body as Record<string, unknown>;
    const service = createTronClassAgentService({ ...dependencies, beforeResult: async () => {
      const current = await authenticate(request);
      if (current.ownerKey !== actor.ownerKey || current.provider !== actor.provider) throw new NuniError(409, 'SESSION_CHANGED');
      if (request.signal.aborted) throw new NuniError(503, 'TRONCLASS_READ_TIMEOUT');
    } });
    let result: unknown;
    switch (input.action) {
      case 'capability':
        only(input, ['action']);
        result = await service.capability(actor.ownerKey);
        break;
      case 'ask': {
        only(input, ['action', 'question', 'courseId', 'homeworkId']);
        if (typeof input.question !== 'string' || !input.question.trim() || input.question.length > 1000) throw new NuniError(422, 'TRONCLASS_INVALID_INPUT');
        if (!dependencies.rateLimit) readLimiter.check(actor.ownerKey);
        result = await service.ask(actor.ownerKey, { question: input.question,
          ...(input.courseId === undefined ? {} : { courseId: id(input.courseId) }),
          ...(input.homeworkId === undefined ? {} : { homeworkId: id(input.homeworkId) }),
        });
        break;
      }
      case 'prepare':
        only(input, ['action', 'courseId', 'homeworkId']);
        if (!dependencies.rateLimit) readLimiter.check(actor.ownerKey);
        result = await service.prepare(actor.ownerKey, { courseId: id(input.courseId), homeworkId: id(input.homeworkId) });
        break;
      default: throw new NuniError(422, 'TRONCLASS_INVALID_INPUT');
    }
    return response(200, result);
  } catch (error) {
    const limited = error && typeof error === 'object' && 'code' in error && error.code === 'resource-exhausted';
    const status = error instanceof NuniError ? error.status : limited ? 429 : 503;
    const candidate = error instanceof NuniError ? error.code : limited ? 'TRONCLASS_RATE_LIMITED' : 'TRONCLASS_AGENT_UNAVAILABLE';
    const code = /^[A-Z][A-Z0-9_]{0,99}$/.test(candidate) ? candidate : 'TRONCLASS_AGENT_UNAVAILABLE';
    return response(status, { error: code, message: MESSAGES[code] ?? (status === 429 ? 'Agent 查詢過於頻繁，請稍後再試。'
      : status === 401 ? '登入已到期，請重新登入或連接 TronClass。' : '目前無法完成這項 TronClass 請求，請稍後再試。') });
  }
}

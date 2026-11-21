import type { NextRequest } from 'next/server';
import { NuniError } from '@campus/shared/src/nuni';
import type { TronClassAgentPermissions } from '@campus/shared/src/tronClassAgentPermissions';
import { boundedJson } from '../nuni/server';
import { authenticateTronClassActor } from './tronClassIntegrationAuth';
import { createTronClassAgentGrantService, type TronClassAgentGrantService } from './tronClassAgentGrants';
import { createUidRateLimiter } from './uidRateLimit';

const limiter = createUidRateLimiter({ requestsPerMinute: 30 });
const messages: Record<string, string> = {
  SIGN_IN_REQUIRED: '請先登入 nuni，再設定 Agent 的 TronClass 權限。',
  SESSION_CHANGED: '登入帳號已變更，請重新開啟設定。',
  ORIGIN_REJECTED: '請從 nuni 頁面重新操作。',
  TRONCLASS_DISABLED: 'TronClass 連線目前暫停，請稍後再試。',
  TRONCLASS_BINDING_CHANGED: 'TronClass 連線已變更，請重新確認授權。',
  TRONCLASS_RECONNECT_REQUIRED: '請重新連接 TronClass，再設定 Agent 權限。',
  TRONCLASS_AGENT_PERMISSION_CHANGED: 'Agent 權限已更新，請重新讀取設定後再操作。',
  TRONCLASS_AGENT_PERMISSION_REQUIRED: '請先授權 Agent 使用這項 TronClass 功能。',
  TRONCLASS_INVALID_INPUT: '授權設定格式不正確，請重新確認。',
  BODY_TOO_LARGE: '授權設定超過大小限制。',
};

function response(status: number, value: unknown): Response {
  return new Response(JSON.stringify(value), { status, headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, private',
    Vary: 'Cookie, X-Campus-Session, Authorization',
    'X-Content-Type-Options': 'nosniff',
  } });
}

export async function handleTronClassAgentPermissions(request: NextRequest, dependencies: {
  authenticate?: typeof authenticateTronClassActor;
  grants?: TronClassAgentGrantService;
  rateLimit?: (ownerKey: string) => void;
} = {}): Promise<Response> {
  try {
    if (process.env.TRONCLASS_INTEGRATION_ENABLED === 'false') throw new NuniError(503, 'TRONCLASS_DISABLED');
    if (request.method !== 'POST') return response(405, { error: 'METHOD_NOT_ALLOWED' });
    const authenticate = dependencies.authenticate ?? authenticateTronClassActor;
    const actor = await authenticate(request);
    (dependencies.rateLimit ?? limiter.check)(actor.ownerKey);
    if (request.nextUrl.search || request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
      throw new NuniError(422, 'TRONCLASS_INVALID_INPUT');
    }
    const value = await boundedJson(request, 8 * 1024);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new NuniError(422, 'TRONCLASS_INVALID_INPUT');
    const input = value as Record<string, unknown>;
    const grants = dependencies.grants ?? createTronClassAgentGrantService();
    const keys = input.action === 'status' ? ['action'] : ['action', 'revision', 'expectedVersion', 'permissions'];
    if (Object.keys(input).some((key) => !keys.includes(key))) throw new NuniError(422, 'TRONCLASS_INVALID_INPUT');
    let result;
    if (input.action === 'status') result = await grants.get(actor.ownerKey);
    else if (input.action === 'set') result = await grants.set(actor.ownerKey, {
      revision: input.revision as string, expectedVersion: input.expectedVersion as string | null,
      permissions: input.permissions as TronClassAgentPermissions,
    });
    else throw new NuniError(422, 'TRONCLASS_INVALID_INPUT');
    const current = await authenticate(request);
    if (current.ownerKey !== actor.ownerKey || current.provider !== actor.provider) throw new NuniError(409, 'SESSION_CHANGED');
    return response(200, result);
  } catch (error) {
    const limited = !!error && typeof error === 'object' && 'code' in error && error.code === 'resource-exhausted';
    const status = error instanceof NuniError ? error.status : limited ? 429 : 503;
    const rawCode = error instanceof NuniError ? error.code : limited ? 'TRONCLASS_RATE_LIMITED' : 'TRONCLASS_AGENT_UNAVAILABLE';
    const code = /^[A-Z][A-Z0-9_]{0,99}$/.test(rawCode) ? rawCode : 'TRONCLASS_AGENT_UNAVAILABLE';
    const message = messages[code] ?? (status === 429 ? '設定操作過於頻繁，請稍後再試。'
      : status === 401 || status === 403 ? '目前無法使用這個登入設定權限。'
      : '暫時無法更新 Agent 權限，請稍後再試。');
    return response(status, { error: code, message });
  }
}

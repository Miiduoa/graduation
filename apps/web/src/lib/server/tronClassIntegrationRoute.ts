import type { NextRequest } from 'next/server';
import { NuniError } from '@campus/shared/src/nuni';
import { boundedBytes, boundedJson } from '../nuni/server';
import { authenticateTronClassActor } from './tronClassIntegrationAuth';
import { createTronClassBindingService } from './tronClassBinding';
import { createTronClassIntegrationReader } from './tronClassIntegrationSource';
import { getDefaultTronClassSubmissionService } from './tronClassSubmission';
import { createUidRateLimiter } from './uidRateLimit';

type Bindings = ReturnType<typeof createTronClassBindingService>;
type Submissions = Awaited<ReturnType<typeof getDefaultTronClassSubmissionService>>;

export type TronClassRouteDependencies = {
  authenticate?: typeof authenticateTronClassActor;
  bindings?: Bindings;
  read?: ReturnType<typeof createTronClassIntegrationReader>;
  submissions?: () => Promise<Submissions>;
  rateLimit?: (ownerKey: string) => void;
};

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ID = /^[A-Za-z0-9_-]{16,80}$/;
// Leave room for four uploads, the final confirmation, and receipt reconciliation.
// School login has its own durable owner/account limit in the binding service.
const requestLimiter = createUidRateLimiter({ requestsPerMinute: 60 });
const syncLimiter = createUidRateLimiter({ requestsPerMinute: 6 });
const ERROR_MESSAGES: Record<string, string> = {
  SIGN_IN_REQUIRED: '請先登入 nuni，再連接你的 TronClass 帳號。',
  SESSION_CHANGED: '登入帳號已變更，請重新開啟此頁。',
  ORIGIN_REJECTED: '請從 nuni 頁面重新操作。',
  TRONCLASS_DISABLED: 'TronClass 連線目前暫停，請稍後再試。',
  TRONCLASS_INVALID_INPUT: '資料格式不正確，請重新確認。',
  TRONCLASS_BINDING_CHANGED: 'TronClass 連線已變更，請重新讀取後再操作。',
  TRONCLASS_RECONNECT_REQUIRED: 'TronClass 登入已到期，請重新連線。',
  TRONCLASS_NOT_CONNECTED: '請先連接你的 TronClass 帳號。',
  TRONCLASS_COURSE_NOT_FOUND: '目前帳號無法開啟這門課，請重新整理課程清單。',
  TRONCLASS_READ_TIMEOUT: 'TronClass 回應較慢，請稍後重新整理。',
  TRONCLASS_SOURCE_UNAVAILABLE: '暫時無法讀取 TronClass，已準備的內容仍保留在這個頁面。',
  TRONCLASS_INVALID_SOURCE: '這次取得的課程資料不完整，請稍後重新整理。',
  TRONCLASS_WRITE_DISABLED: '這份作業目前需到 TronClass 原頁繳交。',
  TRONCLASS_WRITES_DISABLED: '這份作業目前需到 TronClass 原頁繳交。',
  TRONCLASS_SUBMISSION_UNAVAILABLE: '目前無法核對 TronClass 的繳交方式，請使用原作業頁。',
  TRONCLASS_SUBMISSION_IN_PROGRESS: '已有送交紀錄需要確認，請先查詢繳交狀態。',
  TRONCLASS_SUBMISSION_NOT_STARTED: '這筆作業尚未送出，請重新核對後再操作。',
  TRONCLASS_SUBMISSION_NOT_FOUND: '尚未找到這筆送交紀錄，請先到 TronClass 確認繳交狀態。',
  TRONCLASS_UPLOAD_UNCONFIRMED: '附件尚未全部上傳，作業沒有送出。',
  TRONCLASS_SUBMISSION_BLOCKED: '目前無法送交這份作業，請重新讀取作業規則。',
  TRONCLASS_RATE_LIMITED: '連線嘗試過於頻繁，請稍後再試。',
  TRONCLASS_LOGIN_RATE_LIMITED: '連線嘗試過於頻繁，請於 15 分鐘後再試。',
  TRONCLASS_LOGIN_FAILED: '無法登入 TronClass，請確認學校帳號與密碼。',
  TRONCLASS_INVALID_CREDENTIALS: '無法登入 TronClass，請確認學校帳號與密碼。',
  TRONCLASS_LOGIN_UNAVAILABLE: 'TronClass 登入服務暫時無法回應，請稍後再試。',
  TRONCLASS_IDENTITY_UNVERIFIED: '這次登入尚未確認學校帳號身分，請重新連線。',
  TRONCLASS_CONFIGURATION_REQUIRED: 'TronClass 連線服務尚未完成設定。',
  TRONCLASS_UPLOAD_FAILED: '附件尚未全部上傳，作業沒有送出。',
  TRONCLASS_OPERATION_CONFLICT: '這筆操作內容已變更，請重新核對送出狀態。',
  BODY_TOO_LARGE: '檔案超過目前的大小上限，請改選較小的檔案。',
  CONFIGURATION_REQUIRED: 'TronClass 連線服務尚未完成設定。',
};

function response(status: number, value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, private',
      Vary: 'Cookie, X-Campus-Session, Authorization',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function inputRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new NuniError(422, 'TRONCLASS_INVALID_INPUT');
  return value as Record<string, unknown>;
}

function only(input: Record<string, unknown>, keys: string[]): void {
  if (Object.keys(input).some((key) => !keys.includes(key))) throw new NuniError(422, 'TRONCLASS_INVALID_INPUT');
}

function id(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) throw new NuniError(422, 'TRONCLASS_INVALID_INPUT');
  return value;
}

function operationId(value: unknown): string {
  if (typeof value !== 'string' || !ID.test(value)) throw new NuniError(422, 'TRONCLASS_INVALID_INPUT');
  return value;
}

function revision(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{16,100}$/.test(value)) throw new NuniError(422, 'TRONCLASS_INVALID_INPUT');
  return value;
}

function expectedRevision(value: unknown): string | null {
  return value === null ? null : revision(value);
}

function queryId(value: string | null): number {
  return value && /^[1-9]\d*$/.test(value) ? id(Number(value)) : id(null);
}

export async function handleTronClassIntegration(
  request: NextRequest,
  dependencies: TronClassRouteDependencies = {},
): Promise<Response> {
  try {
    if (process.env.TRONCLASS_INTEGRATION_ENABLED === 'false') throw new NuniError(503, 'TRONCLASS_DISABLED');
    if (!['POST', 'PUT'].includes(request.method)) return response(405, { error: 'METHOD_NOT_ALLOWED' });
    const authenticate = dependencies.authenticate ?? authenticateTronClassActor;
    const actor = await authenticate(request);
    (dependencies.rateLimit ?? requestLimiter.check)(actor.ownerKey);
    const bindings = dependencies.bindings ?? createTronClassBindingService();
    const getSubmissions = dependencies.submissions ?? getDefaultTronClassSubmissionService;
    let result: unknown;
    if (request.method === 'PUT') {
      const query = request.nextUrl.searchParams;
      const keys = ['courseId', 'homeworkId', 'revision', 'operationId', 'fileId', 'name'];
      if ([...query.keys()].some((key) => !keys.includes(key)) || keys.some((key) => query.getAll(key).length !== 1)) {
        throw new NuniError(422, 'TRONCLASS_INVALID_INPUT');
      }
      const name = query.get('name');
      const contentType = request.headers.get('content-type')?.trim().toLowerCase() || 'application/octet-stream';
      if (!name || name.length > 200 || /[\x00-\x1f\x7f/\\]/.test(name) ||
        !/^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/.test(contentType)) throw new NuniError(422, 'TRONCLASS_INVALID_INPUT');
      const scope = {
        courseId: queryId(query.get('courseId')), homeworkId: queryId(query.get('homeworkId')),
        revision: revision(query.get('revision')), operationId: operationId(query.get('operationId')),
        fileId: operationId(query.get('fileId')), name, contentType,
      };
      // Check the binding before accepting a potentially large request body.
      await bindings.assertCurrent(actor.ownerKey, scope.revision);
      const bytes = await boundedBytes(request, MAX_FILE_BYTES);
      if (bytes.byteLength === 0) throw new NuniError(422, 'TRONCLASS_INVALID_INPUT');
      result = await (await getSubmissions()).upload(actor.ownerKey, { ...scope, bytes });
    } else {
      if (request.nextUrl.search) throw new NuniError(422, 'TRONCLASS_INVALID_INPUT');
      if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
        throw new NuniError(415, 'TRONCLASS_INVALID_INPUT');
      }
      const input = inputRecord(await boundedJson(request, 96 * 1024));
      switch (input.action) {
        case 'status':
          only(input, ['action']);
          result = await bindings.getStatus(actor.ownerKey);
          break;
        case 'connect':
          only(input, ['action', 'schoolId', 'account', 'password', 'expectedRevision']);
          if (input.schoolId !== 'pu' || typeof input.account !== 'string' || typeof input.password !== 'string') {
            throw new NuniError(422, 'TRONCLASS_INVALID_INPUT');
          }
          result = await bindings.connect(actor.ownerKey, {
            schoolId: 'pu', account: input.account, password: input.password,
            expectedRevision: expectedRevision(input.expectedRevision),
          });
          break;
        case 'disconnect':
          only(input, ['action', 'expectedRevision']);
          result = await bindings.disconnect(actor.ownerKey, expectedRevision(input.expectedRevision));
          break;
        case 'sync':
          only(input, ['action', 'courseId']);
          if (!dependencies.rateLimit) syncLimiter.check(actor.ownerKey);
          result = await (dependencies.read ?? createTronClassIntegrationReader({ bindings }))(actor.ownerKey,
            input.courseId === undefined ? {} : { courseId: id(input.courseId) });
          break;
        case 'prepare':
          only(input, ['action', 'courseId', 'homeworkId']);
          result = await (await getSubmissions()).prepare(actor.ownerKey, { courseId: id(input.courseId), homeworkId: id(input.homeworkId) });
          break;
        case 'submit':
          only(input, ['action', 'courseId', 'homeworkId', 'revision', 'operationId', 'content', 'attachments', 'confirmed']);
          if (input.confirmed !== true || typeof input.content !== 'string' || input.content.length > 20_000 ||
            !Array.isArray(input.attachments) || input.attachments.length > 4 ||
            new Set(input.attachments).size !== input.attachments.length) throw new NuniError(422, 'TRONCLASS_INVALID_INPUT');
          result = await (await getSubmissions()).submit(actor.ownerKey, {
            courseId: id(input.courseId), homeworkId: id(input.homeworkId), revision: revision(input.revision),
            operationId: operationId(input.operationId), content: input.content,
            attachments: input.attachments.map(operationId), confirmed: true,
          });
          break;
        case 'reconcile':
          only(input, ['action', 'operationId', 'revision']);
          result = await (await getSubmissions()).reconcile(actor.ownerKey, {
            operationId: operationId(input.operationId), revision: revision(input.revision),
          });
          break;
        default:
          throw new NuniError(422, 'TRONCLASS_INVALID_INPUT');
      }
    }
    // A long school request must not disclose data after this app session is revoked.
    const current = await authenticate(request);
    if (current.ownerKey !== actor.ownerKey) throw new NuniError(409, 'SESSION_CHANGED');
    return response(200, result);
  } catch (error) {
    const rateLimited = error && typeof error === 'object' && 'code' in error && error.code === 'resource-exhausted';
    const status = error instanceof NuniError ? error.status : rateLimited ? 429 : 503;
    const candidate = error instanceof NuniError ? error.code : rateLimited ? 'TRONCLASS_RATE_LIMITED' : 'TRONCLASS_UNAVAILABLE';
    const code = /^[A-Z][A-Z0-9_]{0,99}$/.test(candidate) ? candidate : 'TRONCLASS_UNAVAILABLE';
    const message = ERROR_MESSAGES[code] ?? (status === 401 ? '登入已到期，請重新登入或連接 TronClass。'
      : status === 409 ? '這筆操作的狀態已變更，請重新讀取後再操作。'
      : status === 429 ? '操作過於頻繁，請稍後再試。'
      : status === 403 ? '目前無法存取這份課程資料。'
      : status === 422 || status === 400 ? '請重新確認輸入的資料。'
      : 'TronClass 暫時無法完成這次操作，請稍後再試。');
    return response(status, { error: code, message });
  }
}

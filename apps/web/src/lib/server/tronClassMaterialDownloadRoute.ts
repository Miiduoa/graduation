import type { NextRequest } from 'next/server';
import { NuniError } from '@campus/shared/src/nuni';
import { boundedJson } from '../nuni/server';
import { createTronClassBindingService } from './tronClassBinding';
import { authenticateTronClassActor } from './tronClassIntegrationAuth';
import { createUidRateLimiter } from './uidRateLimit';
import { createTronClassMaterialDownloader, type TronClassMaterialDownloadInput } from './tronClassMaterialDownload';

type Bindings = Pick<ReturnType<typeof createTronClassBindingService>, 'requireBinding' | 'assertCurrent'>;
export type TronClassMaterialDownloadRouteDependencies = {
  authenticate?: typeof authenticateTronClassActor;
  bindings?: Bindings;
  download?: ReturnType<typeof createTronClassMaterialDownloader>;
  rateLimit?: (ownerKey: string) => void;
  acquireSlot?: () => () => void;
};

/** Bound concurrent buffered files in each process; there is no waiting queue. */
export function createTronClassDownloadSlots(maximum = 2): () => () => void {
  let active = 0;
  return () => {
    if (active >= maximum) throw new NuniError(429, 'TRONCLASS_DOWNLOAD_BUSY');
    active++;
    let released = false;
    return () => { if (!released) { active--; released = true; } };
  };
}

const acquireDownloadSlot = createTronClassDownloadSlots();
const requestLimiter = createUidRateLimiter({ requestsPerMinute: 12 });
const PRIVATE_HEADERS = {
  'Cache-Control': 'no-store, private',
  Vary: 'Cookie, X-Campus-Session, Authorization',
  'X-Content-Type-Options': 'nosniff',
};
const MESSAGES: Record<string, string> = {
  TRONCLASS_MATERIAL_NOT_FOUND: '目前找不到這份教材，請重新整理課程。',
  TRONCLASS_MATERIAL_DOWNLOAD_DENIED: '這個帳號目前無法下載這份教材。',
  TRONCLASS_DOWNLOAD_TOO_LARGE: '教材超過 25 MB，請使用 TronClass 原始下載連結。',
  TRONCLASS_DOWNLOAD_TIMEOUT: 'TronClass 下載逾時，請稍後再試。',
  TRONCLASS_DOWNLOAD_REDIRECT_UNSUPPORTED: '這份教材使用其他下載位置，請使用 TronClass 原始下載連結。',
  TRONCLASS_DOWNLOAD_TYPE_UNSUPPORTED: '這份教材目前需使用 TronClass 原始下載連結。',
  TRONCLASS_DOWNLOAD_BUSY: '目前有其他教材正在下載，請稍後再試。',
  TRONCLASS_RECONNECT_REQUIRED: 'TronClass 登入已到期，請重新連線。',
  TRONCLASS_BINDING_CHANGED: 'TronClass 連線已變更，請重新讀取課程。',
  SIGN_IN_REQUIRED: '請先登入 nuni，再下載教材。',
  SESSION_CHANGED: '登入帳號已變更，請重新開啟課程。',
};

function parseInput(value: unknown): TronClassMaterialDownloadInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new NuniError(422, 'TRONCLASS_INVALID_INPUT');
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => !['courseId', 'activityId', 'uploadKey', 'revision'].includes(key)) ||
    typeof input.courseId !== 'number' || !Number.isSafeInteger(input.courseId) || input.courseId <= 0 ||
    typeof input.activityId !== 'number' || !Number.isSafeInteger(input.activityId) || input.activityId <= 0 ||
    typeof input.uploadKey !== 'string' || !/^[A-Za-z0-9._-]{1,200}$/.test(input.uploadKey) ||
    ['.', '..'].includes(input.uploadKey) || typeof input.revision !== 'string' || !/^[a-f0-9]{32}$/.test(input.revision)) {
    throw new NuniError(422, 'TRONCLASS_INVALID_INPUT');
  }
  return input as TronClassMaterialDownloadInput;
}

function disposition(name: string): string {
  // The name comes from the authorized material record, never the request or an upstream header.
  const safe = name.replace(/[\x00-\x1f\x7f/\\]/g, '_').replace(/^\.+/, '_').slice(0, 200) || 'material';
  const fallback = safe.replace(/[^A-Za-z0-9._ -]/g, '_');
  const encoded = encodeURIComponent(safe).replace(/['()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

function attachmentStream(data: Uint8Array, signal: AbortSignal, release: () => void): ReadableStream<Uint8Array> {
  let bytes: Uint8Array | null = data;
  let offset = 0;
  let finished = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let streamController: ReadableStreamDefaultController<Uint8Array>;
  const finish = () => {
    if (finished) return;
    finished = true;
    bytes = null;
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
    release();
  };
  const abort = () => { streamController.error(new Error('Download cancelled')); finish(); };
  return new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller;
      // Do not let a client which stops consuming monopolize both process slots.
      timer = setTimeout(abort, 60_000);
      timer.unref?.();
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
    },
    pull(controller) {
      if (!bytes) return;
      const end = Math.min(offset + 64 * 1024, bytes.byteLength);
      // Copy only a chunk: a queued Buffer.subarray would retain the whole file.
      const chunk = new Uint8Array(end - offset);
      chunk.set(bytes.subarray(offset, end));
      controller.enqueue(chunk);
      offset = end;
      if (offset === bytes.byteLength) { controller.close(); finish(); }
    },
    cancel() { finish(); },
  }, { highWaterMark: 0 });
}

export async function handleTronClassMaterialDownload(
  request: NextRequest,
  dependencies: TronClassMaterialDownloadRouteDependencies = {},
): Promise<Response> {
  let release: (() => void) | undefined;
  try {
    if (process.env.TRONCLASS_INTEGRATION_ENABLED === 'false') throw new NuniError(503, 'TRONCLASS_DISABLED');
    if (request.method !== 'POST') throw new NuniError(405, 'METHOD_NOT_ALLOWED');
    const authenticate = dependencies.authenticate ?? authenticateTronClassActor;
    const actor = await authenticate(request);
    (dependencies.rateLimit ?? requestLimiter.check)(actor.ownerKey);
    if (request.nextUrl.search) throw new NuniError(422, 'TRONCLASS_INVALID_INPUT');
    if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
      throw new NuniError(415, 'TRONCLASS_INVALID_INPUT');
    }
    const input = parseInput(await boundedJson(request, 8 * 1024));
    release = (dependencies.acquireSlot ?? acquireDownloadSlot)();
    const bindings = dependencies.bindings ?? createTronClassBindingService();
    await bindings.assertCurrent(actor.ownerKey, input.revision);
    const result = await (dependencies.download ?? createTronClassMaterialDownloader({ bindings }))(actor.ownerKey, input, request.signal);
    const current = await authenticate(request);
    if (current.ownerKey !== actor.ownerKey || current.provider !== actor.provider) throw new NuniError(409, 'SESSION_CHANGED');
    await bindings.assertCurrent(actor.ownerKey, input.revision);
    if (request.signal.aborted) throw new NuniError(504, 'TRONCLASS_DOWNLOAD_TIMEOUT');
    const headers = new Headers({
      ...PRIVATE_HEADERS,
      'Content-Type': result.contentType,
      'Content-Disposition': disposition(result.name),
      'Content-Length': String(result.bytes.byteLength),
      'Content-Security-Policy': 'sandbox',
    });
    const stream = attachmentStream(result.bytes, request.signal, release);
    // The response now owns the permit until its final chunk or cancellation.
    release = undefined;
    try { return new Response(stream, { status: 200, headers }); }
    catch (error) { void stream.cancel().catch(() => {}); throw error; }
  } catch (error) {
    const rateLimited = error && typeof error === 'object' && 'code' in error && error.code === 'resource-exhausted';
    const status = error instanceof NuniError ? error.status : rateLimited ? 429 : 503;
    const candidate = error instanceof NuniError ? error.code : rateLimited ? 'TRONCLASS_RATE_LIMITED' : 'TRONCLASS_DOWNLOAD_UNAVAILABLE';
    const code = /^[A-Z][A-Z0-9_]{0,99}$/.test(candidate) ? candidate : 'TRONCLASS_DOWNLOAD_UNAVAILABLE';
    const message = MESSAGES[code] ?? (status === 401 ? '登入已到期，請重新登入或連接 TronClass。'
      : status === 429 ? '下載過於頻繁，請稍後再試。'
      : status === 400 || status === 422 ? '下載資料格式不正確，請重新整理課程。'
      : '目前無法下載教材，請稍後再試或使用 TronClass 原始下載連結。');
    return new Response(JSON.stringify({ error: code, message }), {
      status, headers: { ...PRIVATE_HEADERS, 'Content-Type': 'application/json; charset=utf-8' },
    });
  } finally { release?.(); }
}

import https from 'node:https';
import type { ClientRequest, IncomingMessage } from 'node:http';
import { NuniError } from '@campus/shared/src/nuni';
import { createPuRelayFetch } from './puEdgeRelay';

export const TRONCLASS_DOWNLOAD_MAX_BYTES = 25 * 1024 * 1024;
export const TRONCLASS_DOWNLOAD_TIMEOUT_MS = 30_000;
export type TronClassDownloadFetch = (url: string, init?: RequestInit) => Promise<Response>;
type FetchLike = TronClassDownloadFetch;
type RequestFn = (options: https.RequestOptions, callback?: (response: IncomingMessage) => void) => ClientRequest;
const KEY = /^[A-Za-z0-9._-]{1,200}$/;
function validKey(value: unknown): value is string {
  return typeof value === 'string' && KEY.test(value) && value !== '.' && value !== '..';
}
function fail(status: number, code: string): never { throw new NuniError(status, code); }
function unavailable(): never { return fail(503, 'TRONCLASS_DOWNLOAD_UNAVAILABLE'); }

function checkedSchoolTarget(value: string): URL {
  const url = new URL(value);
  const match = /^\/api\/uploads\/([A-Za-z0-9._-]{1,200})\/blob$/.exec(url.pathname);
  if (url.protocol !== 'https:' || url.hostname !== 'tronclass.pu.edu.tw' || url.port || url.username || url.password ||
    url.search || url.hash || !match || !validKey(match[1])) fail(400, 'TRONCLASS_INVALID_INPUT');
  return url;
}
export function checkedTronClassDownloadLength(headers: Headers, maximum: number): number | null {
  const value = headers.get('content-length');
  if (value === null) return null;
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) unavailable();
  const length = Number(value);
  if (length > maximum) fail(413, 'TRONCLASS_DOWNLOAD_TOO_LARGE');
  return length;
}
export function tronClassDownloadContentType(headers: Headers): string {
  const type = (headers.get('content-type') ?? 'application/octet-stream').split(';')[0].trim().toLowerCase();
  const exact = new Set([
    'application/octet-stream', 'application/pdf', 'application/zip', 'application/x-zip-compressed',
    'application/msword', 'application/vnd.ms-excel', 'application/vnd.ms-powerpoint',
    'text/plain', 'text/csv', 'text/tab-separated-values', 'application/rtf',
    'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp', 'image/tiff', 'image/avif',
  ]);
  const knownOffice = /^application\/vnd\.(?:openxmlformats-officedocument\.[a-z0-9.-]+|oasis\.opendocument\.[a-z0-9.-]+)$/.test(type);
  const media = /^(?:audio|video)\/[a-z0-9.+-]+$/.test(type);
  if (!exact.has(type) && !knownOffice && !media) fail(415, 'TRONCLASS_DOWNLOAD_TYPE_UNSUPPORTED');
  const encoding = headers.get('content-encoding');
  if (encoding && encoding.toLowerCase() !== 'identity') fail(415, 'TRONCLASS_DOWNLOAD_TYPE_UNSUPPORTED');
  return type;
}
/**
 * PU's public course logo independently confirms this signed media route.
 * A redirect is only followed after an authorized, fixed school blob request.
 * Neither caller input nor a wildcard school domain can extend this policy.
 */
function checkedMediaTarget(value: string): URL {
  if (typeof value !== 'string' || value.length > 4096 || /[\x00-\x20\x7f\\]/.test(value)) {
    fail(502, 'TRONCLASS_DOWNLOAD_REDIRECT_UNSUPPORTED');
  }
  let url: URL;
  try { url = new URL(value); }
  catch { return fail(502, 'TRONCLASS_DOWNLOAD_REDIRECT_UNSUPPORTED'); }
  if (url.protocol !== 'https:' || url.hostname !== 'media.pu.edu.tw' || url.port || url.username || url.password ||
    url.hash || url.href !== value || !/^\/download\/file\/[a-f0-9]{40}$/.test(url.pathname)) {
    fail(502, 'TRONCLASS_DOWNLOAD_REDIRECT_UNSUPPORTED');
  }
  const expected = ['timestamp', 'token', 'name'];
  if ([...url.searchParams.keys()].some(key => !expected.includes(key)) ||
    expected.some(key => url.searchParams.getAll(key).length !== 1)) {
    fail(502, 'TRONCLASS_DOWNLOAD_REDIRECT_UNSUPPORTED');
  }
  const timestamp = url.searchParams.get('timestamp')!;
  const token = url.searchParams.get('token')!;
  const name = url.searchParams.get('name')!;
  if (!/^[1-9]\d{9}$/.test(timestamp) || !/^[a-f0-9]{32}$/.test(token) ||
    !name || name.length > 512 || /[\x00-\x1f\x7f]/.test(name)) {
    fail(502, 'TRONCLASS_DOWNLOAD_REDIRECT_UNSUPPORTED');
  }
  return url;
}

/** A bounded replacement for the text-oriented, fully buffered campus fetch. */
function createBoundedBinaryFetch(
  kind: 'school' | 'media',
  request: RequestFn,
  maximum: number,
): FetchLike {
  return (raw, init = {}) => new Promise((resolve, reject) => {
    let url: URL;
    try {
      url = kind === 'school' ? checkedSchoolTarget(raw) : checkedMediaTarget(raw);
      if ((init.method && init.method !== 'GET') || init.body) fail(400, 'TRONCLASS_INVALID_INPUT');
    } catch (error) { reject(error); return; }
    if (init.signal?.aborted) { reject(new NuniError(504, 'TRONCLASS_DOWNLOAD_TIMEOUT')); return; }
    let req: ClientRequest | undefined;
    let settled = false;
    const finish = (error?: unknown, response?: Response) => {
      if (settled) return;
      settled = true;
      init.signal?.removeEventListener('abort', abort);
      clearTimeout(timer);
      if (error) { reject(error); req?.destroy(); }
      else resolve(response!);
    };
    const abort = () => finish(new NuniError(504, 'TRONCLASS_DOWNLOAD_TIMEOUT'));
    const timer = setTimeout(abort, TRONCLASS_DOWNLOAD_TIMEOUT_MS);
    timer.unref?.();
    const headers: Record<string, string> = {};
    if (kind === 'school') new Headers(init.headers).forEach((value, key) => { headers[key] = value; });
    else { headers.accept = 'application/octet-stream, */*'; headers['accept-encoding'] = 'identity'; }
    try {
      req = request({ protocol: 'https:', hostname: url.hostname, servername: url.hostname, family: 4,
        method: 'GET', path: url.pathname + url.search, headers }, (upstream) => {
        // destroy() may emit a response error even when headers were rejected.
        upstream.on('error', (error) => finish(error));
        upstream.on('aborted', () => finish(new NuniError(503, 'TRONCLASS_DOWNLOAD_UNAVAILABLE')));
        upstream.on('close', () => { if (!settled) finish(new NuniError(503, 'TRONCLASS_DOWNLOAD_UNAVAILABLE')); });
        try {
          const out = new Headers();
          for (const name of ['content-type', 'content-length', 'content-encoding', 'location']) {
            const value = upstream.headers[name];
            if (value !== undefined) out.set(name, Array.isArray(value) ? value.join(', ') : value);
          }
          const status = upstream.statusCode ?? 0;
          if (status !== 200) {
            finish(undefined, new Response(null, { status, headers: out }));
            req?.destroy();
            return;
          }
          checkedTronClassDownloadLength(out, maximum);
          tronClassDownloadContentType(out);
          const chunks: Buffer[] = [];
          let length = 0;
          upstream.on('data', (chunk: Buffer | Uint8Array) => {
            if (settled) return;
            length += chunk.byteLength;
            if (length > maximum) { finish(new NuniError(413, 'TRONCLASS_DOWNLOAD_TOO_LARGE')); return; }
            chunks.push(Buffer.from(chunk));
          });
          upstream.on('end', () => {
            if (settled) return;
            try { finish(undefined, new Response(Buffer.concat(chunks), { status: 200, headers: out })); }
            catch (error) { finish(error); }
          });
        } catch (error) { finish(error); }
      });
      req.on('error', (error) => finish(error));
      init.signal?.addEventListener('abort', abort, { once: true });
      if (init.signal?.aborted) { abort(); return; }
      req.end();
    } catch (error) { finish(error); }
  });
}

/** School credentials are accepted only by the exact school blob route. */
export function createTronClassBoundedBinaryFetch(
  request: RequestFn = https.request,
  maximum = TRONCLASS_DOWNLOAD_MAX_BYTES,
): FetchLike {
  return createBoundedBinaryFetch('school', request, maximum);
}

/** Signed media URLs never receive school, platform or relay request headers. */
export function createTronClassBoundedMediaFetch(
  request: RequestFn = https.request,
  maximum = TRONCLASS_DOWNLOAD_MAX_BYTES,
): FetchLike {
  return createBoundedBinaryFetch('media', request, maximum);
}

function cancelBody(response: Response): void { void response.body?.cancel().catch(() => {}); }
function assertActive(signal: AbortSignal | null | undefined, response?: Response): void {
  if (!signal?.aborted) return;
  if (response) cancelBody(response);
  fail(504, 'TRONCLASS_DOWNLOAD_TIMEOUT');
}

/** Follow at most the one independently confirmed PU media redirect. */
export function createTronClassDownloadFetch(dependencies: {
  schoolFetch?: FetchLike;
  mediaFetch?: FetchLike;
} = {}) {
  const schoolFetch = dependencies.schoolFetch ?? createPuRelayFetch({ directFetch: createTronClassBoundedBinaryFetch() });
  const mediaFetch = dependencies.mediaFetch ?? createPuRelayFetch({ directFetch: createTronClassBoundedMediaFetch() });
  return async (raw: string, init: RequestInit = {}, check?: () => Promise<void>): Promise<Response> => {
    const target = checkedSchoolTarget(raw);
    if ((init.method && init.method !== 'GET') || init.body) fail(400, 'TRONCLASS_INVALID_INPUT');
    assertActive(init.signal);
    const response = await schoolFetch(target.href, { ...init, method: 'GET', redirect: 'manual', cache: 'no-store' });
    assertActive(init.signal, response);
    if (response.status !== 302) return response;
    cancelBody(response);
    const location = response.headers.get('location');
    if (!location) fail(502, 'TRONCLASS_DOWNLOAD_REDIRECT_UNSUPPORTED');
    const media = checkedMediaTarget(location);
    await check?.();
    assertActive(init.signal);
    const downloaded = await mediaFetch(media.href, {
      method: 'GET', redirect: 'manual', cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer',
      signal: init.signal,
      headers: { Accept: 'application/octet-stream, */*', 'Accept-Encoding': 'identity' },
    });
    assertActive(init.signal, downloaded);
    if (downloaded.status >= 300 && downloaded.status < 400) {
      cancelBody(downloaded);
      fail(502, 'TRONCLASS_DOWNLOAD_REDIRECT_UNSUPPORTED');
    }
    // A rejected signed URL is not evidence that the student's school login
    // expired. Let them retry the download without discarding their binding.
    if (downloaded.status === 401 || downloaded.status === 403) {
      cancelBody(downloaded);
      unavailable();
    }
    return downloaded;
  };
}

import https from 'node:https';
import type { ClientRequest, IncomingMessage } from 'node:http';
import { NuniError } from '@campus/shared/src/nuni';
import { classifySchoolReadError, isMaterialActivityType, tronClassUploadHref } from '@campus/shared/src/puLmsReadonly';
import { createTronClassBindingService } from './tronClassBinding';
import { createPuRelayFetch } from './puEdgeRelay';
import { tronClassLmsReadonlySource, type LmsReadonlySource } from './tronClassLmsSource';

export const TRONCLASS_DOWNLOAD_MAX_BYTES = 25 * 1024 * 1024;
export const TRONCLASS_DOWNLOAD_TIMEOUT_MS = 30_000;
export type TronClassMaterialDownloadInput = {
  courseId: number; activityId: number; uploadKey: string; revision: string;
};
type BindingReader = Pick<ReturnType<typeof createTronClassBindingService>, 'requireBinding' | 'assertCurrent'>;
type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
type RequestFn = (options: https.RequestOptions, callback?: (response: IncomingMessage) => void) => ClientRequest;
const KEY = /^[A-Za-z0-9._-]{1,200}$/;
const REVISION = /^[a-f0-9]{32}$/;

function fail(status: number, code: string): never { throw new NuniError(status, code); }
function unavailable(): never { return fail(503, 'TRONCLASS_DOWNLOAD_UNAVAILABLE'); }
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function positiveId(value: unknown): number | null {
  const id = typeof value === 'number' ? value : typeof value === 'string' && /^[1-9]\d*$/.test(value) ? Number(value) : NaN;
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}
function validKey(value: unknown): value is string {
  return typeof value === 'string' && KEY.test(value) && value !== '.' && value !== '..';
}
function checkedTarget(value: string): URL {
  const url = new URL(value);
  const match = /^\/api\/uploads\/([A-Za-z0-9._-]{1,200})\/blob$/.exec(url.pathname);
  if (url.protocol !== 'https:' || url.hostname !== 'tronclass.pu.edu.tw' || url.port || url.username || url.password ||
    url.search || url.hash || !match || !validKey(match[1])) fail(400, 'TRONCLASS_INVALID_INPUT');
  return url;
}
function checkedLength(headers: Headers, maximum: number): number | null {
  const value = headers.get('content-length');
  if (value === null) return null;
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) unavailable();
  const length = Number(value);
  if (length > maximum) fail(413, 'TRONCLASS_DOWNLOAD_TOO_LARGE');
  return length;
}
function contentType(headers: Headers): string {
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
function safeFilename(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 200) unavailable();
  return Buffer.from(value, 'utf8').toString('utf8').replace(/[\x00-\x1f\x7f/\\]/g, '_').replace(/^\.+/, '_').trim() || '教材附件';
}

/** A bounded replacement for the text-oriented, fully buffered campus fetch. */
export function createTronClassBoundedBinaryFetch(
  request: RequestFn = https.request,
  maximum = TRONCLASS_DOWNLOAD_MAX_BYTES,
): FetchLike {
  return (raw, init = {}) => new Promise((resolve, reject) => {
    let url: URL;
    try {
      url = checkedTarget(raw);
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
    new Headers(init.headers).forEach((value, key) => { headers[key] = value; });
    try {
      req = request({ protocol: 'https:', hostname: url.hostname, servername: url.hostname, family: 4,
        method: 'GET', path: url.pathname, headers }, (upstream) => {
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
          checkedLength(out, maximum);
          contentType(out);
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

export function createTronClassMaterialDownloader(dependencies: {
  bindings?: BindingReader; source?: LmsReadonlySource; fetch?: FetchLike; timeoutMs?: number;
} = {}) {
  const bindings = dependencies.bindings ?? createTronClassBindingService();
  const source = dependencies.source ?? tronClassLmsReadonlySource;
  const fetchFile = dependencies.fetch ?? createPuRelayFetch({ directFetch: createTronClassBoundedBinaryFetch() });
  return async (ownerKey: string, input: TronClassMaterialDownloadInput, signal?: AbortSignal): Promise<{
    bytes: Uint8Array; name: string; contentType: string;
  }> => {
    if (!input || positiveId(input.courseId) !== input.courseId || positiveId(input.activityId) !== input.activityId ||
      !validKey(input.uploadKey) || typeof input.revision !== 'string' || !REVISION.test(input.revision)) fail(422, 'TRONCLASS_INVALID_INPUT');
    const controller = new AbortController();
    const cancelled = () => controller.abort();
    let abortDeadline: (() => void) | undefined;
    const deadline = new Promise<never>((_, reject) => {
      abortDeadline = () => reject(new NuniError(504, 'TRONCLASS_DOWNLOAD_TIMEOUT'));
      controller.signal.addEventListener('abort', abortDeadline, { once: true });
    });
    signal?.addEventListener('abort', cancelled, { once: true });
    if (signal?.aborted) controller.abort();
    const timer = setTimeout(cancelled, dependencies.timeoutMs ?? TRONCLASS_DOWNLOAD_TIMEOUT_MS);
    const check = async () => {
      if (controller.signal.aborted) fail(504, 'TRONCLASS_DOWNLOAD_TIMEOUT');
      await bindings.assertCurrent(ownerKey, input.revision);
      if (controller.signal.aborted) fail(504, 'TRONCLASS_DOWNLOAD_TIMEOUT');
    };
    const operation = async () => {
      const binding = await bindings.requireBinding(ownerKey);
      if (binding.revision !== input.revision) fail(409, 'TRONCLASS_BINDING_CHANGED');
      await check();
      const lists = await Promise.all(['ongoing', 'upcoming'].map((status) =>
        source.fetchCourses(binding.cookies, { userId: binding.userId, status: status as 'ongoing' | 'upcoming' })));
      await check();
      if (lists.some((list) => !Array.isArray(list) || list.length > 1000)) unavailable();
      if (!(lists as unknown[][]).flat().some((row) => positiveId(record(row).id) === input.courseId)) {
        fail(403, 'TRONCLASS_MATERIAL_DOWNLOAD_DENIED');
      }
      const activities = await Promise.all([
        source.fetchActivities(binding.cookies, input.courseId, ''),
        source.fetchActivities(binding.cookies, input.courseId, 'type=courseware_activity'),
      ]);
      await check();
      for (let i = 0; i < activities.length; i++) {
        const response = activities[i];
        if (!response.ok) {
          if (response.status === 401) fail(401, 'TRONCLASS_RECONNECT_REQUIRED');
          if (!(i === 1 && response.status === 404)) unavailable();
        } else if (!Array.isArray(response.value) || response.value.length > 5000) unavailable();
      }
      const matches = activities.flatMap((response) => response.ok ? response.value : [])
        .map(record).filter((row) => positiveId(row.id) === input.activityId);
      if (!matches.length) fail(404, 'TRONCLASS_MATERIAL_NOT_FOUND');
      const names = matches.map((row) => {
        if ((row.course_id !== undefined && positiveId(row.course_id) !== input.courseId) ||
          typeof row.type !== 'string' || !row.type || !isMaterialActivityType(row.type) ||
          row.is_hidden === true || row.hidden === true) fail(403, 'TRONCLASS_MATERIAL_DOWNLOAD_DENIED');
        const uploads = Array.isArray(row.uploads) ? row.uploads : Array.isArray(row.attachments) ? row.attachments : [];
        const files = uploads.slice(0, 30).map(record).filter((file) => (file.key || file.file_key || file.upload_id) === input.uploadKey);
        if (files.length !== 1 || files[0].allow_download !== true) fail(403, 'TRONCLASS_MATERIAL_DOWNLOAD_DENIED');
        return safeFilename(files[0].name || files[0].filename);
      });
      if (new Set(names).size !== 1) unavailable();
      const cookie = Object.entries(binding.cookies).map(([key, value]) => {
        if (!key || /[\s;=]/.test(key) || typeof value !== 'string' || /[;\r\n]/.test(value)) unavailable();
        return `${key}=${value}`;
      }).join('; ');
      if (!cookie || cookie.length > 32 * 1024) unavailable();
      await check();
      const response = await fetchFile(tronClassUploadHref(input.uploadKey), {
        method: 'GET', redirect: 'manual', cache: 'no-store', signal: controller.signal,
        headers: { Cookie: cookie, Accept: 'application/octet-stream, */*', 'Accept-Encoding': 'identity' },
      });
      if (response.status === 401 || response.status === 403) {
        void response.body?.cancel().catch(() => {});
        fail(401, 'TRONCLASS_RECONNECT_REQUIRED');
      }
      if (response.status >= 300 && response.status < 400) {
        void response.body?.cancel().catch(() => {});
        fail(502, 'TRONCLASS_DOWNLOAD_REDIRECT_UNSUPPORTED');
      }
      if (response.status !== 200 || !response.body) {
        void response.body?.cancel().catch(() => {});
        unavailable();
      }
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      const cancelReader = () => { void reader?.cancel().catch(() => {}); };
      try {
        await check();
        const expectedLength = checkedLength(response.headers, TRONCLASS_DOWNLOAD_MAX_BYTES);
        const type = contentType(response.headers);
        reader = response.body.getReader();
        controller.signal.addEventListener('abort', cancelReader, { once: true });
        if (controller.signal.aborted) cancelReader();
        const chunks: Uint8Array[] = [];
        let length = 0;
        while (true) {
          if (controller.signal.aborted) fail(504, 'TRONCLASS_DOWNLOAD_TIMEOUT');
          const next = await reader.read();
          if (next.done) break;
          length += next.value.byteLength;
          if (length > TRONCLASS_DOWNLOAD_MAX_BYTES) fail(413, 'TRONCLASS_DOWNLOAD_TOO_LARGE');
          chunks.push(next.value);
        }
        if (expectedLength !== null && expectedLength !== length) unavailable();
        const bytes = Buffer.concat(chunks);
        if (/^\s*(?:<!doctype\s+html\b|<html\b|<form\b)/i.test(bytes.subarray(0, 512).toString('utf8'))) {
          fail(401, 'TRONCLASS_RECONNECT_REQUIRED');
        }
        await check();
        return { bytes, name: names[0], contentType: type };
      } catch (error) {
        if (reader) void reader.cancel().catch(() => {});
        else void response.body.cancel().catch(() => {});
        throw error;
      } finally {
        controller.signal.removeEventListener('abort', cancelReader);
        reader?.releaseLock();
      }
    };
    try { return await Promise.race([operation(), deadline]); }
    catch (error) {
      controller.abort();
      if (error instanceof NuniError) throw error;
      if (classifySchoolReadError(error) === 'session') fail(401, 'TRONCLASS_RECONNECT_REQUIRED');
      return unavailable();
    } finally {
      clearTimeout(timer);
      if (abortDeadline) controller.signal.removeEventListener('abort', abortDeadline);
      signal?.removeEventListener('abort', cancelled);
    }
  };
}

import { NuniError } from '@campus/shared/src/nuni';
import { classifySchoolReadError, isMaterialActivityType, tronClassUploadHref } from '@campus/shared/src/puLmsReadonly';
import { createTronClassBindingService } from './tronClassBinding';
import { tronClassLmsReadonlySource, type LmsReadonlySource } from './tronClassLmsSource';
import { isTronClassSourceVisible } from './tronClassSourceVisibility';
import { isTronClassMaterialDownloadAllowed, tronClassMaterialUploadKey } from './tronClassMaterialFile';

import {
  TRONCLASS_DOWNLOAD_MAX_BYTES, TRONCLASS_DOWNLOAD_TIMEOUT_MS,
  checkedTronClassDownloadLength, tronClassDownloadContentType, createTronClassDownloadFetch,
} from './tronClassDownloadTransport';

export { TRONCLASS_DOWNLOAD_MAX_BYTES, TRONCLASS_DOWNLOAD_TIMEOUT_MS, createTronClassBoundedBinaryFetch } from './tronClassDownloadTransport';
export type TronClassMaterialDownloadInput = {
  courseId: number; activityId: number; uploadKey: string; revision: string;
};
type BindingReader = Pick<ReturnType<typeof createTronClassBindingService>, 'requireBinding' | 'assertCurrent'>;
type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
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
function safeFilename(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 200) unavailable();
  return Buffer.from(value, 'utf8').toString('utf8').replace(/[\x00-\x1f\x7f/\\]/g, '_').replace(/^\.+/, '_').trim() || '教材附件';
}

/** Shared byte checks for an already authorized, fixed-origin school file. */
export async function readTronClassDownloadResponse(
  response: Response,
  signal: AbortSignal,
  check: () => Promise<void>,
): Promise<{ bytes: Uint8Array; contentType: string }> {
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
    const expectedLength = checkedTronClassDownloadLength(response.headers, TRONCLASS_DOWNLOAD_MAX_BYTES);
    const type = tronClassDownloadContentType(response.headers);
    reader = response.body.getReader();
    signal.addEventListener('abort', cancelReader, { once: true });
    if (signal.aborted) cancelReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
      if (signal.aborted) fail(504, 'TRONCLASS_DOWNLOAD_TIMEOUT');
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
    return { bytes, contentType: type };
  } catch (error) {
    if (reader) void reader.cancel().catch(() => {});
    else void response.body.cancel().catch(() => {});
    throw error;
  } finally {
    signal.removeEventListener('abort', cancelReader);
    reader?.releaseLock();
  }
}

export function createTronClassMaterialDownloader(dependencies: {
  bindings?: BindingReader; source?: LmsReadonlySource; fetch?: FetchLike; mediaFetch?: FetchLike; timeoutMs?: number;
} = {}) {
  const bindings = dependencies.bindings ?? createTronClassBindingService();
  const source = dependencies.source ?? tronClassLmsReadonlySource;
  const fetchFile = createTronClassDownloadFetch({ schoolFetch: dependencies.fetch, mediaFetch: dependencies.mediaFetch });
  return async (ownerKey: string, input: TronClassMaterialDownloadInput, signal?: AbortSignal): Promise<{
    bytes: Uint8Array; name: string; contentType: string;
  }> => {
    if (!input || positiveId(input.courseId) !== input.courseId || positiveId(input.activityId) !== input.activityId ||
      !validKey(input.uploadKey) || typeof input.revision !== 'string' || !REVISION.test(input.revision)) fail(422, 'TRONCLASS_INVALID_INPUT');
    const deadlineAt = Date.now() + (dependencies.timeoutMs ?? TRONCLASS_DOWNLOAD_TIMEOUT_MS);
    const controller = new AbortController();
    const cancelled = () => controller.abort();
    let abortDeadline: (() => void) | undefined;
    const deadline = new Promise<never>((_, reject) => {
      abortDeadline = () => reject(new NuniError(504, 'TRONCLASS_DOWNLOAD_TIMEOUT'));
      controller.signal.addEventListener('abort', abortDeadline, { once: true });
    });
    signal?.addEventListener('abort', cancelled, { once: true });
    if (signal?.aborted) controller.abort();
    const timer = setTimeout(cancelled, Math.max(1, deadlineAt - Date.now()));
    const readOptions = () => {
      const remaining = deadlineAt - Date.now();
      if (controller.signal.aborted || remaining <= 0) fail(504, 'TRONCLASS_DOWNLOAD_TIMEOUT');
      return { signal: controller.signal, timeoutMs: remaining };
    };
    const check = async () => {
      if (controller.signal.aborted) fail(504, 'TRONCLASS_DOWNLOAD_TIMEOUT');
      await bindings.assertCurrent(ownerKey, input.revision);
      if (controller.signal.aborted) fail(504, 'TRONCLASS_DOWNLOAD_TIMEOUT');
    };
    const operation = async () => {
      const binding = await bindings.requireBinding(ownerKey);
      if (binding.revision !== input.revision) fail(409, 'TRONCLASS_BINDING_CHANGED');
      await check();
      const authorizedFile = async () => {
        await check();
        const lists = await Promise.all(['ongoing', 'upcoming'].map((status) =>
          source.fetchCourses(binding.cookies, { userId: binding.userId, status: status as 'ongoing' | 'upcoming' }, readOptions())));
        await check();
        if (lists.some((list) => !Array.isArray(list) || list.length > 1000)) unavailable();
        if (!(lists as unknown[][]).flat().some((row) => positiveId(record(row).id) === input.courseId)) {
          fail(403, 'TRONCLASS_MATERIAL_DOWNLOAD_DENIED');
        }
        const activities = await Promise.all([
          source.fetchActivities(binding.cookies, input.courseId, '', readOptions()),
          source.fetchActivities(binding.cookies, input.courseId, 'type=courseware_activity', readOptions()),
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
        const files = matches.map((row) => {
          if ((row.course_id !== undefined && positiveId(row.course_id) !== input.courseId) ||
            typeof row.type !== 'string' || !row.type || !isMaterialActivityType(row.type) ||
            !isTronClassSourceVisible(row)) fail(403, 'TRONCLASS_MATERIAL_DOWNLOAD_DENIED');
          const uploads = Array.isArray(row.uploads) ? row.uploads : Array.isArray(row.attachments) ? row.attachments : [];
          const files = uploads.slice(0, 30).map(record).filter((file) => tronClassMaterialUploadKey(file) === input.uploadKey);
          if (files.length !== 1 || !isTronClassMaterialDownloadAllowed(files[0])) {
            fail(403, 'TRONCLASS_MATERIAL_DOWNLOAD_DENIED');
          }
          const name = files[0].name || files[0].filename;
          const size = files[0].size;
          if (size !== undefined && size !== null &&
            (typeof size !== 'number' || !Number.isSafeInteger(size) || size < 0)) unavailable();
          if (typeof size === 'number' && size > TRONCLASS_DOWNLOAD_MAX_BYTES) fail(413, 'TRONCLASS_DOWNLOAD_TOO_LARGE');
          return { name: safeFilename(name), sourceName: name, size: typeof size === 'number' ? size : null };
        });
        if (new Set(files.map(file => JSON.stringify([file.sourceName, file.size]))).size !== 1) unavailable();
        return files[0];
      };
      const metadata = await authorizedFile();
      const cookie = Object.entries(binding.cookies).map(([key, value]) => {
        if (!key || /[\s;=]/.test(key) || typeof value !== 'string' || /[;\r\n]/.test(value)) unavailable();
        return `${key}=${value}`;
      }).join('; ');
      if (!cookie || cookie.length > 32 * 1024) unavailable();
      await check();
      const response = await fetchFile(tronClassUploadHref(input.uploadKey), {
        method: 'GET', redirect: 'manual', cache: 'no-store', signal: controller.signal,
        headers: { Cookie: cookie, Accept: 'application/octet-stream, */*', 'Accept-Encoding': 'identity' },
      }, check);
      const file = await readTronClassDownloadResponse(response, controller.signal, check);
      if (metadata.size !== null && metadata.size !== file.bytes.byteLength) unavailable();
      // The teacher can withdraw a file or change download permissions while
      // its bytes are in flight. Recheck the same course/activity/file before
      // any bytes leave the server, using the original total deadline.
      const latest = await authorizedFile();
      if (latest.sourceName !== metadata.sourceName || latest.size !== metadata.size) unavailable();
      await check();
      return { ...file, name: metadata.name };
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

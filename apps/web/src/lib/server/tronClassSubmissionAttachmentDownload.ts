import { NuniError } from '@campus/shared/src/nuni';
import { classifySchoolReadError, tronClassUploadHref } from '@campus/shared/src/puLmsReadonly';
import { createTronClassBindingService } from './tronClassBinding';
import type { LmsReadonlySource } from './tronClassLmsSource';
import { createTronClassDownloadFetch } from './tronClassDownloadTransport';
import { createTronClassRawSubmissionHistoryReader } from './tronClassRawSubmissionHistory';
import { normalizeTronClassSubmissionHistory } from './tronClassSubmissionHistory';
import {
  readTronClassDownloadResponse,
  TRONCLASS_DOWNLOAD_MAX_BYTES, TRONCLASS_DOWNLOAD_TIMEOUT_MS,
} from './tronClassMaterialDownload';

export type TronClassSubmissionAttachmentDownloadInput = {
  courseId: number;
  homeworkId: number;
  submissionId: string;
  uploadId: number;
  revision: string;
};
type Bindings = Pick<ReturnType<typeof createTronClassBindingService>, 'requireBinding' | 'assertCurrent'>;
type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
const positiveId = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
function fail(status: number, code: string): never { throw new NuniError(status, code); }

export function parseTronClassSubmissionAttachmentDownloadInput(value: unknown): TronClassSubmissionAttachmentDownloadInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(422, 'TRONCLASS_INVALID_INPUT');
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !['courseId', 'homeworkId', 'submissionId', 'uploadId', 'revision'].includes(key)) ||
    !positiveId(input.courseId) || !positiveId(input.homeworkId) || !positiveId(input.uploadId) ||
    typeof input.submissionId !== 'string' || !/^[1-9]\d{0,15}$/.test(input.submissionId) ||
    !Number.isSafeInteger(Number(input.submissionId)) ||
    typeof input.revision !== 'string' || !/^[a-f0-9]{32}$/.test(input.revision)) fail(422, 'TRONCLASS_INVALID_INPUT');
  return {
    courseId: input.courseId, homeworkId: input.homeworkId, submissionId: input.submissionId,
    uploadId: input.uploadId, revision: input.revision,
  };
}

/** Download a file from this student's exact historical submission version. */
export function createTronClassSubmissionAttachmentDownloader(dependencies: {
  bindings?: Bindings;
  source?: LmsReadonlySource;
  fetch?: FetchLike;
  mediaFetch?: FetchLike;
  now?: () => number;
  timeoutMs?: number;
} = {}) {
  const bindings = dependencies.bindings ?? createTronClassBindingService();
  const now = dependencies.now ?? Date.now;
  const timeoutMs = dependencies.timeoutMs ?? TRONCLASS_DOWNLOAD_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > TRONCLASS_DOWNLOAD_TIMEOUT_MS) {
    fail(422, 'TRONCLASS_INVALID_INPUT');
  }
  const readHistory = createTronClassRawSubmissionHistoryReader({
    bindings, source: dependencies.source, now, timeoutMs: Math.min(timeoutMs, 15_000),
  });
  const fetchFile = createTronClassDownloadFetch({ schoolFetch: dependencies.fetch, mediaFetch: dependencies.mediaFetch });

  return async (ownerKey: string, value: TronClassSubmissionAttachmentDownloadInput, signal?: AbortSignal): Promise<{
    bytes: Uint8Array; name: string; contentType: string;
  }> => {
    const input = Object.freeze(parseTronClassSubmissionAttachmentDownloadInput(value));
    const controller = new AbortController();
    const abort = () => controller.abort();
    const timeout = () => new NuniError(504, 'TRONCLASS_DOWNLOAD_TIMEOUT');
    let rejectDeadline: (() => void) | undefined;
    const deadline = new Promise<never>((_, reject) => {
      rejectDeadline = () => reject(timeout());
      controller.signal.addEventListener('abort', rejectDeadline, { once: true });
    });
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const timer = setTimeout(abort, timeoutMs);
    const check = async () => {
      if (controller.signal.aborted) throw timeout();
      await bindings.assertCurrent(ownerKey, input.revision);
      if (controller.signal.aborted) throw timeout();
    };
    const operation = async () => {
      await check();
      const binding = await bindings.requireBinding(ownerKey, input.revision);
      if (binding.revision !== input.revision) fail(409, 'TRONCLASS_BINDING_CHANGED');
      await check();
      const scope = { courseId: input.courseId, homeworkId: input.homeworkId };
      const authorizedFile = async () => {
        // This reader checks the owned course, complete assignment list,
        // visible individual activity and current student both before and
        // after reading history. It never accepts a caller-specified student.
        const raw = await readHistory(ownerKey, binding, scope, controller.signal);
        await check();
        const history = normalizeTronClassSubmissionHistory(raw, binding, scope, now());
        const entry = history.entries.find(row => row.id === input.submissionId);
        const file = entry?.attachments.find(item => item.download?.uploadId === input.uploadId);
        if (!file) fail(403, 'TRONCLASS_SUBMISSION_ATTACHMENT_DENIED');
        if (file.size !== null && file.size > TRONCLASS_DOWNLOAD_MAX_BYTES) fail(413, 'TRONCLASS_DOWNLOAD_TOO_LARGE');
        return file;
      };
      const file = await authorizedFile();
      const cookie = Object.entries(binding.cookies).map(([key, item]) => {
        if (!key || /[\s;=]/.test(key) || typeof item !== 'string' || /[;\r\n]/.test(item)) {
          fail(503, 'TRONCLASS_DOWNLOAD_UNAVAILABLE');
        }
        return `${key}=${item}`;
      }).join('; ');
      if (!cookie || cookie.length > 32 * 1024) fail(503, 'TRONCLASS_DOWNLOAD_UNAVAILABLE');
      await check();
      const response = await fetchFile(tronClassUploadHref(String(input.uploadId)), {
        method: 'GET', redirect: 'manual', cache: 'no-store', signal: controller.signal,
        headers: { Cookie: cookie, Accept: 'application/octet-stream, */*', 'Accept-Encoding': 'identity' },
      }, check);
      const downloaded = await readTronClassDownloadResponse(response, controller.signal, check);
      if (file.size !== null && file.size !== downloaded.bytes.byteLength) fail(503, 'TRONCLASS_DOWNLOAD_UNAVAILABLE');
      // No file bytes leave this process after the school removes the version,
      // revokes the download permission, changes the attachment, or unbinds.
      const latest = await authorizedFile();
      if (latest.name !== file.name || latest.size !== file.size) fail(409, 'TRONCLASS_SUBMISSION_ATTACHMENT_CHANGED');
      await check();
      return { ...downloaded, name: file.name };
    };
    try { return await Promise.race([operation(), deadline]); }
    catch (error) {
      controller.abort();
      if (error instanceof NuniError) throw error;
      if (classifySchoolReadError(error) === 'session') fail(401, 'TRONCLASS_RECONNECT_REQUIRED');
      fail(503, 'TRONCLASS_DOWNLOAD_UNAVAILABLE');
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (rejectDeadline) controller.signal.removeEventListener('abort', rejectDeadline);
    }
  };
}

import { NuniError } from '@campus/shared/src/nuni';

export type NativeTronClassDownloadInput = {
  courseId: number;
  activityId: number;
  uploadKey: string;
  revision: string;
};
export type NativeTronClassDownloadedFile = {
  bytes: Uint8Array;
  filename: string;
  contentType: string;
};
export const NATIVE_TRONCLASS_DOWNLOAD_MAX_BYTES = 25 * 1024 * 1024;

export function validNativeTronClassDownload(input: NativeTronClassDownloadInput): boolean {
  return (
    !!input &&
    typeof input === 'object' &&
    !Array.isArray(input) &&
    Object.keys(input).sort().join(',') === 'activityId,courseId,revision,uploadKey' &&
    [input.courseId, input.activityId].every((value) => Number.isSafeInteger(value) && value > 0) &&
    typeof input.revision === 'string' &&
    /^[a-f0-9]{32}$/.test(input.revision) &&
    typeof input.uploadKey === 'string' &&
    /^[A-Za-z0-9._-]{1,200}$/.test(input.uploadKey) &&
    !['.', '..'].includes(input.uploadKey)
  );
}
function invalid(): never {
  throw new NuniError(502, 'INVALID_RESPONSE');
}

async function boundedBody(
  response: Response,
  maximum: number,
  current: () => boolean,
): Promise<Uint8Array> {
  if (!response.body) return invalid();
  const reader = response.body.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      if (!current()) throw new NuniError(409, 'SESSION_CHANGED');
      const next = await reader.read();
      if (!current()) throw new NuniError(409, 'SESSION_CHANGED');
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maximum) throw new NuniError(413, 'TRONCLASS_DOWNLOAD_TOO_LARGE');
      chunks.push(next.value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/** Only this exact authenticated BFF accepts native downloads. No URL is accepted from the caller. */
export async function requestNativeTronClassDownload(
  authorization: string,
  input: NativeTronClassDownloadInput,
  isCurrent: () => boolean,
  signal?: AbortSignal,
): Promise<NativeTronClassDownloadedFile> {
  if (!validNativeTronClassDownload(input)) throw new NuniError(422, 'TRONCLASS_INVALID_INPUT');
  const scope = {
    courseId: input.courseId,
    activityId: input.activityId,
    uploadKey: input.uploadKey,
    revision: input.revision,
  };
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timer = setTimeout(abort, 60000);
  signal?.addEventListener('abort', abort, { once: true });
  const current = () => !signal?.aborted && !controller.signal.aborted && isCurrent();
  try {
    if (!current()) throw new NuniError(409, 'SESSION_CHANGED');
    // Expo's fetch provides a native ReadableStream; RN's older global fetch may buffer everything.
    const { fetch } = require('expo/fetch') as typeof import('expo/fetch');
    if (!current()) throw new NuniError(409, 'SESSION_CHANGED');
    const response = await fetch('https://nuni.tw/api/tronclass/material-download', {
      method: 'POST',
      redirect: 'error',
      credentials: 'omit',
      signal: controller.signal,
      headers: {
        Authorization: authorization,
        'Content-Type': 'application/json',
        Accept: '*/*',
        'Accept-Encoding': 'identity',
        'Cache-Control': 'no-store',
      },
      body: JSON.stringify(scope),
    });
    if (!current()) {
      await response.body?.cancel();
      throw new NuniError(409, 'SESSION_CHANGED');
    }
    if (!response.ok) {
      const bytes = await boundedBody(response, 16 * 1024, current);
      let code: unknown;
      try {
        code = JSON.parse(new TextDecoder().decode(bytes)).error;
      } catch {
        return invalid();
      }
      throw new NuniError(
        response.status,
        typeof code === 'string' && /^[A-Z0-9_]{1,100}$/.test(code) ? code : 'REQUEST_FAILED',
      );
    }
    const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
    const encoding = response.headers.get('content-encoding')?.trim().toLowerCase();
    const disposition = response.headers.get('content-disposition') ?? '';
    const encodedName = /(?:^|;)\s*filename\*\s*=\s*UTF-8''([^;]+)/i.exec(disposition)?.[1];
    const length = response.headers.get('content-length');
    if (
      (encoding && encoding !== 'identity') ||
      !contentType ||
      !/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(contentType) ||
      ['text/html', 'application/xhtml+xml'].includes(contentType) ||
      !/^attachment(?:;|$)/i.test(disposition) ||
      !encodedName ||
      !length ||
      !/^[1-9]\d*$/.test(length)
    ) {
      await response.body?.cancel();
      return invalid();
    }
    if (
      !Number.isSafeInteger(Number(length)) ||
      Number(length) > NATIVE_TRONCLASS_DOWNLOAD_MAX_BYTES
    ) {
      await response.body?.cancel();
      throw new NuniError(413, 'TRONCLASS_DOWNLOAD_TOO_LARGE');
    }
    let filename: string;
    try {
      filename = Array.from(decodeURIComponent(encodedName))
        .map((character) => {
          const code = character.charCodeAt(0);
          return code < 32 ||
            code === 127 ||
            (code >= 0x202a && code <= 0x202e) ||
            (code >= 0x2066 && code <= 0x2069) ||
            /[<>:"/\\|?*]/.test(character)
            ? '_'
            : character;
        })
        .join('')
        .trim()
        .slice(0, 200);
    } catch {
      await response.body?.cancel();
      return invalid();
    }
    if (!filename || filename === '.' || filename === '..') {
      await response.body?.cancel();
      return invalid();
    }
    const bytes = await boundedBody(response, NATIVE_TRONCLASS_DOWNLOAD_MAX_BYTES, current);
    if (bytes.byteLength !== Number(length)) return invalid();
    return { bytes, filename, contentType };
  } catch (error) {
    if (error instanceof NuniError) throw error;
    throw new NuniError(
      0,
      !isCurrent() || signal?.aborted
        ? 'SESSION_CHANGED'
        : controller.signal.aborted
          ? 'TRONCLASS_DOWNLOAD_TIMEOUT'
          : 'NETWORK_ERROR',
    );
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

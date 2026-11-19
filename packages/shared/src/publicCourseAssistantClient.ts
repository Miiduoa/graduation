import {
  formatPublicCourseAssistantRead,
  publicCourseAssistantRead,
  publicCourseAssistantSource,
  resolvePublicCourseAssistantIntent,
  type PublicCourseAssistantAnswer,
  type PublicCourseAssistantRead,
  type PublicCourseAssistantSearch,
} from './publicCourseAssistant';
import { parsePublicCourseFilterParams, parsePublicCourseFilters } from './publicCourseFilters';

export type {
  PublicCourseAssistantAnswer,
  PublicCourseAssistantRead,
} from './publicCourseAssistant';

const MAX_RESPONSE_BYTES = 512 * 1024;
const TIMEOUT_MS = 25_000;

/** Shared UTF-8 guard for the assistant and native catalog screens. */
export function exceedsPublicCourseResponseByteLimit(text: string): boolean {
  if (text.length > MAX_RESPONSE_BYTES) return true;
  let bytes = 0;
  // Native callers do not need a TextEncoder or Buffer polyfill.
  for (const character of text) {
    const code = character.codePointAt(0)!;
    bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
    if (bytes > MAX_RESPONSE_BYTES) return true;
  }
  return false;
}

// Bound public course responses as chunks arrive. response.text() alone can
// buffer an unbounded server reply before the 512 KiB post-read check runs.
// Native fetch implementations without ReadableStream/TextDecoder retain the
// existing post-read guard; do not assume they support browser streaming.
//
// Some fetch adapters ignore AbortSignal after sending response headers. Release
// their unread body explicitly when rejecting a response, without buffering it.
function cancelUnreadPublicCourseResponse(response: Response): void {
  const body = response.body;
  if (body && typeof body.cancel === 'function' && !body.locked) {
    void body.cancel().catch(() => undefined);
  }
}
async function readBoundedPublicCourseBody(response: Response, signal: AbortSignal): Promise<string> {
  const reader = typeof TextDecoder === 'function' ? response.body?.getReader?.() : undefined;
  if (!reader) {
    const text = await response.text();
    if (exceedsPublicCourseResponseByteLimit(text)) throw new Error('Public course response too large');
    return text;
  }

  // Fatal decoding preserves the same trust boundary as Web catalog search:
  // damaged UTF-8 must not become a plausible replacement-character course.
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const fragments: string[] = [];
  let bytes = 0;
  let finished = false;
  const cancelStream = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener('abort', cancelStream, { once: true });
  try {
    if (signal.aborted) throw cancelled();
    while (true) {
      const chunk = await reader.read();
      if (signal.aborted) throw cancelled();
      if (chunk.done) { finished = true; break; }
      bytes += chunk.value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) throw new Error('Public course response too large');
      fragments.push(decoder.decode(chunk.value, { stream: true }));
    }
    fragments.push(decoder.decode());
    return fragments.join('');
  } finally {
    signal.removeEventListener('abort', cancelStream);
    // Abort, invalid encoding and oversize all release the underlying body.
    if (!finished) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function cancelled(): Error {
  const error = new Error('Public course lookup cancelled');
  error.name = 'AbortError';
  return error;
}

/** Native fetch may follow redirects; reject a different final resource when its URL is available. */
export function isPublicCourseResponseUrl(
  value: string,
  search: Pick<PublicCourseAssistantSearch, 'schoolId' | 'query' | 'filters'>,
): boolean {
  try {
    const url = new URL(value);
    const expected = parsePublicCourseFilters(search.filters ?? {});
    const actual = parsePublicCourseFilterParams(url.searchParams);
    if (!expected || !actual) return false;
    const parameterCount =
      2 + Number(expected.weekday !== undefined) + Number(expected.credits !== undefined);
    return (
      url.origin === 'https://nuni.tw' &&
      url.pathname === '/api/public-course-catalog' &&
      !url.username &&
      !url.password &&
      !url.hash &&
      [...url.searchParams].length === parameterCount &&
      url.searchParams.getAll('schoolId').length === 1 &&
      url.searchParams.get('schoolId') === search.schoolId &&
      url.searchParams.getAll('q').length === 1 &&
      url.searchParams.get('q') === search.query &&
      actual.weekday === expected.weekday &&
      actual.credits === expected.credits
    );
  } catch {
    return false;
  }
}

/** Anonymous public read. Neither the conversation nor account data is sent to this endpoint. */
export async function answerPublicCourseQuestion(input: {
  question: string;
  schoolId: string;
  origin: 'web' | 'mobile';
  signal?: AbortSignal;
  isCurrent?: () => boolean;
  fetcher?: typeof fetch;
}): Promise<PublicCourseAssistantAnswer | null> {
  const current = () => !input.signal?.aborted && (input.isCurrent?.() ?? true);
  if (!current()) throw cancelled();
  const intent = resolvePublicCourseAssistantIntent(input.question, input.schoolId);
  if (!intent) return null;
  if (intent.kind === 'clarify') return { content: intent.content };
  if (input.origin !== 'web' && input.origin !== 'mobile')
    throw new Error('Invalid public course origin');

  const source = publicCourseAssistantSource(intent);
  const controller = new AbortController();
  let rejectCancelled!: (error: Error) => void;
  let rejectTimeout!: (error: Error) => void;
  const abort = () => {
    controller.abort();
    rejectCancelled(cancelled());
  };
  const cancellation = new Promise<never>((_, reject) => {
    rejectCancelled = reject;
  });
  const timeout = new Promise<never>((_, reject) => {
    rejectTimeout = reject;
  });
  input.signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => {
    controller.abort();
    rejectTimeout(new Error('Public course lookup timed out'));
  }, TIMEOUT_MS);
  const fetcher = input.fetcher ?? globalThis.fetch;
  try {
    const params = new URLSearchParams({ schoolId: intent.schoolId, q: intent.query });
    if (source.filters?.weekday !== undefined)
      params.set('weekday', String(source.filters.weekday));
    if (source.filters?.credits !== undefined)
      params.set('credits', String(source.filters.credits));
    const url =
      (input.origin === 'mobile' ? 'https://nuni.tw' : '') + '/api/public-course-catalog?' + params;
    const request = (async () => {
      const response = await fetcher(url, {
        method: 'GET',
        signal: controller.signal,
        credentials: 'omit',
        redirect: 'error',
        // whatwg-fetch on React Native adds an unsupported `_` query for no-store.
        // The API itself sends Cache-Control: no-store on both platforms.
        ...(input.origin === 'web' ? { cache: 'no-store' as const } : {}),
        headers: { Accept: 'application/json' },
      });
      if (!current() || controller.signal.aborted) {
        // Some native fetch adapters ignore abort after resolving the headers.
        // A late response must not keep downloading data for the old school.
        cancelUnreadPublicCourseResponse(response);
        throw cancelled();
      }
      if (
        input.origin === 'mobile' &&
        response.url &&
        !isPublicCourseResponseUrl(response.url, intent)
      ) {
        cancelUnreadPublicCourseResponse(response);
        controller.abort();
        throw new Error('Unexpected public course response URL');
      }
      const lengthHeader = response.headers.get('content-length');
      const declaredBytes = lengthHeader === null ? 0 : Number(lengthHeader);
      const contentType = response.headers.get('content-type');
      // Match the native catalog's metadata guard before reading untrusted bodies.
      if (!response.ok ||
          (lengthHeader !== null && (!/^\d+$/.test(lengthHeader.trim()) ||
            !Number.isSafeInteger(declaredBytes) || declaredBytes > MAX_RESPONSE_BYTES)) ||
          (contentType !== null && !/^application\/json(?:\s*;|\s*$)/i.test(contentType.trim()))) {
        cancelUnreadPublicCourseResponse(response);
        controller.abort();
        throw new Error('Public course source unavailable');
      }
      const body = await readBoundedPublicCourseBody(response, controller.signal);
      if (!current() || controller.signal.aborted) throw cancelled();
      return publicCourseAssistantRead(intent, JSON.parse(body) as unknown);
    })();
    const read = await Promise.race([request, cancellation, timeout]);
    if (!current()) throw cancelled();
    return { content: formatPublicCourseAssistantRead(read), read };
  } catch {
    if (!current()) throw cancelled();
    const read: PublicCourseAssistantRead = { ...source, status: 'unavailable' };
    return { content: formatPublicCourseAssistantRead(read), read };
  } finally {
    clearTimeout(timer);
    input.signal?.removeEventListener('abort', abort);
  }
}

import type { PersonalImportOptions } from './types';

export const PERSONAL_IMPORT_CLOUD_IMAGE_MAX_BYTES = 4 * 1024 * 1024;
export const PERSONAL_IMPORT_CLOUD_IMAGE_TIMEOUT_MS = 42_000;
export const PERSONAL_IMPORT_CLOUD_IMAGE_NOTICE =
  '雲端看圖會將截圖的圖片內容傳送給 Cloudflare 視覺模型；圖片中可能包含姓名、學號等個資，無法在傳送前保證已遮罩。';

export type PersonalImportCloudImageResult =
  | { ok: true; output: string }
  | { ok: false; reason: 'unauthenticated' | 'disabled' | 'quota' | 'timeout' | 'invalid-input' | 'unavailable'; message: string };

const failures: Record<Exclude<PersonalImportCloudImageResult, { ok: true }>['reason'], string> = {
  unauthenticated: '需要登入才能使用雲端看圖。',
  disabled: '雲端圖片辨識尚未啟用。',
  quota: '今日雲端圖片辨識額度已用完。',
  timeout: '雲端圖片辨識逾時。',
  'invalid-input': '圖片格式或大小不符合雲端辨識限制。',
  unavailable: '雲端圖片辨識暫時不可用。',
};

export async function requestPersonalImportCloudImage(input: {
  base64: string;
  mime: 'image/png' | 'image/jpeg' | 'image/webp';
  kind: PersonalImportOptions['kind'];
  academicYear?: string;
  semester?: string;
  explicitConsent: boolean;
  headers?: Record<string, string>;
  endpoint?: string;
  signal?: AbortSignal;
  fetcher?: typeof fetch;
  timeoutMs?: number;
}): Promise<PersonalImportCloudImageResult> {
  const failure = (reason: Exclude<PersonalImportCloudImageResult, { ok: true }>['reason']): PersonalImportCloudImageResult =>
    ({ ok: false, reason, message: failures[reason] });
  if (!input.explicitConsent || input.kind !== 'timetable' ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(input.base64) ||
    input.base64.length > Math.ceil(PERSONAL_IMPORT_CLOUD_IMAGE_MAX_BYTES / 3) * 4 + 4)
    return failure('invalid-input');
  if (input.signal?.aborted) throw new Error('已取消雲端圖片辨識。');
  const controller = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => controller.abort();
  input.signal?.addEventListener('abort', cancel, { once: true });
  timer = setTimeout(() => { timedOut = true; controller.abort(); }, input.timeoutMs ?? PERSONAL_IMPORT_CLOUD_IMAGE_TIMEOUT_MS);
  try {
    const response = await (input.fetcher ?? fetch)(input.endpoint ?? '/api/personal-import/recognize-image', {
      method: 'POST', credentials: 'include', cache: 'no-store',
      headers: { ...input.headers, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        kind: input.kind, mime: input.mime, imageBase64: input.base64, explicitConsent: true,
        academicYear: (input.academicYear ?? '').slice(0, 12),
        semester: (input.semester ?? '').slice(0, 12),
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      if ([401, 403, 409].includes(response.status)) return failure('unauthenticated');
      if (response.status === 429) return failure('quota');
      if ([408, 504].includes(response.status)) return failure('timeout');
      if ([400, 413, 422].includes(response.status)) return failure('invalid-input');
      let code: unknown;
      try { code = (await response.json()).code; } catch { /* 不顯示上游錯誤內容。 */ }
      return failure(code === 'disabled' ? 'disabled' : 'unavailable');
    }
    const json: unknown = await response.json();
    if (!json || typeof json !== 'object') return failure('unavailable');
    const result = json as Record<string, unknown>;
    if (result.provider !== 'cloud-vision' || typeof result.output !== 'string' ||
      !result.output.trim() || result.output.length > 80_000) return failure('unavailable');
    return { ok: true, output: result.output };
  } catch {
    if (input.signal?.aborted) throw new Error('已取消雲端圖片辨識。');
    return failure(timedOut ? 'timeout' : 'unavailable');
  } finally {
    clearTimeout(timer);
    input.signal?.removeEventListener('abort', cancel);
  }
}

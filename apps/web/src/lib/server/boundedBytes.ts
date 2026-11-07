import { NuniError } from '@campus/shared/src/nuni';
import { WAKE_REQUEST_TIMEOUT_MS } from '@campus/shared/src/wakeAwareRequest';

export async function boundedBytes(source: Request | Response, limit: number): Promise<Buffer<ArrayBuffer>> {
  const declared = source.headers.get('content-length');
  if (declared && Number(declared) > limit) {
    void source.body?.cancel().catch(() => {});
    throw new NuniError(413, 'BODY_TOO_LARGE');
  }
  if (!source.body) throw new NuniError(400, 'INVALID_INPUT');
  const reader = source.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new NuniError(503, 'READ_TIMEOUT')), WAKE_REQUEST_TIMEOUT_MS);
  });
  try {
    while (true) {
      const result = await Promise.race([reader.read(), deadline]);
      if (result.done) break;
      size += result.value.byteLength;
      if (size > limit) throw new NuniError(413, 'BODY_TOO_LARGE');
      chunks.push(result.value);
    }
    return Buffer.concat(chunks);
  } catch (error) {
    void reader.cancel().catch(() => {});
    if (error instanceof NuniError) throw error;
    throw new NuniError(400, 'INVALID_INPUT');
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }
}

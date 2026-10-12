import { PUBLIC_BUS_SOURCE, parsePublicBusStops, type PublicBusDirectory } from './publicBusStops';

export function createPublicBusDirectory({ fetcher = fetch, now = Date.now }: { fetcher?: typeof fetch; now?: () => number } = {}) {
  let cached: PublicBusDirectory | null = null;
  let loadedAt = 0, retryAt = 0;
  let pending: Promise<PublicBusDirectory> | null = null;
  async function load(): Promise<PublicBusDirectory> {
    const response = await fetcher(PUBLIC_BUS_SOURCE.download, {
      cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15_000),
      headers: { Accept: 'text/csv, application/octet-stream;q=0.9, */*;q=0.1' },
    });
    if (!response.ok || !response.body) throw new Error('source-unavailable');
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let bytes = 0, content = '';
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 12_000_000) { await reader.cancel(); throw new Error('source-too-large'); }
        content += decoder.decode(value, { stream: true });
      }
      content += decoder.decode();
    } finally { reader.releaseLock(); }
    const stops = parsePublicBusStops(content);
    cached = { status: 'ready', fetchedAt: new Date(now()).toISOString(), stale: false, stops, source: PUBLIC_BUS_SOURCE };
    loadedAt = now(); retryAt = 0;
    return cached;
  }
  return async function directory(): Promise<PublicBusDirectory> {
    if (cached && now() - loadedAt < 6 * 60 * 60_000) return cached;
    if (pending) return pending;
    if (now() < retryAt) {
      if (cached && now() - loadedAt < 24 * 60 * 60_000) return { ...cached, stale: true };
      throw new Error('source-unavailable');
    }
    pending = load().catch(() => {
      retryAt = now() + 60_000;
      if (cached && now() - loadedAt < 24 * 60 * 60_000) return { ...cached, stale: true };
      throw new Error('source-unavailable');
    }).finally(() => { pending = null; });
    return pending;
  };
}

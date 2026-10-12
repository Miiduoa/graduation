import { createTransitService } from '@/lib/transit-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const execute = createTransitService({
  credentials: () => ({ clientId: process.env.TDX_CLIENT_ID, clientSecret: process.env.TDX_CLIENT_SECRET }),
});
const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };

export async function POST(request: Request): Promise<Response> {
  if (request.headers.get('sec-fetch-site') === 'cross-site')
    return Response.json({ status: 'unavailable', reason: 'invalid-query' }, { status: 403, headers });
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))
    return Response.json({ status: 'unavailable', reason: 'invalid-query' }, { status: 415, headers });
  const reader = request.body?.getReader();
  if (!reader) return Response.json({ status: 'unavailable', reason: 'invalid-query' }, { status: 400, headers });
  let size = 0;
  let body = '';
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2048) {
        await reader.cancel();
        return Response.json({ status: 'unavailable', reason: 'invalid-query' }, { status: 413, headers });
      }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
    const result = await execute(JSON.parse(body));
    const status = result.status === 'ready' ? 200 : result.reason === 'invalid-query' ? 400 : result.reason === 'rate-limited' ? 429 : 503;
    return Response.json(result, { status, headers: status === 429 ? { ...headers, 'Retry-After': '60' } : headers });
  } catch {
    return Response.json({ status: 'unavailable', reason: 'invalid-query' }, { status: 400, headers });
  } finally { reader.releaseLock(); }
}

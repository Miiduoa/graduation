import { createPublicBusDirectory } from '@/lib/publicBusServer';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const directory = createPublicBusDirectory();
export async function GET(): Promise<Response> {
  try {
    const result = await directory();
    return Response.json(result, { headers: {
      'Cache-Control': result.stale ? 'no-store' : 'public, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    } });
  } catch {
    return Response.json({ status: 'unavailable', reason: 'source-unavailable' }, {
      status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '60', 'X-Content-Type-Options': 'nosniff' },
    });
  }
}

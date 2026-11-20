export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// This checks the two web processes, not school/provider or database acceptance.
export async function GET() {
  const legacyEnabled = process.env.CAMPUS_LEGACY_ENABLED === 'true';
  let legacyReady = !legacyEnabled;
  if (legacyEnabled) {
    try {
      const response = await fetch('http://127.0.0.1:3001/health/live', {
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(1500),
      });
      const body = response.ok ? await response.json() : null;
      legacyReady = body?.status === 'ok' && body?.service === 'campus-web';
    } catch {
      legacyReady = false;
    }
  }
  const revision = /^[a-f0-9]{40}$/.test(process.env.CAMPUS_RELEASE_SHA ?? '')
    ? process.env.CAMPUS_RELEASE_SHA
    : null;
  return Response.json(
    {
      service: 'campus-one-web',
      status: legacyReady ? 'ready' : 'unavailable',
      revision,
      legacy: legacyEnabled ? (legacyReady ? 'ready' : 'unavailable') : 'disabled',
    },
    {
      status: legacyReady ? 200 : 503,
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    },
  );
}

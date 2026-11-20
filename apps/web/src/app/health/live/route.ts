export const dynamic = 'force-dynamic';

// Liveness only: backend access is verified separately before a release.
export function GET() {
  return Response.json(
    { service: 'campus-one-web', status: 'ok' },
    { headers: { 'Cache-Control': 'no-store, max-age=0' } },
  );
}

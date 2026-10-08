import { NextRequest } from 'next/server';
import { handlePlatformAdmin } from '@/lib/platform-gateway';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ path: string[] }> };
export async function GET(request: NextRequest, context: Context) {
  return handlePlatformAdmin(request, (await context.params).path);
}
export const POST = GET;

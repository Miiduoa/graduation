import { NextRequest } from 'next/server';
import { handleNuni } from '@/lib/nuni/api';

type Context = { params: Promise<{ path: string[] }> };
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest, context: Context) {
  return handleNuni(request, (await context.params).path);
}
export const POST = GET;

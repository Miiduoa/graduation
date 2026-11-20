import { NextRequest } from 'next/server';
import { handleCafeteriaDetail } from '@/lib/nuni/cafeteriaCatalog';

type Context = { params: Promise<{ id: string }> };
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest, context: Context) {
  return handleCafeteriaDetail(request, decodeURIComponent((await context.params).id));
}

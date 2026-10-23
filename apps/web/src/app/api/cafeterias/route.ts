import { NextRequest } from 'next/server';
import { handleCafeteriaCatalog } from '@/lib/nuni/cafeteriaCatalog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function GET(request: NextRequest) {
  return handleCafeteriaCatalog(request);
}

import { NextRequest } from 'next/server';
import { schoolDirectory } from '@/lib/platform-gateway';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function GET(request: NextRequest) {
  return schoolDirectory(request);
}

import type { NextRequest } from 'next/server';
import { handleTronClassMaterialDownload } from '@/lib/server/tronClassMaterialDownloadRoute';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  return handleTronClassMaterialDownload(request);
}

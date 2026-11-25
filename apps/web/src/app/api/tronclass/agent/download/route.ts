import type { NextRequest } from 'next/server';
import { handleTronClassAgentDownload } from '@/lib/server/tronClassAgentDownloadRoute';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

export async function POST(request: NextRequest) {
  return handleTronClassAgentDownload(request);
}

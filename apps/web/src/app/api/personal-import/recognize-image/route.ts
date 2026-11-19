import type { NextRequest } from 'next/server';
import { handlePersonalImportCloudImage } from '@/lib/server/personalImportCloudImage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 45;

export function POST(request: NextRequest): Promise<Response> {
  return handlePersonalImportCloudImage(request);
}

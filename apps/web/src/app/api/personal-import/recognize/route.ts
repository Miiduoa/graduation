import type { NextRequest } from 'next/server';
import { handlePersonalImportCloud } from '@/lib/server/personalImportCloud';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export function POST(request: NextRequest): Promise<Response> {
  return handlePersonalImportCloud(request);
}

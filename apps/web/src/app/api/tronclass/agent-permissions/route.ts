import type { NextRequest } from 'next/server';
import { handleTronClassAgentPermissions } from '@/lib/server/tronClassAgentPermissionsRoute';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(request: NextRequest) {
  return handleTronClassAgentPermissions(request);
}

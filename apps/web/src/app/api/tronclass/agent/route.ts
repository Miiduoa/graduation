import type { NextRequest } from 'next/server';
import { handleTronClassAgent } from '@/lib/server/tronClassAgentRoute';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

export async function POST(request: NextRequest) {
  return handleTronClassAgent(request);
}

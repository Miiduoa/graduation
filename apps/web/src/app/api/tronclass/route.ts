import type { NextRequest } from 'next/server';
import { handleTronClassIntegration } from '@/lib/server/tronClassIntegrationRoute';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

export async function POST(request: NextRequest) {
  return handleTronClassIntegration(request);
}

export const PUT = POST;

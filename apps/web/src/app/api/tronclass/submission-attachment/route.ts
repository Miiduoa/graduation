import type { NextRequest } from 'next/server';
import { handleTronClassSubmissionAttachmentDownload } from '@/lib/server/tronClassSubmissionAttachmentDownloadRoute';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  return handleTronClassSubmissionAttachmentDownload(request);
}

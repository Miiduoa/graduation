import { dispatchPrivateFileRequest } from '@/lib/server/privateFileRoutes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function handle(request: Request): Promise<Response> {
  return dispatchPrivateFileRequest(request);
}

export const POST = handle;
export const OPTIONS = handle;

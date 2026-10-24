import { dispatchFnRequest } from '@/lib/server/fnDispatch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ name: string }> };

async function handle(request: Request, context: Context): Promise<Response> {
  const { name } = await context.params;
  return dispatchFnRequest(name, request);
}

export const GET = handle;
export const POST = handle;
export const OPTIONS = handle;

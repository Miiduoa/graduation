import { dispatchFnRequest } from '@/lib/server/fnDispatch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** 學號登入 e 校園重試加上背景 TronClass／CAS after() 工作。 */
export const maxDuration = 120;

type Context = { params: Promise<{ name: string }> };

async function handle(request: Request, context: Context): Promise<Response> {
  const { name } = await context.params;
  return dispatchFnRequest(name, request);
}

export const GET = handle;
export const POST = handle;
export const OPTIONS = handle;

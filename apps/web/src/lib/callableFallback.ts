import { httpsCallable } from 'firebase/functions';
import { getAuth, getFunctionsInstance } from './firebase';
import { areFunctionsConfigured } from './cloudFunctions';
import { FunctionsUnconfiguredError } from './functionsUrl';
import { hostedWebCallablePath } from './hostedCallables';

export function isCallableMissing(error: unknown): boolean {
  if (error instanceof FunctionsUnconfiguredError) return true;
  if (!error || typeof error !== 'object') return false;
  const e = error as { code?: unknown; name?: unknown; status?: unknown; response?: { status?: unknown } };
  return e.name === 'FunctionsUnconfiguredError' ||
    ['functions/not-found', 'functions/unconfigured', 'NOT_FOUND'].includes(String(e.code)) ||
    e.status === 404 || e.status === 'NOT_FOUND' || e.response?.status === 404;
}

/** Only these three deployed web handlers may replace an absent Firebase callable. */
export async function callWithHostedFallback<Input, Output>(
  name: 'prepareDmConversation' | 'sendDmText' | 'replyToCampusStory',
  data: Input,
  viewerUid: string,
  signal?: AbortSignal,
): Promise<{ data: Output }> {
  if (areFunctionsConfigured()) {
    try {
      return await httpsCallable<Input, Output>(getFunctionsInstance(), name)(data);
    } catch (error) {
      if (!isCallableMissing(error)) throw error;
    }
  }
  const user = getAuth()?.currentUser;
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  if (!user || user.uid !== viewerUid) throw Object.assign(new Error('請先登入。'), { code: 'functions/unauthenticated' });
  const token = await user.getIdToken();
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  if (getAuth()?.currentUser?.uid !== viewerUid) throw Object.assign(new Error('請先登入。'), { code: 'functions/unauthenticated' });
  const response = await fetch(hostedWebCallablePath(name), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ data }),
    signal,
  });
  const body = await response.json();
  if (!response.ok || body.error) {
    const status = String(body.error?.status || 'internal').toLowerCase().replaceAll('_', '-');
    throw Object.assign(new Error(body.error?.message || '目前無法使用。'), { code: `functions/${status}` });
  }
  return { data: body.result as Output };
}

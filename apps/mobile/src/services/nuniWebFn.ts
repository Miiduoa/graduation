import { getAuthInstance } from '../firebase';

const HOSTED_FN_ORIGIN = 'https://nuni.tw/api/fn';

function requireViewer(viewerUid: string, signal?: AbortSignal) {
  if (signal?.aborted) throw Object.assign(new Error('對話已切換。'), { code: 'cancelled' });
  const user = getAuthInstance().currentUser;
  if (!user || user.uid !== viewerUid || typeof user.getIdToken !== 'function') {
    throw Object.assign(new Error('請先登入。'), { code: 'functions/unauthenticated' });
  }
  return user;
}

/** POST a hosted nuni-web callable. Permission checks stay in the existing callers and handlers. */
export async function postNuniWebFn<Input, Output>(
  name: 'listGroupDiscussionPage' | 'dormWorkflow' | 'prepareDmConversation' | 'sendDmText' | 'replyToCampusStory',
  data: Input,
  viewerUid: string,
  signal?: AbortSignal,
): Promise<Output> {
  const token = await requireViewer(viewerUid, signal).getIdToken();
  requireViewer(viewerUid, signal);
  let response: Response;
  try {
    response = await fetch(`${HOSTED_FN_ORIGIN}/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ data }),
      signal,
    });
  } catch (error) {
    if (signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
      throw Object.assign(new Error('對話已切換。'), { code: 'cancelled' });
    }
    throw error;
  }
  if (signal?.aborted) throw Object.assign(new Error('對話已切換。'), { code: 'cancelled' });
  const body = await response.json();
  // Dorm requests have no navigation abort signal. The screen's owner must still
  // hold the Firebase session before a resident record or receipt leaves this boundary.
  if (name === 'dormWorkflow') requireViewer(viewerUid, signal);
  if (!response.ok || body.error) {
    const status = String(body.error?.status || 'internal').toLowerCase().replaceAll('_', '-');
    throw Object.assign(new Error(body.error?.message || '目前無法使用。'), { code: `functions/${status}` });
  }
  return body.result as Output;
}

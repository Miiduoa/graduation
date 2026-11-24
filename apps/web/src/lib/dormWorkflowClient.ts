import { getAuth, getCloudFunctionUrl } from './firebase';

export class DormWorkflowRequestError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

export async function invokeDormWorkflow<T>(data: Record<string, unknown>, expectedUid?: string): Promise<T> {
  const user = getAuth()?.currentUser;
  if (!user || (expectedUid !== undefined && user.uid !== expectedUid)) throw new Error('請先登入。');
  const token = await user.getIdToken();
  if (getAuth()?.currentUser?.uid !== user.uid) throw new Error('請先登入。');
  const response = await fetch(getCloudFunctionUrl('dormWorkflow'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ data }),
  });
  const body = await response.json();
  if (!response.ok || body.error) {
    throw new DormWorkflowRequestError(response.status, body.error?.message || '宿舍服務暫時無法使用。');
  }
  if (expectedUid !== undefined && getAuth()?.currentUser?.uid !== expectedUid) throw new Error('請重新登入。');
  return body.result as T;
}

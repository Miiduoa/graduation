import { httpsCallable } from 'firebase/functions';
import { getAuthInstance, getFunctionsInstance, isFirebaseMockMode } from '../firebase';

/**
 * DM media is delivered by an authenticated callable rather than Firebase
 * Storage SDK. Storage rules cannot inspect conversation + profile + school
 * membership (three distinct Firestore documents; limit is two).
 *
 * Persist the object `path` in a message, NEVER `previewUrl` or a signed
 * POST policy. Resolve a fresh one-minute URL when the member opens the file.
 */
export type DmAttachment = {
  path: string;
  previewUrl: string;
  previewExpiresAt: string;
};

type UploadGrant = {
  method: 'POST';
  url: string;
  fields: Record<string, string>;
  path: string;
  mediaId: string;
  expiresAt: string;
};
type ReadGrant = { url: string; expiresAt: string };

const objectPath = /^conversations\/([A-Za-z0-9._-]{1,1500})\/(media|messages)\/([A-Za-z0-9._-]{1,1500})\/([A-Za-z0-9._-]{1,1500})$/;

function signedInUid() {
  const uid = getAuthInstance().currentUser?.uid;
  if (isFirebaseMockMode() || !uid) throw new Error('請先登入才能存取私訊附件。');
  return uid;
}
function sameSession(uid: string) {
  if (isFirebaseMockMode() || getAuthInstance().currentUser?.uid !== uid) {
    throw new Error('帳號已切換，請重新開啟對話。');
  }
}
function secureUrl(value: unknown): value is string {
  return typeof value === 'string' && /^https:\/\/[^\s/]+\//.test(value);
}
function objectParts(path: string) {
  const match = objectPath.exec(path);
  if (!match || [match[1], match[3], match[4]].some((x) => x === '.' || x === '..')) {
    throw new Error('無效的私訊附件路徑。');
  }
  return {
    conversationId: match[1],
    folder: match[2] as 'media' | 'messages',
    mediaId: match[3],
    fileName: match[4],
  };
}

async function delivery<T>(uid: string, payload: Record<string, unknown>): Promise<T> {
  sameSession(uid);
  const callable = httpsCallable<Record<string, unknown>, T>(
    getFunctionsInstance(), 'dmAttachmentDelivery',
  );
  const response = await callable(payload);
  sameSession(uid);
  return response.data;
}

/** Fetch a new, short-lived link. Never cache or persist this link as a message. */
export async function getDmAttachmentUrl(path: string): Promise<ReadGrant> {
  const uid = signedInUid();
  const parts = objectParts(path);
  const grant = await delivery<ReadGrant>(uid, { action: 'read', ...parts });
  if (!secureUrl(grant?.url) || typeof grant.expiresAt !== 'string') {
    throw new Error('無法確認附件下載權限。');
  }
  return grant;
}

/** Upload by signed GCS POST: no Firebase download token is created. */
export async function uploadDmAttachment(
  conversationId: string,
  localUri: string,
  fileName: string,
  contentType: string,
): Promise<DmAttachment> {
  const uid = signedInUid();
  if (!/^[A-Za-z0-9._-]{1,1500}$/.test(conversationId) ||
      conversationId === '.' || conversationId === '..') {
    throw new Error('無效的私訊對話。');
  }
  const safeName = fileName.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, 'file_').slice(0, 120);
  if (!safeName || safeName === '.' || safeName === '..') throw new Error('無效的附件名稱。');

  const source = await fetch(localUri);
  if ('ok' in source && !source.ok) throw new Error('無法讀取要上傳的附件。');
  const blob = await source.blob();
  if (!blob.size) throw new Error('附件不得為空。');
  sameSession(uid);

  const grant = await delivery<UploadGrant>(uid, {
    action: 'upload', conversationId, fileName: safeName, contentType, size: blob.size,
  });
  if (grant?.method !== 'POST' || !secureUrl(grant.url) ||
      typeof grant.fields !== 'object' || grant.fields === null ||
      Object.values(grant.fields).some((value) => typeof value !== 'string') ||
      typeof grant.path !== 'string' || objectParts(grant.path).conversationId !== conversationId) {
    throw new Error('無法確認附件上傳權限。');
  }
  const form = new FormData();
  for (const [key, value] of Object.entries(grant.fields)) form.append(key, value);
  // GCS signed POST requires the file field last; the policy enforces MIME and size.
  form.append('file', blob, safeName);
  sameSession(uid);
  const uploaded = await fetch(grant.url, { method: 'POST', body: form });
  sameSession(uid);
  if (!uploaded.ok) throw new Error('附件上傳失敗，請重試。');
  const preview = await getDmAttachmentUrl(grant.path);
  sameSession(uid);
  return { path: grant.path, previewUrl: preview.url, previewExpiresAt: preview.expiresAt };
}

import { httpsCallable } from 'firebase/functions';
import { getAuth, getFunctionsInstance } from './firebase';

export type PhotoScope = {
  viewerUid: string;
  schoolId: string;
  conversationId: string;
  messageId: string;
  peerUid?: string;
};
const extensions = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
]);
export const photoAccept = [...extensions.keys()].join(',');
export function validDmPhoto(file: File) {
  return extensions.has(file.type) && file.size > 0 && file.size < 10 * 1024 * 1024;
}

const segment = /^(?!\.{1,2}$)[A-Za-z0-9._-]{1,1500}$/;
export function parseDmPhotoPath(path: unknown, conversationId: string, published = true) {
  if (typeof path !== 'string' || !segment.test(conversationId)) return null;
  const [root, thread, folder, mediaId, fileName, ...rest] = path.split('/');
  if (
    root !== 'conversations' ||
    thread !== conversationId ||
    folder !== 'photos' ||
    rest.length ||
    !mediaId ||
    !segment.test(mediaId) ||
    !(published ? /^sent\.(jpg|png|webp)$/ : /^photo\.(jpg|png|webp)$/).test(fileName)
  )
    return null;
  return { mediaId, fileName };
}

function checkSession(scope: PhotoScope, signal: AbortSignal) {
  if (signal.aborted || getAuth()?.currentUser?.uid !== scope.viewerUid)
    throw new Error('photo-session');
}

type Grant = { url: string; expiresAt: string };
function checkGrant(grant: Grant) {
  const url = new URL(grant.url);
  const expires = Date.parse(grant.expiresAt);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    !(
      url.hostname === 'storage.googleapis.com' || url.hostname.endsWith('.storage.googleapis.com')
    ) ||
    !Number.isFinite(expires) ||
    expires <= Date.now()
  )
    throw new Error('photo-grant');
  return url;
}

export async function uploadDmPhoto(scope: PhotoScope, file: File, signal: AbortSignal) {
  checkSession(scope, signal);
  if (!validDmPhoto(file)) throw new Error('photo-file');
  const fileName = `photo.${extensions.get(file.type)}`;
  type Input = PhotoScope & {
    action: 'uploadPhoto';
    fileName: string;
    contentType: string;
    size: number;
  };
  type Upload = Grant & {
    method: string;
    path: string;
    mediaId: string;
    fields: Record<string, string>;
  };
  const call = httpsCallable<Input, Upload>(getFunctionsInstance(), 'dmAttachmentDelivery');
  const { data } = await call({
    ...scope,
    action: 'uploadPhoto',
    fileName,
    contentType: file.type,
    size: file.size,
  });
  checkSession(scope, signal);
  checkGrant(data);
  const parts = parseDmPhotoPath(data.path, scope.conversationId, false);
  if (
    data.method !== 'POST' ||
    !parts ||
    parts.fileName !== fileName ||
    parts.mediaId !== data.mediaId ||
    data.fields?.key !== data.path
  )
    throw new Error('photo-policy');
  const body = new FormData();
  for (const [name, value] of Object.entries(data.fields)) body.append(name, value);
  body.append('file', file, fileName);
  const response = await fetch(data.url, {
    method: 'POST',
    body,
    signal,
    credentials: 'omit',
    redirect: 'error',
    referrerPolicy: 'no-referrer',
  });
  if (!response.ok) throw new Error('photo-upload');
  checkSession(scope, signal);
  return data.path;
}

export async function confirmDmPhoto(scope: PhotoScope, path: string, signal: AbortSignal) {
  checkSession(scope, signal);
  if (!parseDmPhotoPath(path, scope.conversationId, false)) throw new Error('photo-path');
  const call = httpsCallable<
    PhotoScope & { path: string },
    { conversationId: string; messageId: string }
  >(getFunctionsInstance(), 'sendDmPhoto');
  const { data } = await call({ ...scope, path });
  checkSession(scope, signal);
  if (data?.conversationId !== scope.conversationId || data.messageId !== scope.messageId)
    throw new Error('photo-unconfirmed');
}

export async function readDmPhoto(scope: PhotoScope, path: string, signal: AbortSignal) {
  checkSession(scope, signal);
  const parts = parseDmPhotoPath(path, scope.conversationId);
  if (!parts) throw new Error('photo-path');
  type Input = PhotoScope & { action: 'read'; folder: 'photos'; mediaId: string; fileName: string };
  const call = httpsCallable<Input, Grant>(getFunctionsInstance(), 'dmAttachmentDelivery');
  const { data } = await call({ ...scope, action: 'read', folder: 'photos', ...parts });
  checkSession(scope, signal);
  const url = checkGrant(data);
  const object =
    url.hostname === 'storage.googleapis.com'
      ? url.pathname.split('/').slice(2).join('/')
      : url.pathname.slice(1);
  if (
    object !== path ||
    !url.searchParams.get('X-Goog-Signature') ||
    url.searchParams.has('token')
  ) {
    throw new Error('photo-read');
  }
  return data;
}

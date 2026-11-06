import { File as NativeFile } from 'expo-file-system';
import { httpsCallable } from 'firebase/functions';
import { getAuthInstance, getFunctionsInstance, isFirebaseMockMode } from '../firebase';
import { deriveDmConversationId } from '../utils/conversationAccess';

export type PhotoThread = { viewerUid: string; schoolId: string; conversationId: string; peerUid?: string };
export type PhotoScope = PhotoThread & { messageId: string };
export type LocalPhoto = { uri: string; contentType: string; size: number };
type Grant = { url: string; expiresAt: string };
type UploadGrant = Grant & {
  method: string;
  fields: Record<string, string>;
  path: string;
  mediaId: string;
};
const filenames = new Map([
  ['image/jpeg', 'photo.jpg'],
  ['image/png', 'photo.png'],
  ['image/webp', 'photo.webp'],
]);
const limit = 10 * 1024 * 1024;
const segment = /^(?!\.{1,2}$)[A-Za-z0-9._-]{1,120}$/;
export const photoFormatHint = '請選擇小於 10 MiB 的 JPG、PNG 或 WebP 照片。';

export function localPhoto(uri: string, mimeType?: string | null): LocalPhoto {
  if (!/^file:\/\//.test(uri)) throw new Error(photoFormatHint);
  const file = new NativeFile(uri);
  const contentType = mimeType || file.type;
  const size = file.size;
  if (
    !file.exists ||
    !filenames.has(contentType) ||
    !Number.isSafeInteger(size) ||
    size <= 0 ||
    size >= limit
  )
    throw new Error(photoFormatHint);
  return { uri, contentType, size };
}

export function photoParts(path: unknown, conversationId: string, published = true) {
  if (typeof path !== 'string' || !segment.test(conversationId)) return null;
  const [root, thread, folder, mediaId, fileName, ...rest] = path.split('/');
  if (
    root !== 'conversations' ||
    thread !== conversationId ||
    folder !== 'photos' ||
    !mediaId ||
    !segment.test(mediaId) ||
    rest.length ||
    !(published ? /^sent\.(jpg|png|webp)$/ : /^photo\.(jpg|png|webp)$/).test(fileName)
  )
    return null;
  return { mediaId, fileName };
}

function checkSession(scope: PhotoScope, signal: AbortSignal) {
  if (
    signal.aborted ||
    isFirebaseMockMode() ||
    getAuthInstance().currentUser?.uid !== scope.viewerUid ||
    ![scope.viewerUid, scope.schoolId, scope.conversationId].every((id) => segment.test(id)) ||
    (scope.peerUid !== undefined && (
      !segment.test(scope.peerUid) || scope.peerUid === scope.viewerUid ||
      scope.conversationId !== deriveDmConversationId(scope.schoolId, scope.viewerUid, scope.peerUid)
    )) ||
    !/^[A-Za-z0-9_-]{20,64}$/.test(scope.messageId)
  )
    throw new Error('photo-session');
}

function grantUrl(grant: Grant) {
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

export async function uploadDmPhoto(scope: PhotoScope, photo: LocalPhoto, signal: AbortSignal) {
  checkSession(scope, signal);
  if (localPhoto(photo.uri, photo.contentType).size !== photo.size)
    throw new Error('photo-changed');
  const fileName = filenames.get(photo.contentType)!;
  const delivery = httpsCallable<Record<string, unknown>, UploadGrant>(
    getFunctionsInstance(),
    'dmAttachmentDelivery',
  );
  const { data } = await delivery({
    ...scope,
    action: 'uploadPhoto',
    fileName,
    contentType: photo.contentType,
    size: photo.size,
  });
  checkSession(scope, signal);
  grantUrl(data);
  const parts = photoParts(data.path, scope.conversationId, false);
  if (
    data.method !== 'POST' ||
    parts?.fileName !== fileName ||
    parts.mediaId !== data.mediaId ||
    data.fields?.key !== data.path ||
    Object.values(data.fields).some((value) => typeof value !== 'string')
  )
    throw new Error('photo-policy');
  const body = new FormData();
  for (const [key, value] of Object.entries(data.fields)) body.append(key, value);
  // React Native streams the native file descriptor. Keep the file last for signed GCS POST.
  body.append('file', {
    uri: photo.uri,
    type: photo.contentType,
    name: fileName,
  } as unknown as Blob);
  const result = await fetch(data.url, {
    method: 'POST',
    body,
    signal,
    credentials: 'omit',
    redirect: 'error',
  });
  checkSession(scope, signal);
  if (!result.ok) throw new Error('photo-upload');
  return data.path;
}

export async function confirmDmPhoto(scope: PhotoScope, path: string, signal: AbortSignal) {
  checkSession(scope, signal);
  if (!photoParts(path, scope.conversationId, false)) throw new Error('photo-path');
  const send = httpsCallable<
    PhotoScope & { path: string },
    { conversationId: string; messageId: string }
  >(getFunctionsInstance(), 'sendDmPhoto');
  const { data } = await send({ ...scope, path });
  checkSession(scope, signal);
  if (data?.conversationId !== scope.conversationId || data.messageId !== scope.messageId)
    throw new Error('photo-unconfirmed');
}

// Fetch only on tap. Render in-memory bytes so the native image loader never caches a bearer URL.
export async function openDmPhoto(scope: PhotoScope, path: string, signal: AbortSignal) {
  checkSession(scope, signal);
  const parts = photoParts(path, scope.conversationId);
  if (!parts) throw new Error('photo-path');
  const delivery = httpsCallable<Record<string, unknown>, Grant>(
    getFunctionsInstance(),
    'dmAttachmentDelivery',
  );
  const { data } = await delivery({ ...scope, action: 'read', folder: 'photos', ...parts });
  checkSession(scope, signal);
  const url = grantUrl(data);
  const object =
    url.hostname === 'storage.googleapis.com'
      ? url.pathname.split('/').slice(2).join('/')
      : url.pathname.slice(1);
  if (object !== path || !url.searchParams.get('X-Goog-Signature') || url.searchParams.has('token'))
    throw new Error('photo-read');
  const result = await fetch(data.url, {
    signal,
    credentials: 'omit',
    redirect: 'error',
    // Native fetch's cache option appends a query parameter, invalidating the GCS signature.
    headers: { 'Cache-Control': 'no-store' },
  });
  if (!result.ok) throw new Error('photo-download');
  const blob = await result.blob();
  if (
    !filenames.has(blob.type) ||
    filenames.get(blob.type)?.replace('photo.', 'sent.') !== parts.fileName ||
    blob.size <= 0 ||
    blob.size >= limit
  )
    throw new Error('photo-bytes');
  const uri = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('photo-decode'));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(blob);
  });
  checkSession(scope, signal);
  grantUrl(data);
  return { uri, expiresAt: Date.parse(data.expiresAt) };
}

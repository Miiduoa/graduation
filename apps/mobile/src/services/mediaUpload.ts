/* eslint-disable @typescript-eslint/no-explicit-any */
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { getStorageInstance } from '../firebase';
import { campusPostStoragePath, conversationMediaPath, storyStoragePath } from './campusSocialPaths';

export async function uploadRawToPath(path: string, data: Blob, contentType: string) {
  const r = ref(getStorageInstance(), path);
  await uploadBytes(r, data, { contentType });
  return getDownloadURL(r);
}

export async function uploadLocalUri(path: string, localUri: string, contentType: string) {
  const res = await fetch(localUri);
  const blob = await res.blob();
  return uploadRawToPath(path, blob, contentType);
}

export async function uploadCampusPostMedia(schoolId: string, postId: string, localUri: string, fileName: string) {
  const ext = fileName.split('.').pop() ?? 'jpg';
  const ct =
    ext.match(/png/i) ? 'image/png' : ext.match(/webp/i) ? 'image/webp' : ext.match(/mp4|mov/i) ? 'video/mp4' : 'image/jpeg';
  const path = campusPostStoragePath(schoolId, postId, `${Date.now()}_${fileName}`);
  return uploadLocalUri(path, localUri, ct);
}

export async function uploadStoryMedia(schoolId: string, storyId: string, localUri: string, fileName: string) {
  const ext = fileName.split('.').pop() ?? 'jpg';
  const ct = ext.match(/mp4|mov/i) ? 'video/mp4' : 'image/jpeg';
  const path = storyStoragePath(schoolId, storyId, `${Date.now()}_${fileName}`);
  return uploadLocalUri(path, localUri, ct);
}

export async function uploadConversationAttachment(
  conversationId: string,
  uploadId: string,
  localUri: string,
  fileName: string,
  contentTypeHint?: string,
) {
  const lower = fileName.toLowerCase();
  const ct =
    contentTypeHint ||
    (/\.(mp4|mov)$/.test(lower) ? 'video/mp4' : /\.png$/.test(lower) ? 'image/png' : 'image/jpeg');
  const safe = fileName.replace(/[^\w.-]+/g, '_');
  const path = conversationMediaPath(conversationId, uploadId, safe);
  return uploadLocalUri(path, localUri, ct);
}

import { STORY_VIDEO_CONTENT_TYPE, STORY_VIDEO_MAX_BYTES, STORY_VIDEO_MAX_SECONDS } from '@campus/shared/src/storyVideo';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { getStorageInstance } from '../firebase';
import { campusPostStoragePath, conversationMediaPath, storyStoragePath } from './campusSocialPaths';

export async function uploadRawToPath(path: string, data: Blob, contentType: string, customMetadata?: Record<string, string>) {
  const r = ref(getStorageInstance(), path);
  await uploadBytes(r, data, { contentType, customMetadata });
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

export const STORY_IMAGE_LIMIT = 10 * 1024 * 1024;

export const STORY_VIDEO_MAX_MS = STORY_VIDEO_MAX_SECONDS * 1000;

export async function uploadStoryVideo(
  schoolId: string,
  storyId: string,
  ownerUid: string,
  localUri: string,
  durationMs: number,
) {
  if (!Number.isFinite(durationMs) || durationMs <= 0 || durationMs > STORY_VIDEO_MAX_MS)
    throw new Error('請選擇 30 秒以內的影片。');
  const blob = await (await fetch(localUri)).blob();
  if (blob.type && blob.type !== 'application/octet-stream' && blob.type !== STORY_VIDEO_CONTENT_TYPE)
    throw new Error('請選擇 MP4 影片。');
  if (!blob.size || blob.size >= STORY_VIDEO_MAX_BYTES) throw new Error('請選擇小於 100 MB 的影片。');
  return uploadRawToPath(storyStoragePath(schoolId, storyId, 'video'), blob, STORY_VIDEO_CONTENT_TYPE, { ownerUid });
}

export async function uploadStoryImage(
  schoolId: string,
  storyId: string,
  ownerUid: string,
  localUri: string,
  pickerMime: string,
) {
  const blob = await (await fetch(localUri)).blob();
  const mime = blob.type && blob.type !== 'application/octet-stream' ? blob.type : pickerMime;
  if (!mime?.startsWith('image/') || !blob.size) throw new Error('請選擇一張可讀取的照片。');
  if (blob.size >= STORY_IMAGE_LIMIT) throw new Error('照片須小於 10 MB。');
  return uploadRawToPath(storyStoragePath(schoolId, storyId, 'image'), blob, mime, { ownerUid });
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

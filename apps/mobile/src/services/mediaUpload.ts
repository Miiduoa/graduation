import { STORY_VIDEO_CONTENT_TYPE, STORY_VIDEO_MAX_BYTES, STORY_VIDEO_MAX_SECONDS } from '@campus/shared/src/storyVideo';
import { ref, uploadBytes, uploadBytesResumable, getDownloadURL, type StorageReference } from 'firebase/storage';
import { getStorageInstance } from '../firebase';
import { campusPostStoragePath, storyStoragePath } from './campusSocialPaths';
import { uploadDmAttachment } from './dmAttachments';
import type { UploadProgress } from './storage';

export type MediaUploadOptions = {
  signal?: AbortSignal;
  onProgress?: (progress: UploadProgress) => void;
  onUploadComplete?: () => void;
  uploaded?: boolean;
};

function cancelledUpload() {
  return Object.assign(new Error('上傳已取消。'), { code: 'storage/canceled' });
}

function checkUploadSignal(signal?: AbortSignal) {
  if (signal?.aborted) throw cancelledUpload();
}

async function readUploadedUrl(storageRef: StorageReference, signal?: AbortSignal) {
  checkUploadSignal(signal);
  const url = await getDownloadURL(storageRef);
  checkUploadSignal(signal);
  return url;
}

export async function uploadRawToPath(path: string, data: Blob, contentType: string, customMetadata?: Record<string, string>, options?: MediaUploadOptions) {
  checkUploadSignal(options?.signal);
  const r = ref(getStorageInstance(), path);
  if (!options) {
    await uploadBytes(r, data, { contentType, customMetadata });
  } else if (!options.uploaded) {
    const task = uploadBytesResumable(r, data, { contentType, customMetadata });
    await new Promise<void>((resolve, reject) => {
      let finished = false;
      let unsubscribe = () => {};
      const cleanUp = () => {
        unsubscribe();
        options.signal?.removeEventListener('abort', cancel);
      };
      const cancel = () => {
        if (finished) return;
        finished = true;
        cleanUp();
        task.cancel();
        reject(cancelledUpload());
      };
      options.signal?.addEventListener('abort', cancel, { once: true });
      unsubscribe = task.on('state_changed', (snapshot) => {
        if (finished || options.signal?.aborted) return;
        options.onProgress?.({
          loaded: snapshot.bytesTransferred,
          total: snapshot.totalBytes,
          percentage: snapshot.totalBytes > 0
            ? Math.round(snapshot.bytesTransferred / snapshot.totalBytes * 100) : 0,
        });
      }, (error) => {
        if (finished) return;
        finished = true;
        cleanUp();
        reject(error);
      }, () => {
        if (finished || options.signal?.aborted) return;
        finished = true;
        cleanUp();
        options.onUploadComplete?.();
        resolve();
      });
      if (finished) unsubscribe();
      if (options.signal?.aborted) cancel();
    });
  }
  return readUploadedUrl(r, options?.signal);
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
  options?: MediaUploadOptions,
) {
  checkUploadSignal(options?.signal);
  if (!Number.isFinite(durationMs) || durationMs <= 0 || durationMs > STORY_VIDEO_MAX_MS)
    throw new Error('請選擇 30 秒以內的影片。');
  const path = storyStoragePath(schoolId, storyId, 'video');
  if (options?.uploaded) return readUploadedUrl(ref(getStorageInstance(), path), options.signal);
  const blob = await (await fetch(localUri, options?.signal ? { signal: options.signal } : undefined)).blob();
  checkUploadSignal(options?.signal);
  if (blob.type && blob.type !== 'application/octet-stream' && blob.type !== STORY_VIDEO_CONTENT_TYPE)
    throw new Error('請選擇 MP4 影片。');
  if (!blob.size || blob.size >= STORY_VIDEO_MAX_BYTES) throw new Error('請選擇小於 100 MB 的影片。');
  return uploadRawToPath(path, blob, STORY_VIDEO_CONTENT_TYPE, { ownerUid }, options);
}

export async function uploadStoryImage(
  schoolId: string,
  storyId: string,
  ownerUid: string,
  localUri: string,
  pickerMime: string,
  options?: MediaUploadOptions,
) {
  checkUploadSignal(options?.signal);
  const path = storyStoragePath(schoolId, storyId, 'image');
  if (options?.uploaded) return readUploadedUrl(ref(getStorageInstance(), path), options.signal);
  const blob = await (await fetch(localUri, options?.signal ? { signal: options.signal } : undefined)).blob();
  checkUploadSignal(options?.signal);
  const mime = blob.type && blob.type !== 'application/octet-stream' ? blob.type : pickerMime;
  if (!mime?.startsWith('image/') || !blob.size) throw new Error('請選擇一張可讀取的照片。');
  if (blob.size >= STORY_IMAGE_LIMIT) throw new Error('照片須小於 10 MB。');
  return uploadRawToPath(path, blob, mime, { ownerUid }, options);
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
  // uploadId used to be a client-selected Storage path. New objects receive a
  // server-generated ID so retries cannot replace previously delivered media.
  // Persist only receipt.path. receipt.previewUrl expires after one minute.
  void uploadId;
  return uploadDmAttachment(conversationId, localUri, fileName, ct);
}

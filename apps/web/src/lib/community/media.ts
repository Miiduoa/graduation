/**
 * 校園社群 — 圖片上傳 (Web)
 *
 * 與 mobile/services/campusMedia.ts 對齊：
 *  - 限動存於 schools/{schoolId}/stories/{storyId}/{image|video}。
 *  - 走 Firebase Storage 直寫
 *  - 接受 File 物件（瀏覽器 <input type="file"> 拿到的）；mobile 是 URI string
 */
import { STORY_VIDEO_CONTENT_TYPE, STORY_VIDEO_MAX_BYTES } from '@campus/shared/src/storyVideo';
import { getApps } from 'firebase/app';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';

export type CampusMediaScope = 'posts' | 'replies';

export type UploadedCampusMedia = {
  url: string;
  path: string;
  contentType: string;
};

function getStorageClient() {
  if (getApps().length === 0) {
    throw new Error('Firebase 未初始化（請先確保 lib/firebase.ts 載入過）');
  }
  return getStorage(getApps()[0]!);
}

function extOfFile(file: File): string {
  const fromName = file.name?.split('.').pop()?.toLowerCase();
  if (fromName && fromName.length <= 5) return fromName === 'jpeg' ? 'jpg' : fromName;
  const fromMime = file.type?.split('/').pop();
  if (fromMime) return fromMime === 'jpeg' ? 'jpg' : fromMime;
  return 'bin';
}

export async function uploadCampusMedia(input: {
  scope: CampusMediaScope;
  schoolId: string;
  uid: string;
  file: File;
}): Promise<UploadedCampusMedia> {
  if (!input.schoolId || !input.uid || !input.file) {
    throw new Error('上傳參數不齊全');
  }
  const ext = extOfFile(input.file);
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  const path = `campus/${input.scope}/${input.schoolId}/${input.uid}/${ts}_${rand}.${ext}`;
  return uploadMediaFile(path, input.file);
}

async function uploadMediaFile(
  path: string,
  file: File,
  customMetadata?: Record<string, string>,
): Promise<UploadedCampusMedia> {
  const storageRef = ref(getStorageClient(), path);
  const contentType = file.type || 'image/jpeg';
  await uploadBytes(storageRef, file, { contentType, ...(customMetadata && { customMetadata }) });
  const url = await getDownloadURL(storageRef);
  return { url, path, contentType };
}

export function storyMediaError(file: File): string | null {
  if (file.type === STORY_VIDEO_CONTENT_TYPE) {
    if (!file.size) return '影片沒有內容，請重新選取。';
    if (file.size >= STORY_VIDEO_MAX_BYTES) return '影片須小於 100 MB，請換一段較短的影片。';
    return null;
  }
  if (!file.type.startsWith('image/')) return '請選擇照片或 MP4 影片。';
  if (!file.size) return '請選擇一張可讀取的圖片。';
  if (file.size >= 10 * 1024 * 1024) return '照片須小於 10 MB，請換一張較小的照片。';
  return null;
}

export async function uploadStoryMedia(input: {
  schoolId: string;
  storyId: string;
  uid: string;
  file: File;
}): Promise<UploadedCampusMedia> {
  const error = storyMediaError(input.file);
  if (error) throw new Error(error);
  const kind = input.file.type === STORY_VIDEO_CONTENT_TYPE ? 'video' : 'image';
  return uploadMediaFile(`schools/${input.schoolId}/stories/${input.storyId}/${kind}`, input.file, {
    ownerUid: input.uid,
  });
}

export async function uploadCampusMediaBatch(input: {
  scope: CampusMediaScope;
  schoolId: string;
  uid: string;
  files: File[];
}): Promise<UploadedCampusMedia[]> {
  const tasks = input.files.map((file) =>
    uploadCampusMedia({ scope: input.scope, schoolId: input.schoolId, uid: input.uid, file }),
  );
  return Promise.all(tasks);
}

/**
 * 校園社群 — 圖片上傳 (Web)
 *
 * 與 mobile/services/campusMedia.ts 對齊：
 *  - 路徑：campus/{scope}/{schoolId}/{uid}/{ts}_{rand}.{ext}
 *  - 走 Firebase Storage 直寫
 *  - 接受 File 物件（瀏覽器 <input type="file"> 拿到的）；mobile 是 URI string
 */
import { getApps, initializeApp } from 'firebase/app';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';

export type CampusMediaScope = 'posts' | 'stories' | 'replies';

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
  const storage = getStorageClient();
  const storageRef = ref(storage, path);
  await uploadBytes(storageRef, input.file, { contentType: input.file.type || 'image/jpeg' });
  const url = await getDownloadURL(storageRef);
  return { url, path, contentType: input.file.type || 'image/jpeg' };
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

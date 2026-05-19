/**
 * 校園社群媒體上傳：將相片直接寫進 Firebase Storage，回傳 https URL。
 *
 * - 路徑分流：
 *     campus/posts/{schoolId}/{uid}/{ts}.jpg
 *     campus/stories/{schoolId}/{uid}/{ts}.jpg
 *     campus/replies/{schoolId}/{uid}/{ts}.jpg
 * - 與 firebase.ts 內既有的 `uploadAvatar` 共用相同 Storage instance，避免重複連線。
 * - 只走真實 Firebase；Mock Mode 下會丟 Error，由呼叫端決定怎麼處理（多半是禁用按鈕）。
 */
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { getStorageInstance, isFirebaseMockMode } from '../firebase';

export type CampusMediaScope = 'posts' | 'stories' | 'replies';

export type UploadedCampusMedia = {
  url: string;
  path: string;
  width?: number;
  height?: number;
  contentType: string;
};

function inferContentType(uri: string, hintedMime?: string | null): string {
  if (hintedMime && hintedMime.startsWith('image/')) return hintedMime;
  if (hintedMime && hintedMime.startsWith('video/')) return hintedMime;
  const ext = uri.split('.').pop()?.toLowerCase() ?? '';
  switch (ext) {
    case 'png':
      return 'image/png';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'heic':
      return 'image/heic';
    case 'mp4':
      return 'video/mp4';
    case 'mov':
      return 'video/quicktime';
    case 'jpg':
    case 'jpeg':
    default:
      return 'image/jpeg';
  }
}

function extFromMime(mime: string): string {
  if (mime.startsWith('image/')) return mime.split('/')[1] === 'jpeg' ? 'jpg' : mime.split('/')[1];
  if (mime.startsWith('video/')) return mime.split('/')[1] === 'quicktime' ? 'mov' : mime.split('/')[1];
  return 'bin';
}

export async function uploadCampusMedia(input: {
  scope: CampusMediaScope;
  schoolId: string;
  uid: string;
  uri: string;
  mime?: string | null;
  width?: number;
  height?: number;
}): Promise<UploadedCampusMedia> {
  if (isFirebaseMockMode()) {
    throw new Error('模擬模式無法上傳媒體（Firebase 未設定）');
  }
  if (!input.schoolId || !input.uid || !input.uri) {
    throw new Error('上傳參數不齊全');
  }
  const contentType = inferContentType(input.uri, input.mime ?? null);
  const ext = extFromMime(contentType);
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  const path = `campus/${input.scope}/${input.schoolId}/${input.uid}/${ts}_${rand}.${ext}`;

  const storage = getStorageInstance();
  const storageRef = ref(storage, path);

  const blob = await fetch(input.uri).then((r) => r.blob());
  await uploadBytes(storageRef, blob, { contentType });
  const url = await getDownloadURL(storageRef);

  return {
    url,
    path,
    width: input.width,
    height: input.height,
    contentType,
  };
}

/** 連續上傳多張並 Promise.all（呼叫端應自行控制上限數量，建議 <= 4） */
export async function uploadCampusMediaBatch(input: {
  scope: CampusMediaScope;
  schoolId: string;
  uid: string;
  items: { uri: string; mime?: string | null; width?: number; height?: number }[];
}): Promise<UploadedCampusMedia[]> {
  const tasks = input.items.map((item) =>
    uploadCampusMedia({
      scope: input.scope,
      schoolId: input.schoolId,
      uid: input.uid,
      uri: item.uri,
      mime: item.mime ?? null,
      width: item.width,
      height: item.height,
    }),
  );
  return Promise.all(tasks);
}

import { getAuthInstance } from '../firebase';
import { getCloudFunctionUrl } from './cloudFunctions';
import type { PUGradeResult } from './puDirectScraper';

/** App 重啟後由伺服器尋找本人仍有效的校務連線，不依賴記憶體中的 session ID。 */
export async function loadOwnedSchoolGrades(uid: string): Promise<PUGradeResult> {
  const requester = getAuthInstance().currentUser;
  if (!requester || requester.uid !== uid || typeof requester.getIdToken !== 'function') {
    throw new Error('請重新連線學校帳號後再讀取成績。');
  }
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout>;
  const expired = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new Error('讀取校務成績逾時，請稍後再試。'));
    }, 45_000);
  });
  const assertCurrent = () => {
    if (controller.signal.aborted) throw new Error('讀取校務成績逾時，請稍後再試。');
    if (getAuthInstance().currentUser !== requester)
      throw new Error('帳號已變更，請重新讀取成績。');
  };
  const read = async (): Promise<PUGradeResult> => {
    const token = await requester.getIdToken();
    assertCurrent();
    const primaryUrl = getCloudFunctionUrl('getMyAcademicRecords');
    const options: RequestInit = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ data: { dataType: 'grades' } }),
      signal: controller.signal,
    };
    let response = await fetch(primaryUrl, options);
    const canonicalUrl = 'https://nuni.tw/api/fn/getMyAcademicRecords';
    // 舊雲端未部署此函式時才改走同一產品的校務閘道；拒絕登入不重試其他端點。
    if (
      response.status === 404 &&
      primaryUrl.startsWith('https://') &&
      primaryUrl !== canonicalUrl
    ) {
      assertCurrent();
      response = await fetch(canonicalUrl, options);
    }
    const envelope = await response.json();
    assertCurrent();
    const snapshot = envelope?.result;
    if (
      !response.ok ||
      snapshot?.success !== true ||
      snapshot.ownerUid !== uid ||
      snapshot.schoolId !== 'pu' ||
      snapshot.source !== 'pu-campus' ||
      snapshot.dataType !== 'grades' ||
      snapshot.result?.success !== true ||
      !Array.isArray(snapshot.result.grades)
    ) {
      throw new Error('校務連線無法讀取成績，請重新連線學校帳號。');
    }
    return {
      grades: snapshot.result.grades,
      allSemesters: Array.isArray(snapshot.result.allSemesters) ? snapshot.result.allSemesters : [],
      summary: snapshot.result.summary ?? {},
    };
  };
  try {
    return await Promise.race([read(), expired]);
  } finally {
    clearTimeout(timeout!);
  }
}

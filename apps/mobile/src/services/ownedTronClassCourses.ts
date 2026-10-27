import { getAuthInstance } from '../firebase';
import { canUseHostedSchoolFallback, getCloudFunctionUrl } from './cloudFunctions';
import { isTronClassDataFetchEnabled } from './tronClassDataEnabled';
import type { TCCourse } from './tronClassClient';

export type NativeTronClassCourseStatus = 'ongoing' | 'ended' | 'upcoming';
const HOSTED_COURSES_URL = 'https://nuni.tw/api/fn/getMyTronClassCourses';

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function invalidCourses(): never {
  throw new Error('課程平台回傳的資料不完整，請稍後重試。');
}

function nativeStatus(status: string): string {
  return status === 'completed' ? 'ended' : status;
}

function checkedCourseRows(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.length > 1000) invalidCourses();
  const seen = new Set<number>();
  return value.map((item) => {
    const row = record(item);
    if (
      !row ||
      typeof row.id !== 'number' ||
      !Number.isSafeInteger(row.id) ||
      row.id <= 0 ||
      seen.has(row.id) ||
      typeof row.name !== 'string' ||
      !row.name.trim() ||
      row.name.length > 300
    ) {
      invalidCourses();
    }
    seen.add(row.id);
    return row;
  });
}

function mapHostedCourses(value: unknown): TCCourse[] {
  return checkedCourseRows(value).map((row) => {
    if (
      typeof row.code !== 'string' ||
      typeof row.status !== 'string' ||
      !(row.semester === null || typeof row.semester === 'string') ||
      !Array.isArray(row.teachers) ||
      row.teachers.some((name) => typeof name !== 'string')
    ) {
      invalidCourses();
    }
    // 公開課程清單沒有提供學分、教師 ID 或修課人數；保留未知值。
    return {
      id: row.id as number,
      name: row.name as string,
      course_code: row.code,
      department: null,
      instructors: (row.teachers as string[]).map((name) => ({ name })),
      credit: null,
      semester: typeof row.semester === 'string' ? { name: row.semester } : null,
      klass: null,
      grade: null,
      course_outline: null,
      start_date: null,
      end_date: null,
      status: nativeStatus(row.status),
      role: '',
      classroom_schedule: null,
    };
  });
}

/** 只讀課程清單；既有代理未部署時，以登入者身分讀取網站端綁定的 LMS session。 */
export async function loadTronClassBackendCourses(
  sessionId: string,
  status: NativeTronClassCourseStatus = 'ongoing',
): Promise<TCCourse[]> {
  if (!isTronClassDataFetchEnabled()) return [];
  if (!['ongoing', 'ended', 'upcoming'].includes(status) || !sessionId.trim()) invalidCourses();
  const requester = getAuthInstance().currentUser;
  if (!requester || typeof requester.getIdToken !== 'function') {
    throw new Error('請重新連線學校帳號後再讀取課程。');
  }
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error('課程讀取逾時，請稍後再試。'));
    }, 45_000);
  });
  const assertCurrent = () => {
    if (controller.signal.aborted) throw new Error('課程讀取逾時，請稍後再試。');
    if (getAuthInstance().currentUser !== requester)
      throw new Error('帳號已變更，請重新讀取課程。');
    if (!isTronClassDataFetchEnabled()) throw new Error('目前尚未開啟課程平台連線。');
  };
  const read = async (): Promise<TCCourse[]> => {
    const token = await requester.getIdToken();
    assertCurrent();
    const canonicalStatus = status === 'ended' ? 'completed' : status;
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
    const primaryUrl = getCloudFunctionUrl('puFetchTronClassData');
    let hosted = false;
    let response = await fetch(primaryUrl, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify({ sessionId, dataType: 'courses', status }),
    });
    assertCurrent();
    if (response.status === 404 && canUseHostedSchoolFallback(primaryUrl)) {
      hosted = true;
      response = await fetch(HOSTED_COURSES_URL, {
        method: 'POST',
        headers,
        signal: controller.signal,
        body: JSON.stringify({ data: { status: canonicalStatus } }),
      });
    }
    const envelope = record(await response.json());
    assertCurrent();
    if (!response.ok || !envelope || envelope.error) {
      throw new Error(`課程平台讀取未完成（HTTP ${response.status}），請重新連線後再試。`);
    }
    if (hosted) {
      const snapshot = record(envelope.result);
      if (
        !snapshot ||
        snapshot.success !== true ||
        snapshot.ownerUid !== requester.uid ||
        snapshot.schoolId !== 'pu' ||
        snapshot.source !== 'pu-tronclass' ||
        snapshot.status !== canonicalStatus ||
        typeof snapshot.fetchedAt !== 'string' ||
        !Number.isFinite(Date.parse(snapshot.fetchedAt))
      ) {
        invalidCourses();
      }
      return mapHostedCourses(snapshot.courses);
    }
    if (envelope.success !== true) invalidCourses();
    const rows = checkedCourseRows(envelope.result);
    // 舊代理保留其原有完整課程契約；這裡不從課表補造 LMS 欄位。
    return rows.map(
      (row) => ({ ...row, status: nativeStatus(String(row.status ?? '')) }) as TCCourse,
    );
  };
  try {
    return await Promise.race([read(), expired]);
  } finally {
    clearTimeout(timer!);
  }
}

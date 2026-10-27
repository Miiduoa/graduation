import { getAuthInstance } from '../firebase';
import { canUseHostedSchoolFallback, getCloudFunctionUrl } from './cloudFunctions';
import type { PUCourseResult, PUGradeResult, PUStudentInfo } from './puDirectScraper';

type SchoolDataType = 'courses' | 'grades';

function studentInfo(value: unknown): PUStudentInfo {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const text = (item: unknown): string | null => (typeof item === 'string' ? item : null);
  return {
    studentId: text(raw.studentId),
    name: text(raw.name),
    className: text(raw.className ?? raw.class),
    currentSemester: text(raw.currentSemester),
    department: text(raw.department),
    grade: text(raw.grade),
    enrollmentStatus: text(raw.enrollmentStatus),
  };
}

function loadOwnedSchoolRecords(uid: string, dataType: 'courses'): Promise<PUCourseResult>;
function loadOwnedSchoolRecords(uid: string, dataType: 'grades'): Promise<PUGradeResult>;

/** App 重啟後由伺服器尋找本人仍有效的校務連線，不依賴記憶體中的 session ID。 */
async function loadOwnedSchoolRecords(
  uid: string,
  dataType: SchoolDataType,
): Promise<PUCourseResult | PUGradeResult> {
  const label = dataType === 'courses' ? '課表' : '成績';
  const requester = getAuthInstance().currentUser;
  if (!requester || requester.uid !== uid || typeof requester.getIdToken !== 'function') {
    throw new Error(`請重新連線學校帳號後再讀取${label}。`);
  }
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout>;
  const expired = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new Error(`讀取校務${label}逾時，請稍後再試。`));
    }, 45_000);
  });
  const assertCurrent = () => {
    if (controller.signal.aborted) throw new Error(`讀取校務${label}逾時，請稍後再試。`);
    if (getAuthInstance().currentUser !== requester)
      throw new Error(`帳號已變更，請重新讀取${label}。`);
  };
  const read = async (): Promise<PUCourseResult | PUGradeResult> => {
    const token = await requester.getIdToken();
    assertCurrent();
    const primaryUrl = getCloudFunctionUrl('getMyAcademicRecords');
    const options: RequestInit = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ data: { dataType } }),
      signal: controller.signal,
    };
    let response = await fetch(primaryUrl, options);
    const canonicalUrl = 'https://nuni.tw/api/fn/getMyAcademicRecords';
    // 舊雲端未部署此函式時才改走同一產品的校務閘道；拒絕登入不重試其他端點。
    if (
      response.status === 404 &&
      canUseHostedSchoolFallback(primaryUrl) &&
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
      snapshot.dataType !== dataType ||
      snapshot.result?.success !== true ||
      !Array.isArray(snapshot.result[dataType])
    ) {
      throw new Error(`校務連線無法讀取${label}，請重新連線學校帳號。`);
    }
    if (dataType === 'courses') {
      if (
        typeof snapshot.result.totalCredits !== 'number' ||
        !Number.isFinite(snapshot.result.totalCredits) ||
        snapshot.result.totalCredits < 0
      ) {
        throw new Error('校務課表缺少學分資訊，請稍後再試。');
      }
      return {
        courses: snapshot.result.courses,
        studentInfo: studentInfo(snapshot.result.studentInfo),
        semester: typeof snapshot.result.semester === 'string' ? snapshot.result.semester : null,
        totalCredits: snapshot.result.totalCredits,
      };
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

export function loadOwnedSchoolGrades(uid: string): Promise<PUGradeResult> {
  return loadOwnedSchoolRecords(uid, 'grades');
}

export function loadOwnedSchoolCourses(uid: string): Promise<PUCourseResult> {
  return loadOwnedSchoolRecords(uid, 'courses');
}

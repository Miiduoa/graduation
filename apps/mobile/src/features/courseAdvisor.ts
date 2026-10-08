import { httpsCallable } from 'firebase/functions';
import { doc, getDocFromServer } from 'firebase/firestore';
import { getAuthInstance, getDb, getFunctionsInstance, isFirebaseMockMode } from '../firebase';
import { getCourseSpace } from '../data/courseSpaceSource';
import {
  queryCatalog,
  type CatalogCourse,
  type CatalogQueryResult,
} from '../services/courseCatalogClient';

export const OFFICIAL_CATALOG_URL = 'https://mypu.pu.edu.tw/Framework/Academic/CourseCatalogSys/';
export type AdvisorScope = { userId: string; schoolId: string; groupId?: string };
export type AdvisorMessage = { role: 'user' | 'assistant'; content: string };
export class AdvisorError extends Error {}

export function currentAdvisorSemester(now = new Date()): string {
  const month = now.getMonth() + 1;
  const academicYear = now.getFullYear() - 1911 - (month < 8 ? 1 : 0);
  return `${academicYear}${month >= 2 && month < 8 ? 2 : 1}`;
}

function assertCurrent(scope: AdvisorScope, isCurrent: () => boolean) {
  if (
    !isCurrent() ||
    isFirebaseMockMode() ||
    !scope.userId ||
    getAuthInstance().currentUser?.uid !== scope.userId
  ) {
    throw new AdvisorError('登入狀態已變更，請重新開啟課程顧問。');
  }
}

export async function loadAdvisorCourse(scope: AdvisorScope, isCurrent: () => boolean) {
  assertCurrent(scope, isCurrent);
  if (!scope.groupId) return null;
  const course = await getCourseSpace(scope.groupId, scope.userId, scope.schoolId);
  assertCurrent(scope, isCurrent);
  if (!course || course.schoolId !== scope.schoolId) {
    throw new AdvisorError('目前無法存取這門課，請回到課程列表重新選擇。');
  }
  return { id: course.groupId, name: course.name };
}

export async function loadAdvisorCatalog(
  schoolId: string,
  semester: string,
  keyword: string,
  signal: AbortSignal,
): Promise<CatalogQueryResult> {
  if (schoolId !== 'pu') throw new AdvisorError('這所學校的課程查詢尚未開放。');
  if (!/^\d{3}[1-4]$/.test(semester)) throw new AdvisorError('請輸入學期代碼，例如 1151。');
  const result = await queryCatalog(
    { semester, keyword: keyword.trim() || undefined },
    { signal, limit: 200 },
  );
  if (signal.aborted) throw new AdvisorError('查詢已取消。');
  if (result.error || !['live', 'cache'].includes(result.source)) {
    throw new AdvisorError('目前無法取得校方課程資料，請稍後重試或開啟校方課程查詢。');
  }
  if (
    result.filter?.semester !== semester ||
    !Array.isArray(result.courses) ||
    !Number.isFinite(result.fetchedAt) ||
    result.fetchedAt <= 0 ||
    result.courses.some((course) => !course.code || !course.name || course.semester !== semester)
  ) {
    throw new AdvisorError('課程資料不完整，請稍後重試或開啟校方課程查詢。');
  }
  return {
    ...result,
    courses: result.courses.map((course) => {
      const rawCredit = course.raw?.credit;
      const credits =
        rawCredit == null || String(rawCredit).trim() === '' ? Number.NaN : Number(rawCredit);
      return {
        ...course,
        credits: Number.isFinite(credits) && credits >= 0 ? credits : Number.NaN,
      };
    }),
  };
}

export function officialSyllabusUrl(course: CatalogCourse): string | null {
  try {
    const url = new URL(course.syllabusUrl ?? '');
    return url.protocol === 'https:' &&
      url.hostname === 'mypu.pu.edu.tw' &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export async function askCourseAdvisor(input: {
  scope: AdvisorScope;
  history: AdvisorMessage[];
  question: string;
  course: CatalogCourse | null;
  catalog: CatalogQueryResult | null;
  isCurrent: () => boolean;
}): Promise<string> {
  const { scope, isCurrent } = input;
  assertCurrent(scope, isCurrent);
  const profile = await getDocFromServer(doc(getDb(), 'users', scope.userId));
  assertCurrent(scope, isCurrent);
  if (!profile.exists() || profile.data()?.schoolId !== scope.schoolId) {
    throw new AdvisorError('目前選擇的學校與登入帳號不同，請切換回帳號所屬學校。');
  }
  const focused = input.course ? null : await loadAdvisorCourse(scope, isCurrent);
  assertCurrent(scope, isCurrent);
  const rows = input.course ? [input.course] : (input.catalog?.courses.slice(0, 3) ?? []);
  const evidence = JSON.stringify({
    focusedCourse: focused?.name,
    source: input.catalog?.source,
    fetchedAt: input.catalog?.fetchedAt,
    courses: rows.map((course) => ({
      code: course.code,
      name: course.name,
      semester: course.semester,
      teacher: course.teacher,
      credits: course.credits,
      time: course.timePlaceRaw,
    })),
  }).slice(0, 600);
  const question = input.question.trim().slice(0, 800);
  if (!question) throw new AdvisorError('請先輸入想討論的問題。');
  // The callable accepts user/assistant turns and caps each at 1,600 characters.
  const content = `${question}\n\n課程顧問參考資料（僅為課程目錄，不代表已修課）：${evidence}\n請依可核實資料回答；未提供的評價、難度、成績、興趣、畢業進度不得推測。未查得時請說明。`;
  const callable = httpsCallable<
    unknown,
    {
      content?: string;
      error?: string;
      run?: { status?: string };
    }
  >(getFunctionsInstance(), 'askCampusAssistant');
  const result = await callable({
    messages: [...input.history.slice(-18), { role: 'user', content }],
    context: {
      schoolId: scope.schoolId,
      screen: 'course-advisor',
      ...(focused ? { groupId: focused.id } : {}),
      locale: 'zh-TW',
      timezone: 'Asia/Taipei',
    },
  });
  assertCurrent(scope, isCurrent);
  const response = result.data;
  if (
    response.error ||
    response.run?.status !== 'completed' ||
    typeof response.content !== 'string' ||
    !response.content.trim()
  ) {
    throw new AdvisorError('目前無法取得回覆，請稍後再試。');
  }
  return response.content.trim();
}

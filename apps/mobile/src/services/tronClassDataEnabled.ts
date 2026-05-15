/**
 * TronClass 連線總開關（建置期／口試 demo 可關閉一切 LMS 網路）。
 *
 * - `app.config.ts` 注入 `extra.tronClassDataEnabled`（來自 `EXPO_PUBLIC_TRONCLASS_DATA_ENABLED`，預設 true）
 * - `tronClassClient` / `studentIdAuth` / `puDataCache.ensureTronClassSession` 統一讀此旗標
 */
import Constants from 'expo-constants';

export const TRONCLASS_DATA_DISABLED_MESSAGE = '目前已停用 LMS（TronClass）連線';

export function isTronClassDataFetchEnabled(): boolean {
  const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, unknown>;
  if (extra.tronClassDataEnabled === false) return false;
  if (extra.tronClassDataEnabled === true) return true;
  return true;
}

const TRONCLASS_PU_HOST = 'tronclass.pu.edu.tw';

/** 判斷連結是否為靜宜 TronClass（玩課雲）站台，用於 WebView／系統瀏覽器與 API 同一套開關。 */
export function isTronClassPuHostedUrl(rawUrl: string | null | undefined): boolean {
  if (rawUrl == null || typeof rawUrl !== 'string') return false;
  return rawUrl.toLowerCase().includes(TRONCLASS_PU_HOST);
}

const TRONCLASS_BACKEND_MUTATIONS = new Set([
  'postDiscussion',
  'postDiscussionReply',
  'submitHomework',
  'submitSurvey',
  'submitPeerReview',
]);

export function isTronClassBackendMutation(dataType: string): boolean {
  return TRONCLASS_BACKEND_MUTATIONS.has(dataType);
}

/**
 * `puFetchTronClassData` read 型別在停用時回傳的安全空值（與各 screen 的 nullable／[] 慣例對齊）。
 */
export function tronClassBackendReadWhenDisabled(dataType: string): unknown {
  switch (dataType) {
    case 'profile':
    case 'courseDetail':
    case 'selfScore':
    case 'homeworkStatus':
    case 'examStatus':
    case 'activityDetail':
    case 'homeworkDetail':
    case 'examDetail':
    case 'gradeDetails':
    case 'syllabus':
      return null;
    case 'courses':
    case 'activities':
    case 'modules':
    case 'attendance':
    case 'todos':
    case 'exams':
    case 'scoreItems':
    case 'homeworkScores':
    case 'announcements':
    case 'homeworkSubmissions':
    case 'examAttempts':
    case 'discussions':
    case 'discussionPosts':
    case 'courseAnnouncements':
    case 'materials':
    case 'courseMembers':
    case 'learningActivities':
    case 'surveys':
    case 'peerReviews':
      return [];
    case 'courseFullData':
      return {
        courseDetail: null,
        activities: [],
        modules: [],
        exams: [],
        scoreItems: [],
        selfScore: null,
        homeworkStatus: null,
        homeworkScores: [],
        examStatus: null,
        courseAnnouncements: [],
        materials: [],
        discussions: [],
        gradeDetails: null,
        learningActivities: [],
      };
    default:
      return null;
  }
}

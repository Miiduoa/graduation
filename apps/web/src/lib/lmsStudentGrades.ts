import { parseTaipeiInstant } from '@campus/shared/src/taipeiTime';
import { NuniError, nuniErrorMessage, type NuniAssignment, type NuniQuiz } from '@campus/shared/src/nuni';
import { isNetworkLayerError, isDeviceOffline, loadFailureCopy } from '@campus/shared/src/loadFailureCopy';
import { feedbackPredatesSubmission, isPublishedHomeGrade } from './homeOverview';

export const LMS_GRADES_HREF = '/grades?tab=feedback';
export const LMS_GRADES_TITLE = '課業成績與回饋';
const READ_STORAGE_PREFIX = 'nuni-grade-read:';
const READ_EVENT = 'nuni-grade-read-change';
const READ_KEY_LIMIT = 400;
const READ_VALUE_LIMIT = 80;
let readEpoch = 0;

export type GradeSource = 'nuni' | 'school';
export type GradeKind = 'assignment' | 'quiz';
export type GradeStatus = 'missing' | 'waiting' | 'graded';
export type GradeFilter = 'all' | 'unread' | 'graded' | 'waiting' | 'missing';
export type CourseGradeLoadStatus = 'ready' | 'error' | 'denied' | 'offline';

export type GradeItem = {
  source: GradeSource;
  kind: GradeKind;
  id: string;
  courseId: string;
  courseName: string;
  title: string;
  status: GradeStatus;
  score: number | null;
  points: number | null;
  feedback: string | null;
  publishedAt: string | null;
  submittedAt: string | null;
  submissionPreview: string | null;
  href: string;
  closed: boolean;
  staleFeedback: boolean;
  hasNumericScore: boolean;
};

export type CourseGradeSection = {
  source: GradeSource;
  courseId: string;
  courseName: string;
  href: string;
  checkedAt?: string;
  archived: boolean;
  status: CourseGradeLoadStatus;
  error: string | null;
  assignmentError: string | null;
  quizError: string | null;
  items: GradeItem[];
};

export type StudentGradebook = {
  teachingCount: number;
  courses: CourseGradeSection[];
  listError: string | null;
};

export const GRADE_COPY = {
  loading: '正在讀取各門課的成績與回饋…',
  emptyCourses: '目前沒有修課中的課程，所以還沒有成績可看。',
  emptyItems: '這門課還沒有作業或測驗。',
  emptyFilter: '這個篩選目前沒有項目。可改看「全部」。',
  teacherOnly: '授課帳號請到各課作業查看繳交與批閱。這裡是學生看自己成績與回饋的頁面。',
  unsigned: '登入後才能查看你各門課目前的成績與老師回饋。',
  offline: '目前離線，沒有用舊資料充當最新成績。請連線後重試。',
  denied: '你目前沒有查看這門課成績的權限。',
  courseFailed: '這門課的成績還沒讀到，其他課程不受影響。',
  assignmentsFailed: '這門課的作業成績還沒讀到；已讀到的測驗仍會顯示。',
  quizzesFailed: '這門課的測驗成績還沒讀到；已讀到的作業仍會顯示。',
  unpublished: '已繳交 · 等待老師公布',
  missingOpen: '缺交 · 尚未繳交',
  missingClosed: '缺交 · 已停止收件',
  feedbackOnly: '已公布回饋 · 沒有分數欄位',
  unread: '未讀',
  note: '只顯示已公布的分數或回饋。還沒公布的分數不會出現。待評、缺交與未取得都不換算成零分，也不混入平均。正式學期成績仍以學校紀錄為準。',
} as const;

const FILTER_LABELS: Record<GradeFilter, string> = {
  all: '全部',
  unread: '未讀',
  graded: '已評分',
  waiting: '等待公布',
  missing: '缺交',
};

export function gradeFilterLabel(filter: GradeFilter): string {
  return FILTER_LABELS[filter];
}

export function gradeReadOwner(source: GradeSource, accountId: string): string {
  return `${source}:${accountId}`;
}

export function gradeSourceFromHref(href: string): GradeSource {
  return href.startsWith('/classroom/') ? 'nuni' : 'school';
}

export function gradeOwnerForSource(
  source: GradeSource,
  nuniAccountId?: string | null,
  schoolUid?: string | null,
): string {
  if (source === 'nuni' && nuniAccountId) return gradeReadOwner('nuni', nuniAccountId);
  if (source === 'school' && schoolUid) return gradeReadOwner('school', schoolUid);
  if (nuniAccountId) return gradeReadOwner('nuni', nuniAccountId);
  if (schoolUid) return gradeReadOwner('school', schoolUid);
  return '';
}

export function gradeItemKey(item: Pick<GradeItem, 'source' | 'courseId' | 'kind' | 'id'>): string {
  return `${item.source}:${item.courseId}:${item.kind}:${item.id}`;
}

function storageKey(ownerId: string): string {
  return `${READ_STORAGE_PREFIX}${ownerId}`;
}

function readMap(ownerId: string): Record<string, string> {
  if (typeof window === 'undefined' || !ownerId) return {};
  try {
    const raw = window.localStorage.getItem(storageKey(ownerId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (
        key.length > 0 &&
        key.length <= READ_KEY_LIMIT &&
        typeof value === 'string' &&
        value.length <= READ_VALUE_LIMIT
      ) {
        result[key] = value;
      }
    }
    return result;
  } catch {
    return {};
  }
}

function emitGradeReadChange() {
  readEpoch += 1;
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(READ_EVENT));
}

export function getGradeReadEpoch(): number {
  return readEpoch;
}

export function subscribeGradeRead(onStoreChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = () => onStoreChange();
  window.addEventListener('storage', handler);
  window.addEventListener(READ_EVENT, handler);
  return () => {
    window.removeEventListener('storage', handler);
    window.removeEventListener(READ_EVENT, handler);
  };
}

export function isPublishedGradeUnread(
  ownerId: string,
  item: Pick<GradeItem, 'source' | 'courseId' | 'kind' | 'id' | 'status' | 'publishedAt'>,
): boolean {
  if (!ownerId || item.status !== 'graded') return false;
  const seen = readMap(ownerId)[gradeItemKey(item)];
  if (!seen) return true;
  if (!item.publishedAt) return false;
  const published = parseTaipeiInstant(item.publishedAt);
  const readAt = parseTaipeiInstant(seen);
  return published !== null && readAt !== null && published > readAt;
}

export function markPublishedGradeRead(
  ownerId: string,
  item: Pick<GradeItem, 'source' | 'courseId' | 'kind' | 'id' | 'status' | 'publishedAt'>,
): void {
  if (typeof window === 'undefined' || !ownerId || item.status !== 'graded') return;
  const key = gradeItemKey(item);
  const next = { ...readMap(ownerId), [key]: item.publishedAt || 'read' };
  try {
    window.localStorage.setItem(storageKey(ownerId), JSON.stringify(next));
    emitGradeReadChange();
  } catch {
    /* Private mode or quota: keep the unread mark rather than crashing the page. */
  }
}

export function markPublishedGradeReadByLanding(
  ownerId: string,
  item: {
    source: GradeSource;
    courseId: string;
    kind: GradeKind;
    id: string;
    publishedAt: string | null | undefined;
  },
): void {
  if (!item.publishedAt) return;
  markPublishedGradeRead(ownerId, {
    ...item,
    status: 'graded',
    publishedAt: item.publishedAt,
  });
}

function preview(text: string | null | undefined, limit = 80): string | null {
  const value = typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '';
  if (!value) return null;
  return value.length > limit ? `${value.slice(0, limit)}…` : value;
}

export function gradeStatusLabel(item: GradeItem): string {
  if (item.status === 'graded') {
    if (item.hasNumericScore && item.score !== null) {
      return item.points !== null
        ? `已評分 · ${item.score} / ${item.points} 分`
        : `已評分 · ${item.score} 分`;
    }
    return GRADE_COPY.feedbackOnly;
  }
  if (item.status === 'waiting') return GRADE_COPY.unpublished;
  return item.closed ? GRADE_COPY.missingClosed : GRADE_COPY.missingOpen;
}

export function matchesGradeFilter(
  item: GradeItem,
  filter: GradeFilter,
  ownerId: string,
): boolean {
  switch (filter) {
    case 'graded':
      return item.status === 'graded';
    case 'waiting':
      return item.status === 'waiting';
    case 'missing':
      return item.status === 'missing';
    case 'unread':
      return isPublishedGradeUnread(ownerId, item);
    default:
      return true;
  }
}

export function summarizeGradeItems(
  items: GradeItem[],
  ownerId: string,
): { graded: number; waiting: number; missing: number; unread: number } {
  return items.reduce(
    (sum, item) => {
      if (item.status === 'graded') sum.graded += 1;
      if (item.status === 'waiting') sum.waiting += 1;
      if (item.status === 'missing') sum.missing += 1;
      if (isPublishedGradeUnread(ownerId, item)) sum.unread += 1;
      return sum;
    },
    { graded: 0, waiting: 0, missing: 0, unread: 0 },
  );
}

export function nuniWorkHref(courseId: string, kind: GradeKind, id: string): string {
  return `/classroom/course/${encodeURIComponent(courseId)}#${kind}-${encodeURIComponent(id)}`;
}

export function schoolWorkHref(courseId: string, kind: GradeKind, id: string): string {
  return `/course/${encodeURIComponent(courseId)}#${kind}-${encodeURIComponent(id)}`;
}

export function gradeFromNuniAssignment(
  course: { id: string; title: string; state: 'active' | 'archived' },
  assignment: NuniAssignment,
): GradeItem {
  const submitted = assignment.mySubmission;
  const feedback = submitted?.teacherFeedback?.trim() || null;
  const graded = !!feedback;
  return {
    source: 'nuni',
    kind: 'assignment',
    id: assignment.id,
    courseId: course.id,
    courseName: course.title,
    title: assignment.title,
    status: graded ? 'graded' : submitted ? 'waiting' : 'missing',
    score: null,
    points: null,
    feedback,
    publishedAt: graded ? submitted?.reviewedAt ?? null : null,
    submittedAt: submitted?.submittedAt ?? null,
    submissionPreview: preview(submitted?.body),
    href: nuniWorkHref(course.id, 'assignment', assignment.id),
    closed: course.state !== 'active' || assignment.state === 'closed',
    staleFeedback: feedbackPredatesSubmission(submitted?.reviewedAt, submitted?.submittedAt),
    hasNumericScore: false,
  };
}

export function gradeFromNuniQuiz(
  course: { id: string; title: string; state: 'active' | 'archived' },
  quiz: NuniQuiz,
): GradeItem {
  const submitted = quiz.myResponse;
  const feedback = submitted?.teacherFeedback?.trim() || null;
  const graded = !!feedback;
  return {
    source: 'nuni',
    kind: 'quiz',
    id: quiz.id,
    courseId: course.id,
    courseName: course.title,
    title: quiz.title,
    status: graded ? 'graded' : submitted ? 'waiting' : 'missing',
    score: null,
    points: null,
    feedback,
    publishedAt: graded ? submitted?.reviewedAt ?? null : null,
    submittedAt: submitted?.submittedAt ?? null,
    submissionPreview: preview(submitted?.answer),
    href: nuniWorkHref(course.id, 'quiz', quiz.id),
    closed: course.state !== 'active' || quiz.state === 'closed',
    staleFeedback: feedbackPredatesSubmission(submitted?.reviewedAt, submitted?.submittedAt),
    hasNumericScore: false,
  };
}

export function gradeFromSchoolAssignment(input: {
  courseId: string;
  courseName: string;
  assignmentId: string;
  title: string;
  type?: string;
  closed: boolean;
  points: number | null;
  submittedAt: string | null;
  submittedText: string | null;
  gradePublished?: unknown;
  gradeScore?: unknown;
  gradeFeedback?: unknown;
  gradePublishedAt?: string | null;
}): GradeItem {
  const quizLike = ['quiz', 'exam'].includes(String(input.type ?? ''));
  const kind: GradeKind = quizLike ? 'quiz' : 'assignment';
  const published = isPublishedHomeGrade({
    gradePublished: input.gradePublished,
    gradeScore: input.gradeScore,
    gradeFeedback: input.gradeFeedback,
  });
  const submitted = !!input.submittedAt;
  const score =
    published && typeof input.gradeScore === 'number' && Number.isFinite(input.gradeScore)
      ? input.gradeScore
      : null;
  const feedback =
    published && typeof input.gradeFeedback === 'string' && input.gradeFeedback.trim()
      ? input.gradeFeedback
      : null;
  return {
    source: 'school',
    kind,
    id: input.assignmentId,
    courseId: input.courseId,
    courseName: input.courseName,
    title: input.title,
    status: published ? 'graded' : submitted ? 'waiting' : 'missing',
    score,
    points: published ? input.points : null,
    feedback,
    publishedAt: published ? input.gradePublishedAt ?? null : null,
    submittedAt: input.submittedAt,
    submissionPreview: preview(input.submittedText),
    href: schoolWorkHref(input.courseId, kind, input.assignmentId),
    closed: input.closed,
    staleFeedback: false,
    hasNumericScore: score !== null,
  };
}

export function sortGradeItems(items: GradeItem[]): GradeItem[] {
  return [...items].sort((a, b) => {
    const rank = { missing: 0, waiting: 1, graded: 2 } as const;
    const byStatus = rank[a.status] - rank[b.status];
    if (byStatus) return byStatus;
    const aTime = a.publishedAt || a.submittedAt;
    const bTime = b.publishedAt || b.submittedAt;
    return (
      (bTime ? parseTaipeiInstant(bTime) ?? 0 : 0) - (aTime ? parseTaipeiInstant(aTime) ?? 0 : 0) ||
      a.title.localeCompare(b.title, 'zh-Hant')
    );
  });
}

export function courseGradeFailure(
  error: unknown,
  options: { online?: boolean | null } = {},
): { status: CourseGradeLoadStatus; message: string } {
  if (isDeviceOffline(options.online) || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
    return { status: 'offline', message: GRADE_COPY.offline };
  }
  if (error instanceof NuniError && [401, 403, 404].includes(error.status)) {
    return { status: 'denied', message: GRADE_COPY.denied };
  }
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: unknown }).code)
      : '';
  if (code === 'permission-denied' || code === 'unauthenticated') {
    return { status: 'denied', message: GRADE_COPY.denied };
  }
  if (isNetworkLayerError(error) || options.online === false) {
    return { status: 'offline', message: GRADE_COPY.offline };
  }
  if (error instanceof NuniError) {
    return { status: 'error', message: nuniErrorMessage(error) };
  }
  return {
    status: 'error',
    message: `${GRADE_COPY.courseFailed} ${loadFailureCopy(error, options)}。`,
  };
}

export async function mapInBatches<T, R>(
  items: T[],
  size: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const result: R[] = [];
  for (let start = 0; start < items.length; start += size) {
    const batch = await Promise.all(items.slice(start, start + size).map(mapper));
    result.push(...batch);
  }
  return result;
}

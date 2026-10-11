export const APPEAL_STATUSES = ['pending', 'reviewing', 'approved', 'rejected', 'withdrawn'] as const;
export type AppealStatus = (typeof APPEAL_STATUSES)[number];

export type CourseAppeal = {
  id: string;
  schoolId: string;
  studentUid: string;
  courseId: string;
  courseName: string;
  title: string;
  body: string;
  status: AppealStatus;
  teacherNote: string;
  createdAt: unknown;
  updatedAt: unknown;
};

export const APPEAL_STATUS_COPY: Record<AppealStatus, { label: string; detail: string }> = {
  pending: { label: '已送出', detail: '已送出，等老師看。' },
  reviewing: { label: '老師在看', detail: '老師正在看這份申訴。' },
  approved: { label: '已核准', detail: '老師已核准。' },
  rejected: { label: '沒有核准', detail: '老師沒有核准。' },
  withdrawn: { label: '已撤回', detail: '你已撤回這份申訴。' },
};

export const APPEAL_EMPTY_COPY = {
  title: '目前沒有申訴',
  body: '要提出時填下面的表單。',
};

export const APPEAL_NEED_COURSE_COPY = '你的課表裡還沒有課，沒有課就不能送申訴。先到「我的課表」把課加進來。';

type TimeLike = string | number | Date | { toMillis?: () => number; seconds?: number } | null | undefined;

export function appealTimeValue(value: unknown): number {
  const time = value as TimeLike;
  if (!time) return 0;
  if (typeof time === 'number') return time;
  if (typeof time === 'string') return Date.parse(time) || 0;
  if (time instanceof Date) return time.getTime();
  if (typeof time.toMillis === 'function') return time.toMillis();
  if (typeof time.seconds === 'number') return time.seconds * 1000;
  return 0;
}

/** 頂卡跟著最近一次有變動的申訴走，老師核准後會馬上換成核准。 */
export function appealTopCard(appeals: CourseAppeal[]): { title: string; body: string; status: AppealStatus | null } {
  const visible = appeals.filter((item) => item.status !== 'withdrawn');
  if (!visible.length) {
    return { ...APPEAL_EMPTY_COPY, status: null };
  }
  const latest = [...visible].sort(
    (a, b) =>
      appealTimeValue(b.updatedAt || b.createdAt) - appealTimeValue(a.updatedAt || a.createdAt),
  )[0];
  const copy = APPEAL_STATUS_COPY[latest.status] || APPEAL_STATUS_COPY.pending;
  return {
    title: latest.courseName || latest.title,
    body: copy.detail,
    status: latest.status,
  };
}

export const APPEAL_STATUSES = [
  'pending',
  'reviewing',
  'approved',
  'rejected',
  'withdrawn',
] as const;
export type AppealStatus = (typeof APPEAL_STATUSES)[number];

export type CourseAppeal = {
  id: string;
  schoolId: string;
  studentUid: string;
  courseId: string;
  courseName: string;
  offeringId?: string;
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

/** 這門課還沒有對應的老師（包括沒有開課代號的舊申訴）時，送出後的說法。 */
export const APPEAL_NO_TEACHER_COPY = '這門課還沒對應老師，申訴暫時只有學校看得到。';

/** 哪些開課已經有對應老師：{ 開課代號: true }，沒列到的都當作還沒對應。 */
export type AppealTeacherMap = Record<string, boolean>;

export function appealHasTeacher(
  appeal: { offeringId?: string },
  assigned: AppealTeacherMap | null | undefined,
): boolean {
  return Boolean(appeal.offeringId && assigned && assigned[appeal.offeringId] === true);
}

/** 狀態說明：等老師看的申訴，要看這門課有沒有對應老師，不是看新舊。 */
export function appealStatusDetail(
  appeal: { status: AppealStatus; offeringId?: string },
  assigned: AppealTeacherMap | null | undefined,
): string {
  const copy = APPEAL_STATUS_COPY[appeal.status] || APPEAL_STATUS_COPY.pending;
  if (
    (appeal.status === 'pending' || !APPEAL_STATUS_COPY[appeal.status]) &&
    !appealHasTeacher(appeal, assigned)
  ) {
    return APPEAL_NO_TEACHER_COPY;
  }
  return copy.detail;
}

/** 剛送出（包括連按、第一下其實已經送到）時顯示的訊息。 */
export function appealSubmittedCopy(
  offeringId: string,
  assigned: AppealTeacherMap | null | undefined,
): string {
  return appealStatusDetail({ status: 'pending', offeringId }, assigned);
}

export const APPEAL_EMPTY_COPY = {
  title: '目前沒有申訴',
  body: '要提出時填下面的表單。',
};

export const APPEAL_NEED_COURSE_COPY = '先在『我的課表』加上這門課，才能送申訴。';

type TimeLike =
  | string
  | number
  | Date
  | { toMillis?: () => number; seconds?: number }
  | null
  | undefined;

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
export function appealTopCard(
  appeals: CourseAppeal[],
  assigned?: AppealTeacherMap | null,
): { title: string; body: string; status: AppealStatus | null } {
  const visible = appeals.filter((item) => item.status !== 'withdrawn');
  if (!visible.length) {
    return { ...APPEAL_EMPTY_COPY, status: null };
  }
  const latest = [...visible].sort(
    (a, b) =>
      appealTimeValue(b.updatedAt || b.createdAt) - appealTimeValue(a.updatedAt || a.createdAt),
  )[0];
  return {
    title: latest.courseName || latest.title,
    body: appealStatusDetail(latest, assigned),
    status: latest.status,
  };
}

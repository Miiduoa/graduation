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
  createdAt: string | null;
  updatedAt: string | null;
};

export const APPEAL_STATUS_COPY: Record<AppealStatus, { label: string; detail: string }> = {
  pending: { label: '待看', detail: '已送到本站，教師還沒看。' },
  reviewing: { label: '查看中', detail: '教師正在看這份申訴。' },
  approved: { label: '已核准', detail: '這份申訴已核准。' },
  rejected: { label: '未核准', detail: '這份申訴未核准。' },
  withdrawn: { label: '已撤回', detail: '你已撤回，不會繼續處理。' },
};

export function appealTopCard(appeals: CourseAppeal[]): { title: string; body: string; status: AppealStatus | null } {
  if (!appeals.length) {
    return {
      title: '目前沒有申訴',
      body: '現在沒有案件，所以沒有進度可看。要提出時填下面的表單。',
      status: null,
    };
  }
  const order: AppealStatus[] = ['reviewing', 'pending', 'approved', 'rejected', 'withdrawn'];
  const latest = [...appeals].sort((a, b) => {
    const rank = order.indexOf(a.status) - order.indexOf(b.status);
    if (rank !== 0) return rank;
    return String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || ''));
  })[0];
  const copy = APPEAL_STATUS_COPY[latest.status];
  return {
    title: `${copy.label}｜${latest.courseName || latest.title}`,
    body: copy.detail,
    status: latest.status,
  };
}

import type { PersonalCourse } from './timetable/course';
import { periodProfileForSchool, periodSlots } from './timetable/schoolPeriods';

export const APPLICATION_STATES = [
  'submitted',
  'read',
  'interview',
  'accepted',
  'rejected',
] as const;
export type ApplicationState = (typeof APPLICATION_STATES)[number];
export const APPLICATION_LABELS: Record<ApplicationState, string> = {
  submitted: '已送出',
  read: '單位已讀',
  interview: '約面談',
  accepted: '錄取',
  rejected: '未錄取',
};
export type WorkSlot = { day: number; start: string; end: string };
export type CareerOpportunity = {
  id: string;
  revision: number;
  type: 'workstudy' | 'internship' | 'fair';
  title: string;
  unit: string;
  pay: string;
  slots: WorkSlot[];
  places: number;
  deadline: string;
  credit: boolean;
  courseCode: string;
  published: boolean;
  sourceUrl: string;
  rightsTitle: string;
  rightsText: string;
  rightsUrl: string;
};
export type CareerApplication = {
  id: string;
  opportunityId: string;
  opportunityTitle: string;
  unit: string;
  uid: string;
  contact: string;
  introduction: string;
  state: ApplicationState;
  revision: number;
  submittedAt: string;
  updatedAt: string;
  message: string;
  rights: { revision: number; title: string; text: string; url: string; confirmedAt: string };
};
export type CareerAudit = {
  id: string;
  action: string;
  actorUid: string;
  targetId: string;
  at: string;
};
export type CareerSources = {
  office: boolean;
  departments: boolean;
  taiwanjobs: boolean;
  revision: number;
};
export type CareerWorkbenchEvent = {
  id: string;
  title: string;
  startsAt: string;
  source: 'school-club-events' | 'school-events';
};
export type WorkstudySnapshot = {
  events: CareerWorkbenchEvent[];
  opportunities: CareerOpportunity[];
  applications: CareerApplication[];
  canReview: boolean;
  canOperate: boolean;
  audit: CareerAudit[];
  sources: CareerSources | null;
};
export type CareerCommand =
  | { action: 'list'; audience: 'student' | 'staff' | 'ops' }
  | { action: 'save'; opportunity: CareerOpportunity }
  | {
      action: 'apply';
      opportunityId: string;
      revision: number;
      confirmed: boolean;
      contact: string;
      introduction: string;
    }
  | {
      action: 'review';
      applicationId: string;
      revision: number;
      state: ApplicationState;
      /** Omit to preserve the saved reply; an explicit empty string clears it. */
      message?: string;
    }
  | { action: 'sources'; sources: CareerSources };
export type CareerReply = { snapshot?: WorkstudySnapshot; id?: string };
export type CareerTransport = (schoolId: string, command: CareerCommand) => Promise<CareerReply>;
export type WorkstudyService = {
  load: (audience: 'student' | 'staff' | 'ops') => Promise<WorkstudySnapshot>;
  execute: (command: Exclude<CareerCommand, { action: 'list' }>) => Promise<CareerReply>;
  subscribe?: (
    audience: 'student' | 'staff' | 'ops',
    changed: () => void,
    failed: () => void,
  ) => () => void;
};
/** Inject an authenticated callable transport after approval. No endpoint is registered by this module. */
export function createWorkstudyService(
  schoolId: string,
  transport: CareerTransport,
): WorkstudyService {
  return {
    async load(audience) {
      const reply = await transport(schoolId, { action: 'list', audience });
      if (!reply.snapshot) throw new Error('職涯資料不完整，請重新整理。');
      return reply.snapshot;
    },
    execute: (command) => transport(schoolId, command),
  };
}
export function slotLabel(slot: WorkSlot) {
  return `週${'日一二三四五六'[slot.day % 7]} ${slot.start}–${slot.end}`;
}
export function slotValid(slot: WorkSlot) {
  return (
    Number.isInteger(slot.day) &&
    slot.day >= 1 &&
    slot.day <= 7 &&
    /^([01]\d|2[0-3]):[0-5]\d$/.test(slot.start) &&
    /^([01]\d|2[0-3]):[0-5]\d$/.test(slot.end) &&
    slot.start < slot.end
  );
}
/** Half-open time intervals: touching endpoints do not conflict. Unknown profiles never use PU times. */
export function workstudyConflicts(
  schoolId: string,
  slots: WorkSlot[],
  courses: PersonalCourse[] | null,
) {
  const profile = periodProfileForSchool(schoolId);
  if (!profile || !courses?.length) return { known: false, names: [] as string[] };
  const periods = periodSlots(profile);
  const names = new Set<string>();
  let known = true;
  for (const course of courses) {
    if (course.day === 0) {
      known = false;
      continue;
    }
    const start = periods[course.start - 1]?.start;
    const end = periods[course.end - 1]?.end;
    if (!start || !end) {
      known = false;
      continue;
    }
    if (slots.some((slot) => slot.day === course.day && slot.start < end && start < slot.end))
      names.add(course.name);
  }
  return { known, names: [...names] };
}
export function transitionAllowed(from: ApplicationState, to: ApplicationState) {
  return (
    (
      {
        submitted: ['read'],
        read: ['interview', 'accepted', 'rejected'],
        interview: ['accepted', 'rejected'],
        accepted: [],
        rejected: [],
      } as Record<ApplicationState, string[]>
    )[from]?.includes(to) ?? false
  );
}
export function emptyOpportunity(): CareerOpportunity {
  return {
    id: '',
    revision: 0,
    type: 'workstudy',
    title: '',
    unit: '',
    pay: '',
    slots: [],
    places: 1,
    deadline: '',
    credit: false,
    courseCode: '',
    published: false,
    sourceUrl: '',
    rightsTitle: '',
    rightsText: '',
    rightsUrl: '',
  };
}

/** Standard callable envelope; endpoint and existing auth-header provider are supplied by the approved host. */
export function createCareerCallableTransport({
  endpoint,
  authHeaders,
  fetcher = fetch,
}: {
  endpoint: string;
  authHeaders: () => Promise<Record<string, string>>;
  fetcher?: typeof fetch;
}): CareerTransport {
  return async (schoolId, command) => {
    const response = await fetcher(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify({ data: { ...command, schoolId } }),
    });
    const body = (await response.json()) as { result?: CareerReply; error?: { message?: string } };
    if (!response.ok || body.error)
      throw new Error(body.error?.message || '暫時無法完成職涯操作，請稍後重試。');
    if (!body.result) throw new Error('職涯服務回覆不完整，請重新整理。');
    return body.result;
  };
}

export function careerAuditLabel(action: string) {
  if (action.startsWith('career_review_')) {
    const state = action.slice('career_review_'.length) as ApplicationState;
    return APPLICATION_LABELS[state] ? `申請改為${APPLICATION_LABELS[state]}` : '更新申請';
  }
  return (
    (
      {
        career_publish: '上架機會',
        career_unpublish: '儲存下架機會',
        career_apply: '送出申請',
        career_sources: '調整資料來源',
      } as Record<string, string>
    )[action] || '職涯操作'
  );
}

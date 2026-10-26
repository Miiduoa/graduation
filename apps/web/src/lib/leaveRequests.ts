'use client';

import { collection, getDocs, limit, orderBy, query, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import {
  courseOfferingId, periodEnd, periodProfileForSchool, periodStart,
  type PersonalCourse,
} from '@campus/shared';
import { getAuth, getDb, getFunctionsInstance, isFirebaseConfigured } from '@/lib/firebase';
import { areFunctionsConfigured, FunctionsUnconfiguredError } from '@/lib/functionsUrl';
import {
  leaveFailureCopy,
  leavePageFailureFromError,
  withLeaveLoadTimeout,
} from '@/lib/leavePageState';

export type LeaveKind =
  | 'sick' | 'personal' | 'family' | 'official'
  | 'menstrual' | 'mental' | 'bereavement' | 'other';
export type LeavePeriod = 'all' | 'morning' | 'afternoon';
export type LeaveReviewStatus = 'pending' | 'approved' | 'rejected';
export type LeaveStatus = 'pending' | 'partial' | 'completed' | 'withdrawn';

export type LeaveCourse = {
  courseId: string;
  courseName: string;
  offeringId: string;
  reviewStatus: LeaveReviewStatus;
  reviewerNote: string;
  reviewedBy?: string;
  reviewedAt?: unknown;
};
export type LeaveRequest = {
  id: string;
  uid?: string;
  schoolId?: string;
  kind: LeaveKind;
  period: LeavePeriod;
  startDate: string;
  endDate: string;
  detail: string;
  status: LeaveStatus;
  courses: LeaveCourse[];
  officialSubmitted?: boolean;
  createdAt: unknown;
  updatedAt?: unknown;
};
export type LeaveReviewRow = Omit<LeaveRequest, 'uid' | 'schoolId' | 'updatedAt' | 'officialSubmitted'> & {
  studentName: string;
  createdAt: string | null;
};

export const LEAVE_KINDS: ReadonlyArray<{ id: LeaveKind; label: string }> = [
  { id: 'sick', label: '病假' },
  { id: 'personal', label: '事假' },
  { id: 'family', label: '家庭照顧' },
  { id: 'official', label: '公假' },
  { id: 'menstrual', label: '生理假' },
  { id: 'mental', label: '身心調適' },
  { id: 'bereavement', label: '喪假' },
  { id: 'other', label: '其他' },
];
export const LEAVE_PERIODS: ReadonlyArray<{ id: LeavePeriod; label: string }> = [
  { id: 'all', label: '全天' },
  { id: 'morning', label: '上午' },
  { id: 'afternoon', label: '下午' },
];
export const LEAVE_STATUSES: Record<LeaveStatus, string> = {
  pending: '等待站內核閱',
  partial: '部分課程已核閱',
  completed: '站內核閱完成',
  withdrawn: '已撤回',
};
export const LEAVE_REVIEWS: Record<LeaveReviewStatus, string> = {
  pending: '待核閱',
  approved: '同意',
  rejected: '不同意',
};

function timestampOf(value: unknown): number {
  if (typeof value === 'string') return Date.parse(value) || 0;
  if (value && typeof value === 'object') {
    const stamp = value as { toMillis?: () => number; seconds?: number };
    if (typeof stamp.toMillis === 'function') return stamp.toMillis();
    if (typeof stamp.seconds === 'number') return stamp.seconds * 1000;
  }
  return 0;
}

export function leaveKindLabel(kind: LeaveKind): string {
  return LEAVE_KINDS.find((item) => item.id === kind)?.label || '其他';
}

export function taipeiToday(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const value = (type: string) => parts.find((part) => part.type === type)?.value || '';
  return value('year') + '-' + value('month') + '-' + value('day');
}

export function shiftLeaveDay(value: string, by: number): string {
  const date = new Date(value + 'T00:00:00.000Z');
  if (Number.isNaN(date.getTime())) return value;
  date.setUTCDate(date.getUTCDate() + by);
  return date.toISOString().slice(0, 10);
}

export function validLeaveDates(startDate: string, endDate: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) return false;
  const start = Date.parse(startDate + 'T00:00:00Z');
  const end = Date.parse(endDate + 'T00:00:00Z');
  return Number.isFinite(start) && Number.isFinite(end) &&
    new Date(start).toISOString().slice(0, 10) === startDate &&
    new Date(end).toISOString().slice(0, 10) === endDate &&
    end >= start && end - start <= 30 * 86400000;
}

export function suggestedLeaveCourses(
  courses: PersonalCourse[],
  startDate: string,
  endDate: string,
  period: LeavePeriod = 'all',
  schoolId?: string,
): PersonalCourse[] {
  if (!validLeaveDates(startDate, endDate)) return [];
  const days = new Set<number>();
  for (let date = startDate; date <= endDate; date = shiftLeaveDay(date, 1)) {
    days.add(new Date(date + 'T00:00:00Z').getUTCDay());
  }
  const profile = periodProfileForSchool(schoolId);
  return courses.filter((course) => {
    if (!course.day || !days.has(course.day)) return false;
    // Schools without a verified period profile should not silently lose courses.
    if (period === 'all' || !profile) return true;
    const start = periodStart(course.start, profile);
    const end = periodEnd(course.end, profile);
    if (!start || !end) return true;
    return period === 'morning' ? start < '12:00' : end > '12:00';
  });
}

export function countLeaveReviews(courses: LeaveCourse[]) {
  return {
    total: courses.length,
    approved: courses.filter((item) => item.reviewStatus === 'approved').length,
    rejected: courses.filter((item) => item.reviewStatus === 'rejected').length,
    pending: courses.filter((item) => item.reviewStatus === 'pending').length,
  };
}

export function formatLeaveDate(date: string) {
  const parts = date.split('-');
  return parts.length === 3 ? Number(parts[1]) + '/' + Number(parts[2]) : date;
}

export function formatLeaveRange(start: string, end: string): string {
  return start === end ? formatLeaveDate(start) : formatLeaveDate(start) + '－' + formatLeaveDate(end);
}

export function leaveRequestError(error: unknown): string {
  const code = String((error as { code?: string })?.code || '');
  if (code.includes('failed-precondition')) return '課表或狀態已變更，請重新整理後再試。';
  if (code.includes('already-exists')) return '申請已存在，請重新整理確認。';
  const failure = leavePageFailureFromError(error);
  if (failure.status === 'forbidden') return '目前沒有這所學校或這門課的操作權限。';
  if (failure.status !== 'error' || failure.reason === 'network' || failure.reason === 'timeout') {
    return leaveFailureCopy('submit', failure);
  }
  return '目前無法確認操作是否完成，請先重新整理紀錄，再決定是否重試。';
}

function assertCloudUser(uid: string) {
  if (!isFirebaseConfigured() || !uid || getAuth()?.currentUser?.uid !== uid) {
    throw new Error('請先登入學校帳號。');
  }
}

function callable<Input, Output>(name: string) {
  if (!areFunctionsConfigured()) throw new FunctionsUnconfiguredError('請假服務尚未接通');
  return httpsCallable<Input, Output>(getFunctionsInstance(), name);
}

export async function listMyLeaveRequests(uid: string, schoolId: string): Promise<LeaveRequest[]> {
  assertCloudUser(uid);
  const result = await withLeaveLoadTimeout(getDocs(query(
    collection(getDb(), 'leaveRequests'),
    where('uid', '==', uid),
    where('schoolId', '==', schoolId),
    where('source', '==', 'campus-one'),
    orderBy('createdAt', 'desc'),
    limit(100),
  )));
  assertCloudUser(uid);
  return result.docs
    .filter((doc) => doc.data().source === 'campus-one' && Array.isArray(doc.data().courses))
    .map((doc) => ({ ...doc.data(), id: doc.id } as LeaveRequest))
    .sort((a, b) => timestampOf(b.createdAt) - timestampOf(a.createdAt));
}

export async function submitLeaveRequest(
  uid: string,
  data: {
    schoolId: string; requestId: string; startDate: string; endDate: string;
    kind: LeaveKind; period: LeavePeriod; detail: string; courseIds: string[];
  },
) {
  assertCloudUser(uid);
  if (!validLeaveDates(data.startDate, data.endDate)) {
    throw new Error('請假日期不正確，一次最多 31 天。');
  }
  const result = await callable<typeof data, { id: string; alreadySubmitted: boolean }>(
    'submitLeaveRequest',
  )(data);
  assertCloudUser(uid);
  return result.data;
}

export async function withdrawLeaveRequest(uid: string, requestId: string) {
  assertCloudUser(uid);
  await callable<{ requestId: string }, { status: string }>('withdrawLeaveRequest')({ requestId });
  assertCloudUser(uid);
}

export async function listLeaveReviewQueue(uid: string, schoolId: string) {
  assertCloudUser(uid);
  const result = await withLeaveLoadTimeout(
    callable<{ schoolId: string }, { rows: LeaveReviewRow[] }>(
      'listLeaveReviewQueue',
    )({ schoolId }),
  );
  assertCloudUser(uid);
  return result.data.rows;
}

export async function reviewLeaveRequest(
  uid: string, requestId: string, courseId: string,
  decision: 'approved' | 'rejected', note: string,
) {
  assertCloudUser(uid);
  await callable<{
    requestId: string; courseId: string; decision: 'approved' | 'rejected'; note: string;
  }, { id: string; status: LeaveStatus }>('reviewLeaveRequest')({
    requestId, courseId, decision, note,
  });
  assertCloudUser(uid);
}

export function leaveCourseOptions(courses: PersonalCourse[]) {
  return courses.filter((course) => course.name.trim()).map((course) => ({
    ...course,
    offeringId: courseOfferingId(course),
  }));
}

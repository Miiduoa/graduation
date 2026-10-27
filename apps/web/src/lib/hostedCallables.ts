/** Same-origin Next.js callables hosted at `/api/fn/{name}`. Keep this list tiny. */
export const HOSTED_WEB_CALLABLES = [
  'joinGroupByCode',
  'leaveGroup',
  'createTimetableShare',
  'revokeTimetableShare',
  'startLiveSession',
  'endLiveSession',
  'joinLiveSession',
  'correctAttendanceRecord',
  'submitLeaveRequest',
  'withdrawLeaveRequest',
  'reviewLeaveRequest',
  'listLeaveReviewQueue',
  'signInPuStudentId',
] as const;

export const LEAVE_WEB_CALLABLES = [
  'submitLeaveRequest',
  'withdrawLeaveRequest',
  'reviewLeaveRequest',
  'listLeaveReviewQueue',
] as const;

export const SCHOOL_LOGIN_WEB_CALLABLES = ['signInPuStudentId'] as const;

export type HostedWebCallable = (typeof HOSTED_WEB_CALLABLES)[number];

export function isHostedWebCallable(name: string): name is HostedWebCallable {
  return (HOSTED_WEB_CALLABLES as readonly string[]).includes(name);
}

export type LeaveWebCallable = (typeof LEAVE_WEB_CALLABLES)[number];

export function isLeaveWebCallable(name: string): name is LeaveWebCallable {
  return (LEAVE_WEB_CALLABLES as readonly string[]).includes(name);
}

export type SchoolLoginWebCallable = (typeof SCHOOL_LOGIN_WEB_CALLABLES)[number];

export function isSchoolLoginWebCallable(name: string): name is SchoolLoginWebCallable {
  return (SCHOOL_LOGIN_WEB_CALLABLES as readonly string[]).includes(name);
}

export function hostedWebCallablePath(name: string): string {
  return `/api/fn/${name}`;
}

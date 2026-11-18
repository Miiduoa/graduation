import * as tronClassScraper from '../../../../../backend/functions/tronClassScraper.js';
import {
  classifySchoolReadError,
  schoolHttpStatus,
  type SchoolReadErrorKind,
} from '@campus/shared/src/puLmsReadonly';
import { createPuRelayFetch } from './puEdgeRelay';
import { installCampusRelayFetch, readCampusHttpSetter } from './puCampusRelayInstall';

installCampusRelayFetch(readCampusHttpSetter(tronClassScraper), createPuRelayFetch());

export type LmsReadOk<T> = { ok: true; value: T };
export type LmsReadFail = { ok: false; status: number | null };
export type LmsReadResult<T> = LmsReadOk<T> | LmsReadFail;

export type LmsReadOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
};

export type LmsHomeworkPage = {
  homework_activities: unknown[];
  total: number | null;
};

export type LmsReadonlySource = {
  fetchCourses: (
    cookies: Record<string, string>,
    options: { userId?: number; status: 'ongoing' | 'upcoming' },
    readOptions?: LmsReadOptions,
  ) => Promise<unknown>;
  fetchHomeworkPage: (
    cookies: Record<string, string>,
    courseId: number,
    page: number,
    pageSize: number,
    readOptions?: LmsReadOptions,
  ) => Promise<LmsReadResult<LmsHomeworkPage>>;
  fetchHomeworkActivity?: (
    cookies: Record<string, string>,
    activityId: number,
    readOptions?: LmsReadOptions,
  ) => Promise<LmsReadResult<unknown>>;
  fetchStudentSubmissionList?: (
    cookies: Record<string, string>,
    activityId: number,
    studentId: number,
    readOptions?: LmsReadOptions,
  ) => Promise<LmsReadResult<unknown>>;
  fetchActivities: (
    cookies: Record<string, string>,
    courseId: number,
    query: '' | 'sub_course_id=0' | 'type=courseware_activity',
    readOptions?: LmsReadOptions,
  ) => Promise<LmsReadResult<unknown[]>>;
  fetchCourseAnnouncements: (
    cookies: Record<string, string>,
    courseId: number,
    readOptions?: LmsReadOptions,
  ) => Promise<LmsReadResult<unknown[]>>;
  fetchSiteAnnouncements: (cookies: Record<string, string>, readOptions?: LmsReadOptions) => Promise<LmsReadResult<unknown[]>>;
};

async function wrapRead<T>(run: () => Promise<T>): Promise<LmsReadResult<T>> {
  try {
    return { ok: true, value: await run() };
  } catch (error) {
    if (classifySchoolReadError(error) === 'session') throw error;
    return { ok: false, status: schoolHttpStatus(error) };
  }
}

export function sessionKind(error: unknown): SchoolReadErrorKind {
  return classifySchoolReadError(error);
}

export const tronClassLmsReadonlySource: LmsReadonlySource = {
  fetchCourses: (cookies, options, readOptions) =>
    tronClassScraper.tcFetchCourses(cookies, {
      ...options,
      status: options.status,
    }, readOptions),
  fetchHomeworkPage: (cookies, courseId, page, pageSize, readOptions) =>
    wrapRead(() => tronClassScraper.tcFetchHomeworkActivitiesPage(cookies, courseId, page, pageSize, readOptions)),
  fetchHomeworkActivity: (cookies, activityId, readOptions) =>
    wrapRead(() => tronClassScraper.tcFetchHomeworkActivityStrict(cookies, activityId, readOptions)),
  fetchStudentSubmissionList: (cookies, activityId, studentId, readOptions) =>
    wrapRead(() => tronClassScraper.tcFetchStudentHomeworkSubmissionList(cookies, activityId, studentId, readOptions)),
  fetchActivities: (cookies, courseId, query, readOptions) =>
    wrapRead(() => tronClassScraper.tcFetchActivitiesRaw(cookies, courseId, query, readOptions)),
  fetchCourseAnnouncements: (cookies, courseId, readOptions) =>
    wrapRead(() => tronClassScraper.tcFetchCourseAnnouncementsStrict(cookies, courseId, readOptions)),
  fetchSiteAnnouncements: (cookies, readOptions) =>
    wrapRead(() => tronClassScraper.tcFetchAnnouncementsStrict(cookies, readOptions)),
};

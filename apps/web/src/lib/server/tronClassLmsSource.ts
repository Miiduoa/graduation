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

export type LmsHomeworkPage = {
  homework_activities: unknown[];
  total: number | null;
};

export type LmsReadonlySource = {
  fetchCourses: (
    cookies: Record<string, string>,
    options: { userId?: number; status: 'ongoing' | 'upcoming' },
  ) => Promise<unknown>;
  fetchHomeworkPage: (
    cookies: Record<string, string>,
    courseId: number,
    page: number,
    pageSize: number,
  ) => Promise<LmsReadResult<LmsHomeworkPage>>;
  fetchActivities: (
    cookies: Record<string, string>,
    courseId: number,
    query: '' | 'sub_course_id=0' | 'type=courseware_activity',
  ) => Promise<LmsReadResult<unknown[]>>;
  fetchCourseAnnouncements: (
    cookies: Record<string, string>,
    courseId: number,
  ) => Promise<LmsReadResult<unknown[]>>;
  fetchSiteAnnouncements: (cookies: Record<string, string>) => Promise<LmsReadResult<unknown[]>>;
  fetchHomeworkSubmissions?: (
    cookies: Record<string, string>, courseId: number, homeworkId: number,
  ) => Promise<unknown[]>;
  submitHomeworkText?: (
    cookies: Record<string, string>, courseId: number, homeworkId: number, content: string,
  ) => Promise<{ accepted: boolean; receiptId: string | null; submittedAt: string | null }>;
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
  fetchCourses: (cookies, options) =>
    tronClassScraper.tcFetchCourses(cookies, {
      ...options,
      status: options.status,
    }),
  fetchHomeworkPage: (cookies, courseId, page, pageSize) =>
    wrapRead(() => tronClassScraper.tcFetchHomeworkActivitiesPage(cookies, courseId, page, pageSize)),
  fetchActivities: (cookies, courseId, query) =>
    wrapRead(() => tronClassScraper.tcFetchActivitiesRaw(cookies, courseId, query)),
  fetchCourseAnnouncements: (cookies, courseId) =>
    wrapRead(() => tronClassScraper.tcFetchCourseAnnouncementsStrict(cookies, courseId)),
  fetchSiteAnnouncements: (cookies) =>
    wrapRead(() => tronClassScraper.tcFetchAnnouncementsStrict(cookies)),
  fetchHomeworkSubmissions: (cookies, courseId, homeworkId) =>
    tronClassScraper.tcFetchHomeworkSubmissions(cookies, courseId, homeworkId),
  submitHomeworkText: (cookies, courseId, homeworkId, content) =>
    tronClassScraper.tcSubmitHomeworkText(cookies, courseId, homeworkId, content),
};

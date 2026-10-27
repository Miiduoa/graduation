import { tcFetchCourses } from '../../../../../backend/functions/tronClassScraper.js';
import type { LmsCoursesFetcher } from './tronClassCoursesHandler';

export const tronClassSchoolSource: LmsCoursesFetcher = (cookies, options) =>
  tcFetchCourses(cookies, {
    ...options,
    status: options.status === 'completed' ? 'ended' : options.status,
  });

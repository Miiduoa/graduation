import * as tronClassScraper from '../../../../../backend/functions/tronClassScraper.js';
import type { LmsCoursesFetcher } from './tronClassCoursesHandler';
import { createPuRelayFetch } from './puEdgeRelay';
import { installCampusRelayFetch, readCampusHttpSetter } from './puCampusRelayInstall';

installCampusRelayFetch(readCampusHttpSetter(tronClassScraper), createPuRelayFetch());

export const tronClassSchoolSource: LmsCoursesFetcher = (cookies, options) =>
  tronClassScraper.tcFetchCourses(cookies, {
    ...options,
    status: options.status === 'completed' ? 'ended' : options.status,
  });

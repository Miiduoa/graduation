import * as puScraper from '../../../../../backend/functions/puScraper.js';
import { buildDerivedCreditSummary } from '../../../../../backend/functions/lib/puCreditSummary.js';
import type { AcademicFetchers } from './academicRecordsHandlers';
import { createPuRelayFetch } from './puEdgeRelay';
import { installCampusRelayFetch, readCampusHttpSetter } from './puCampusRelayInstall';

installCampusRelayFetch(readCampusHttpSetter(puScraper), createPuRelayFetch());

export const academicSchoolSource: AcademicFetchers = {
  courses: puScraper.puFetchCourses,
  creditOverview: puScraper.puFetchCreditOverview,
  async grades(cookies, semester, options) {
    const result = await puScraper.puFetchGrades(cookies, semester, options);
    if (!result.success) return result;
    // 成績與學分整理共用同一次學校回應，不額外抓取，也不當成畢業資格審核。
    const derived = buildDerivedCreditSummary(result);
    return { ...result, creditSummary: derived.success ? derived.creditSummary : null };
  },
};

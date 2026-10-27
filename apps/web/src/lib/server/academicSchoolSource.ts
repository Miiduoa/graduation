import { puFetchCourses, puFetchGrades } from '../../../../../backend/functions/puScraper.js';
import { buildDerivedCreditSummary } from '../../../../../backend/functions/lib/puCreditSummary.js';
import type { AcademicFetchers } from './academicRecordsHandlers';

export const academicSchoolSource: AcademicFetchers = {
  courses: puFetchCourses,
  async grades(cookies, semester) {
    const result = await puFetchGrades(cookies, semester);
    if (!result.success) return result;
    // 成績與學分整理共用同一次學校回應，不額外抓取，也不當成畢業資格審核。
    const derived = buildDerivedCreditSummary(result);
    return { ...result, creditSummary: derived.success ? derived.creditSummary : null };
  },
};

'use strict';

// 通過判定與平均只採用同一組有效分數，不做布林值、陣列或物件的隱式轉型。
function parseNumericScore(score) {
  if (typeof score === 'number') {
    return Number.isFinite(score) && score >= 0 ? score : null;
  }
  if (typeof score !== 'string') return null;
  const value = score.trim();
  if (!/^\d+(?:\.\d+)?$/.test(value)) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

// 由已讀取成績推算修課進度，不代表校方畢業審核。
function classifyGrade(score) {
  const numeric = parseNumericScore(score);
  if (numeric !== null) return numeric >= 60 ? 'passed' : 'failed';
  if (typeof score !== 'string') return 'unknown';
  const value = score.trim();
  if (/^(?:pass|通過)(?:\(pass\))?$/i.test(value)) return 'passed';
  if (/^(?:fail|未通過|不及格)$/i.test(value)) return 'failed';
  return 'unknown';
}

function buildDerivedCreditSummary(gradeResult) {
  if (!gradeResult || gradeResult.success !== true) {
    return {
      success: false, creditSummary: null,
      error: gradeResult?.error || 'Grade data is unavailable'
    };
  }
  if (!Array.isArray(gradeResult.grades) || gradeResult.grades.length === 0) {
    return { success: false, creditSummary: null, error: 'No verifiable grade records available' };
  }
  const categories = new Map();
  const semesters = new Map();
  let totalEarned = 0;
  for (const grade of gradeResult.grades) {
    const category = String(grade.courseType || '其他').trim() || '其他';
    const semester = String(grade.semester || 'unknown');
    const creditValue = Number(grade.credits);
    const credits = Number.isFinite(creditValue) && creditValue >= 0 ? creditValue : 0;
    const status = classifyGrade(grade.score);
    if (!categories.has(category)) {
      categories.set(category, {
        category, earned: 0, courses: 0, passedCourses: 0,
        failedCourses: 0, unknownCourses: 0, credits: 0
      });
    }
    const group = categories.get(category);
    group.courses += 1;
    group.credits += credits;
    group[status === 'passed' ? 'passedCourses' : status === 'failed' ? 'failedCourses' : 'unknownCourses'] += 1;
    if (status === 'passed') {
      group.earned += credits;
      totalEarned += credits;
    }
    if (!semesters.has(semester)) {
      semesters.set(semester, {
        semester, courses: 0, credits: 0, weightedScore: 0, weightedCredits: 0
      });
    }
    const row = semesters.get(semester);
    row.courses += 1;
    if (status === 'passed') row.credits += credits;
    const numeric = parseNumericScore(grade.score);
    if (numeric !== null) {
      row.weightedScore += numeric * credits;
      row.weightedCredits += credits;
    }
  }
  return {
    success: true,
    creditSummary: {
      source: 'derived-from-grade-rows',
      officialAudit: false,
      totalRequired: null,
      totalEarned,
      totalCourses: gradeResult.grades.length,
      categories: [...categories.values()].sort((a,b) => b.earned - a.earned),
      semesters: [...semesters.values()].map(row => ({
        ...row,
        average: row.weightedCredits ? Math.round(row.weightedScore / row.weightedCredits * 100) / 100 : null,
        ranking: gradeResult.summary?.[row.semester] || {}
      })).sort((a,b) => b.semester.localeCompare(a.semester)),
      allSemesters: Array.isArray(gradeResult.allSemesters) ? gradeResult.allSemesters : [],
      gradeSummary: gradeResult.summary || {},
      limitation: 'Based on grade rows and a 60-point/pass heuristic; does not deduplicate retakes or verify degree requirements.'
    }
  };
}

module.exports = { classifyGrade, buildDerivedCreditSummary };

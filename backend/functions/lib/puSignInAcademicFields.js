'use strict';

/**
 * Build academic fields for the PU sign-in response from actually fetched data.
 * Credit audit must stay null until a separately validated audit result exists;
 * grade rows alone cannot establish graduation/credit-audit completion.
 */
function buildPuSignInAcademicFields(gradesResult) {
  const grades = gradesResult?.success === true
    ? {
        grades: Array.isArray(gradesResult.grades) ? gradesResult.grades : [],
        allSemesters: Array.isArray(gradesResult.allSemesters) ? gradesResult.allSemesters : [],
        summary: gradesResult.summary && typeof gradesResult.summary === 'object'
          ? gradesResult.summary
          : {},
      }
    : null;

  return { grades, creditAudit: null };
}

module.exports = { buildPuSignInAcademicFields };

const { buildPuSignInAcademicFields } = require('./puSignInAcademicFields');

describe('PU sign-in academic response', () => {
  test('includes successfully retrieved grades without fabricating a credit audit', () => {
    const result = buildPuSignInAcademicFields({
      success: true,
      grades: [{ courseName: '資訊管理', credits: 3, score: 88 }],
      allSemesters: ['1151'],
      summary: { average: 88 },
    });
    expect(result.grades.grades).toHaveLength(1);
    expect(result.grades.allSemesters).toEqual(['1151']);
    expect(result.grades.summary).toEqual({ average: 88 });
    expect(result.creditAudit).toBeNull();
  });

  test('responds explicitly when grade fetching fails', () => {
    expect(buildPuSignInAcademicFields({ success: false })).toEqual({
      grades: null,
      creditAudit: null,
    });
  });

  test('normalizes partially populated successful results', () => {
    expect(buildPuSignInAcademicFields({ success: true })).toEqual({
      grades: { grades: [], allSemesters: [], summary: {} },
      creditAudit: null,
    });
  });
});

const { classifyGrade, buildDerivedCreditSummary } = require('./puCreditSummary');

describe('Derived PU grade-credit summary', () => {
  test('does not report zero earned credits as a successful result when scraping failed', () => {
    const result = buildDerivedCreditSummary({ success: false, error: 'Session expired' });
    expect(result).toEqual({ success: false, creditSummary: null, error: 'Session expired' });
    expect(buildDerivedCreditSummary({success: true, grades: []}).success).toBe(false);
  });

  test('separates derived earned credits from unverifiable graduation requirements', () => {
    const result = buildDerivedCreditSummary({
      success: true,
      allSemesters: ['1151'],
      grades: [
        {semester:'1151',courseType:'必修',credits:3,score:85},
        {semester:'1151',courseType:'必修',credits:2,score:59},
        {semester:'1151',courseType:'選修',credits:2,score:'Pass'},
        {semester:'1151',courseType:'選修',credits:1,score:'待公告'}
      ]
    });
    expect(result.success).toBe(true);
    expect(result.creditSummary.totalRequired).toBeNull();
    expect(result.creditSummary.officialAudit).toBe(false);
    expect(result.creditSummary.totalEarned).toBe(5);
    expect(result.creditSummary.categories.find(c=>c.category==='選修').unknownCourses).toBe(1);
    expect(result.creditSummary.semesters[0].average).toBeCloseTo(74.6);
  });

  test('recognizes numeric zero and uncertain score without treating either as passed', () => {
    expect(classifyGrade(0)).toBe('failed');
    expect(classifyGrade('0')).toBe('failed');
    expect(classifyGrade('待公告')).toBe('unknown');
    expect(classifyGrade('通過(Pass)')).toBe('passed');
  });
});

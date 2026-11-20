import { calculateDetailedCredits, type DetailedGradTemplate } from '@campus/shared/src/creditAudit';

const template: DetailedGradTemplate = {
  id: 'reference-test',
  schoolId: 'pu',
  schoolName: '測試校園',
  departmentId: 'test-dept',
  departmentName: '測試學系',
  academicYear: '115',
  programType: 'university',
  totalCreditsRequired: 5,
  nonCreditRequirements: [{ key: 'language', label: '語言檢定', type: 'certification', description: '自行核對' }],
  categories: [
    {
      key: 'core',
      label: '校核心',
      minCredits: 2,
      subCategories: [{ key: 'writing', label: '寫作', minCredits: 2, maxCredits: 2 }],
    },
    { key: 'electives', label: '選修', minCredits: 1, maxCredits: 3 },
  ],
};

test('sub-category caps reduce the parent and total, while unknown categories earn nothing', () => {
  const result = calculateDetailedCredits({
    template,
    courses: [
      { name: '寫作課', credits: 3, categoryKey: 'core', subCategoryKey: 'writing', passed: true },
      { name: '專題', credits: 4, categoryKey: 'electives', passed: true },
      { name: '不明分類', credits: 10, categoryKey: 'other-school', passed: true },
      { name: '未知領域', credits: 2, categoryKey: 'core', subCategoryKey: 'wrong', passed: true },
    ],
    nonCreditSatisfied: { language: true },
  });
  expect(result.total).toEqual({ earned: 5, required: 5, remaining: 0 });
  expect(result.byCategory[0].earned).toBe(2);
  expect(result.byCategory[0].subCategories?.[0].earned).toBe(2);
  expect(result.byCategory[1].earned).toBe(3);
  expect(result.satisfied).toBe(true);
  expect(result.warnings.some((warning) => warning.includes('不明分類'))).toBe(true);
  expect(result.warnings.some((warning) => warning.includes('超過可採計上限'))).toBe(true);
});

test('a repeated identical course cannot silently double count to reach the threshold', () => {
  const result = calculateDetailedCredits({
    template,
    courses: [
      { name: '寫作課', credits: 2, categoryKey: 'core', subCategoryKey: 'writing', passed: true },
      { name: '寫作課', credits: 2, categoryKey: 'core', subCategoryKey: 'writing', passed: true },
      { name: '專題', credits: 2, categoryKey: 'electives', passed: true },
    ],
    nonCreditSatisfied: { language: true },
  });
  expect(result.total.earned).toBe(4);
  expect(result.total.remaining).toBe(1);
  expect(result.satisfied).toBe(false);
  expect(result.warnings.some((warning) => warning.includes('重複'))).toBe(true);
});

test('an unconfirmed course and unchecked non-credit condition are not assumed complete', () => {
  const result = calculateDetailedCredits({
    template,
    courses: [
      { name: '寫作課', credits: 2, categoryKey: 'core', subCategoryKey: 'writing', passed: true },
      { name: '專題', credits: 3, categoryKey: 'electives', passed: true },
      { name: '未通過', credits: 2, categoryKey: 'core', passed: false },
      { name: '無效學分', credits: Number.NaN, categoryKey: 'core', passed: true },
    ],
  });
  expect(result.total.earned).toBe(5);
  expect(result.nonCreditStatus[0].satisfied).toBe(false);
  expect(result.satisfied).toBe(false);
});

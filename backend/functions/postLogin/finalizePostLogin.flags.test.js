/**
 * finalizePostLogin run doc 旗標邏輯（與 finalizePostLogin.js 內聯條件一致，避免漂移）
 */
function computeRunFlags(errors) {
  const puCoursesFailed = errors.some((e) => e.code === 'pu_courses');
  const tronCoursesFailed = errors.some((e) => e.code === 'tron_courses');
  const tronRostersFailed = errors.some((e) => e.code === 'tron_members');
  const partial = errors.length > 0;
  return { puCoursesFailed, tronCoursesFailed, tronRostersFailed, partial };
}

describe('finalizePostLogin run flags', () => {
  test('tron_courses marks tronCoursesFailed and partial', () => {
    const f = computeRunFlags([{ code: 'tron_courses', message: 'timeout' }]);
    expect(f.tronCoursesFailed).toBe(true);
    expect(f.partial).toBe(true);
    expect(f.puCoursesFailed).toBe(false);
  });

  test('empty errors is not partial', () => {
    const f = computeRunFlags([]);
    expect(f.partial).toBe(false);
  });
});

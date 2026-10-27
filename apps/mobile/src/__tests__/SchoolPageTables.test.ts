import {
  extractSchoolPageTables,
  parsePersonalImport,
} from '@campus/shared';

/** Runs in React Native without DOMParser or browser globals. */
test('native import reads a user-saved school grade table without a network request', () => {
  const html = '<table><tr><th>科目名稱</th><th>學分</th><th>學期成績</th></tr>' +
    '<tr><td>資訊管理</td><td>3</td><td>91</td></tr></table>';
  const found = extractSchoolPageTables(html, 'grades');
  expect(found).toHaveLength(1);
  const result = parsePersonalImport(found[0].text, {
    kind: 'grades', schoolId: 'nthu', academicYear: '115', semester: '1',
    source: { type: 'file', name: 'school.html' },
  });
  expect(result.rows[0]).toMatchObject({
    title: '資訊管理', credits: 3, grade: '91', schoolId: 'nthu',
  });
});

test('school portal term is suggested only when explicitly visible and unambiguous', () => {
  const source = '<p>115 學年度上學期成績</p><table><tr><th>科目名稱</th><th>學分</th><th>成績</th></tr>' +
    '<tr><td>系統分析</td><td>3</td><td>88</td></tr></table>';
  expect(extractSchoolPageTables(source, 'grades')[0].suggestedTerm)
    .toEqual({ academicYear: '115', semester: '1' });
});

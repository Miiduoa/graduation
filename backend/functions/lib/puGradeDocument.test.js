const { parseGradeSemesterCodes, parsePuGradeDocument } = require('./puGradeDocument');

function section(semester, rows) {
  return '<p>學期別(Semester)：' + semester.slice(0, -1) + ' [ ' + semester.slice(-1) + ' ]</p>'
    + '<table><tr><th>科目名稱(Course)</th><th>班級(Class)</th><th>修別(Course type)</th><th>學分(Credits)</th><th>成績(Score)</th></tr>'
    + rows.map(cells => '<tr>' + cells.map(cell => '<td>' + cell + '</td>').join('') + '</tr>').join('') + '</table>';
}

describe('PU grade document parser', () => {
  const html = section('1151', [
    ['資料庫系統DATABASE SYSTEMS', '資管三', '必修', '3', '86'],
    ['學期平均成績', '', '', '', '86'],
  ]) + section('1142', [
    ['程式設計', '資管二', '選修', '2', '通過(Pass)'],
    ['班排名', '', '', '', '15'],
  ]);

  test('pairs grade tables with their semester, keeping real scores and summaries', () => {
    const parsed = parsePuGradeDocument(html);
    expect(parsed.success).toBe(true);
    expect(parsed.allSemesters).toEqual(['1151', '1142']);
    expect(parsed.grades).toHaveLength(2);
    expect(parsed.grades[0]).toMatchObject({
      semester: '1151', courseName: '資料庫系統', courseNameEn: 'DATABASE SYSTEMS',
      credits: 3, score: 86, courseType: '必修'
    });
    expect(parsed.grades[1]).toMatchObject({ semester: '1142', score: 'Pass' });
    expect(parsed.summary['1151']).toEqual({ semesterAverage: '86' });
    expect(parsed.summary['1142']).toEqual({ classRanking: '15' });
  });

  test('semester filter does not erase list of all available semesters', () => {
    const parsed = parsePuGradeDocument(html, '1142');
    expect(parsed.success).toBe(true);
    expect(parsed.grades.map(item => item.semester)).toEqual(['1142']);
    expect(parsed.allSemesters).toEqual(['1151', '1142']);
  });

  test('does not invent courses from a login page or changed markup', () => {
    const parsed = parsePuGradeDocument('<form action="index_check.php">login</form>');
    expect(parsed.success).toBe(false);
    expect(parsed.grades).toEqual([]);
    expect(parsed.error).toMatch(/headings/);
  });

  test('does not treat empty headings as a successful grade fetch', () => {
    const parsed = parsePuGradeDocument('<p>學期別(Semester)：115 [ 1 ]</p><table></table>');
    expect(parsed.success).toBe(false);
    expect(parsed.allSemesters).toEqual(['1151']);
  });

  test('deduplicates repeated semester headings and identical course rows', () => {
    const one = section('1151', [['統計', '資管', '必修', '3', '90']]);
    const parsed = parsePuGradeDocument(one + one);
    expect(parsed.allSemesters).toEqual(['1151']);
    expect(parsed.grades).toHaveLength(1);
  });

  test('handles absent input and numeric zero without converting it to a string', () => {
    expect(parsePuGradeDocument(null).success).toBe(false);
    const parsed = parsePuGradeDocument(section('1151', [['微積分', '資管', '必修', '3', '0']]));
    expect(parsed.grades[0].score).toBe(0);
    expect(parseGradeSemesterCodes('學期別(Semester)：115 [1]')).toEqual(['1151']);
  });
});

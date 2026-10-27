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

  test('reads the documented six-column historical transcript without separate semester headings', () => {
    const parsed = parsePuGradeDocument(`<table>
      <tr><th>學期別</th><th>課程名稱</th><th>修課班級</th><th>修別</th><th>學分數</th><th>成績</th></tr>
      <tr><td>1151</td><td>資料庫</td><td>資管三B</td><td>必修</td><td>3</td><td>86</td></tr>
      <tr><td>114-2</td><td>微學分</td><td>全校</td><td>選修</td><td>0.5</td><td>通過</td></tr>
    </table>`);
    expect(parsed).toMatchObject({ success: true, allSemesters: ['1151', '1142'] });
    expect(parsed.grades).toEqual([
      expect.objectContaining({ semester: '1151', courseName: '資料庫', credits: 3, score: 86 }),
      expect.objectContaining({ semester: '1142', courseName: '微學分', credits: 0.5, score: 'Pass' }),
    ]);
    expect(parsed.coverage).toEqual({ status: 'unknown', skippedRows: 0 });
  });

  test('resolves inline markup, entities, full-width punctuation and nested layout tables', () => {
    const parsed = parsePuGradeDocument(`<table><tr><td>
      <p><span>學期別</span><strong>（Semester）</strong>：<b>115</b>&nbsp;[&#49;]</p>
      <table><tr><th>課程名稱</th><th>學分數</th><th>成績</th></tr>
        <tr><td>商業&nbsp;資料分析</td><td>2.5</td><td>90</td></tr>
      </table>
    </td></tr></table>`);
    expect(parsed).toMatchObject({ success: true, allSemesters: ['1151'] });
    expect(parsed.grades[0]).toMatchObject({ courseName: '商業 資料分析', credits: 2.5, score: 90 });
  });

  test('uses named columns after reordering and carries an explicit rowspan semester', () => {
    const parsed = parsePuGradeDocument(`<table>
      <tr><th>學期別</th><th>成績</th><th>課程類別</th><th>課程名稱</th><th>學分</th><th>選課代號</th></tr>
      <tr><td rowspan="2">115 [1]</td><td>0</td><td>選修</td><td>實作</td><td>1</td><td>IM01</td></tr>
      <tr><td></td><td>選修</td><td>實作</td><td>1</td><td>IM02</td></tr>
    </table>`);
    expect(parsed.success).toBe(true);
    expect(parsed.grades).toHaveLength(2);
    expect(parsed.grades[0]).toMatchObject({ semester: '1151', score: 0, courseCode: 'IM01', courseType: '選修' });
    expect(parsed.grades[1]).toMatchObject({ semester: '1151', score: '', courseCode: 'IM02' });
  });

  test('keeps unpublished grades and reports rows with unverified credits as partial', () => {
    const parsed = parsePuGradeDocument(section('1151', [
      ['專題', '資管', '必修', '2', ''],
      ['語言', '全校', '選修', '', '80'],
      ['體育', '全校', '必修', '0', '待公告'],
    ]));
    expect(parsed.success).toBe(true);
    expect(parsed.grades.map(row => row.score)).toEqual(['', '待公告']);
    expect(parsed.coverage).toEqual({ status: 'partial', skippedRows: 1 });
  });

  test('does not discard a course merely because its name mentions rankings or averages', () => {
    const parsed = parsePuGradeDocument(section('1151', [
      ['搜尋排名演算法', '資管', '選修', '3', '90'],
      ['平均數與統計分析', '資管', '選修', '2', '85'],
      ['學期平均成績', '', '', '', '88'],
    ]));
    expect(parsed.grades.map(row => row.courseName)).toEqual(['搜尋排名演算法', '平均數與統計分析']);
    expect(parsed.summary['1151']).toEqual({ semesterAverage: '88' });
  });

  test('does not turn scripts, templates, or unknown semester labels into grade records', () => {
    const decoy = section('1141', [['假資料', '測試', '必修', '3', '90']]);
    const parsed = parsePuGradeDocument(`<script>${decoy}</script><template>${decoy}</template><table>
      <tr><th>學期別</th><th>課程名稱</th><th>學分</th><th>成績</th></tr>
      <tr><td>1151</td><td>統計</td><td>3</td><td>85</td></tr>
      <tr><td>不明</td><td>商管</td><td>3</td><td>75</td></tr>
    </table>`);
    expect(parsed.allSemesters).toEqual(['1151']);
    expect(parsed.grades).toHaveLength(1);
    expect(parsed.coverage).toEqual({ status: 'partial', skippedRows: 1 });
  });
});

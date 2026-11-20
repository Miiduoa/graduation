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

  test('reads 學年 headings without 度 and full-width credit digits', () => {
    const parsed = parsePuGradeDocument(`
      <p>114學年第2學期</p>
      <table>
        <tr><th>科目名稱(Course)</th><th>修課班級(Class)</th><th>修別(Course type)</th><th>學分數(Credits)</th><th>成績(Score)</th></tr>
        <tr><td>微積分</td><td>全校</td><td>必修</td><td>３學分</td><td>90</td></tr>
      </table>`);
    expect(parsed).toMatchObject({ success: true, allSemesters: ['1142'] });
    expect(parsed.grades[0]).toMatchObject({ semester: '1142', courseName: '微積分', credits: 3, score: 90 });
    expect(parsed.coverage).toEqual({ status: 'unknown', skippedRows: 0 });
  });

  test('does not treat bilingual follow-up rows or empty-semester summaries as unverified courses', () => {
    const parsed = parsePuGradeDocument(`<table>
      <tr><th>學期別</th><th>課程名稱</th><th>修課班級</th><th>修別</th><th>學分數</th><th>成績</th></tr>
      <tr><td>1151</td><td>資料庫系統</td><td>資管三A</td><td>必修</td><td>3</td><td>86</td></tr>
      <tr><td></td><td>DATABASE SYSTEMS</td><td></td><td></td><td></td><td></td></tr>
      <tr><td></td><td>學期平均成績(Semester average)</td><td></td><td></td><td></td><td>86</td></tr>
      <tr><td></td><td>操行成績(Behavior score)</td><td></td><td></td><td></td><td>90</td></tr>
      <tr><td></td><td>班排名(Class ranking)</td><td></td><td></td><td></td><td>10 / 40</td></tr>
      <tr><td></td><td>系排名(Department ranking)</td><td></td><td></td><td></td><td>20 / 80</td></tr>
      <tr><td>1142</td><td>程式設計</td><td>資管二A</td><td>必修</td><td>3</td><td>90</td></tr>
      <tr><td></td><td>PROGRAMMING</td><td></td><td></td><td></td><td></td></tr>
    </table>`);
    expect(parsed.success).toBe(true);
    expect(parsed.grades).toEqual([
      expect.objectContaining({
        semester: '1151', courseName: '資料庫系統', courseNameEn: 'DATABASE SYSTEMS', credits: 3, score: 86,
      }),
      expect.objectContaining({
        semester: '1142', courseName: '程式設計', courseNameEn: 'PROGRAMMING', credits: 3, score: 90,
      }),
    ]);
    expect(parsed.summary['1151']).toEqual({
      semesterAverage: '86', behaviorScore: '90', classRanking: '10 / 40', departmentRanking: '20 / 80',
    });
    expect(parsed.coverage).toEqual({ status: 'unknown', skippedRows: 0 });
  });

  test('mypu six-column transcript does not count per-semester footer rows as missing courses', () => {
    const titles = [
      '資料庫系統', '線性代數', '英文', '體育', '程式設計', '統計學', '會計學',
      '微積分', '經濟學', '計算機概論', '中文', '歷史', '心理學', '管理學',
      '行銷學', '財務管理', '作業研究', '資訊倫理', '系統分析', '網路概論',
      '資料結構', '作業系統', '軟體工程', '專題', '實習', '通識講座',
      '服務學習', '軍訓', '音樂', '美術', '哲學', '法律與生活', '環境科學', '程式實習',
    ];
    const groups = [
      ['1151', 6, true], ['1142', 6, true], ['1141', 5, true], ['1132', 5, true],
      ['1131', 4, true], ['1122', 4, true], ['1121', 4, false],
    ];
    const footers = ['學期平均成績(Semester average)', '操行成績(Behavior score)', '班排名(Class ranking)', '系排名(Department ranking)'];
    const courseRows = [];
    const htmlRows = [];
    let offset = 0;
    groups.forEach(([code, count, hasFooter], groupIndex) => {
      for (let i = 0; i < count; i += 1) {
        const title = titles[offset];
        const cells = [code, title, '資管', i % 2 ? '選修' : '必修', String(1 + (i % 3)), String(70 + i)];
        courseRows.push(title);
        htmlRows.push('<tr>' + cells.map((cell) => '<td>' + cell + '</td>').join('') + '</tr>');
        offset += 1;
      }
      if (hasFooter) {
        footers.forEach((label, kind) => {
          const score = kind === 0 ? String(80 + groupIndex) : kind === 1 ? String(85 + groupIndex) : `${groupIndex + 1} / 40`;
          htmlRows.push(`<tr><td></td><td>${label}</td><td></td><td></td><td></td><td>${score}</td></tr>`);
        });
      }
    });
    const parsed = parsePuGradeDocument(`<table>
      <tr><th>學期別</th><th>課程名稱</th><th>修課班級</th><th>修別</th><th>學分數</th><th>成績</th></tr>
      ${htmlRows.join('')}
    </table>`);
    expect(courseRows).toHaveLength(34);
    expect(htmlRows).toHaveLength(58);
    expect(parsed.success).toBe(true);
    expect(parsed.grades).toHaveLength(34);
    expect(parsed.grades.map((row) => row.courseName)).toEqual(courseRows);
    expect(parsed.summary['1151']).toEqual({
      semesterAverage: '80', behaviorScore: '85', classRanking: '1 / 40', departmentRanking: '1 / 40',
    });
    expect(parsed.summary['1142'].semesterAverage).toBe('81');
    expect(parsed.coverage).toEqual({ status: 'unknown', skippedRows: 0 });
  });
});

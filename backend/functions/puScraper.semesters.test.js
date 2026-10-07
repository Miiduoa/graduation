const { parseGradeSemesterCodes } = require('./puScraper');

describe('PU grade semester extraction', () => {
  test('reads ROC academic-year semester headings in source order', () => {
    const html = [
      '<p>學期別(Semester)：115 [ 1 ]</p>',
      '<table><tr><td>課程 A</td></tr></table>',
      '<p>學期別(Semester): 114 [2]</p>',
      '<p>學期別(Semester)：115 [ 1 ]</p>',
    ].join('');
    expect(parseGradeSemesterCodes(html)).toEqual(['1151', '1142']);
  });

  test('does not invent semesters when the page has no grade headings', () => {
    expect(parseGradeSemesterCodes('<p>目前無資料</p>')).toEqual([]);
    expect(parseGradeSemesterCodes(null)).toEqual([]);
  });
});

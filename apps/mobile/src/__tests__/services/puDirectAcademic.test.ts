import { puFetchCourses, puFetchCreditAudit, puFetchGrades } from '../../services/puDirectScraper';

const session = { loggedIn: true as const, studentName: '測試同學' };
const originalFetch = globalThis.fetch;
const mockFetch = jest.fn();
const document = (body: string) =>
  `<!doctype html><html><body>${body}<!-- ${'fixture '.repeat(30)} --></body></html>`;

beforeEach(() => {
  mockFetch.mockReset();
  globalThis.fetch = mockFetch;
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

test('native course rows and semester totals preserve fractional credits', async () => {
  const html = document(`
    <p>學號(Student No.)：412345678</p><p>115學年度 第1學期</p><p>學期總學分：1.5</p>
    <table><tr><th>course code</th><th>班級</th><th>課程</th><th>修別</th><th>學分</th><th>時地</th><th>教師</th></tr>
    <tr><td>CS101</td><td>資工一</td><td>資料庫 Database</td><td>必修</td><td>1.5</td><td>一(Mon)1,2:資101</td><td>teacher@example.test</td></tr></table>`);
  mockFetch.mockResolvedValue({ status: 200, text: async () => html });
  const result = await puFetchCourses(session);
  expect(result.success).toBe(true);
  expect(result.data?.courses).toHaveLength(1);
  expect(result.data?.courses[0].credits).toBe(1.5);
  expect(result.data?.totalCredits).toBe(1.5);
});

test('native semester grades preserve fractional credits and a zero score', async () => {
  const html = document(`
    <p>學期別(Semester)：115 [ 1 ]</p>
    <table><tr><th>科目名稱(Course)</th><th>修課班級(Class)</th><th>修別(Course type)</th><th>學分數(Credits)</th><th>成績(Score)</th></tr>
    <tr><td>資料庫 Database</td><td>資工一</td><td>必修</td><td>1.5</td><td>0</td></tr></table>`);
  mockFetch.mockResolvedValue({ status: 200, text: async () => html });
  const result = await puFetchGrades(session);
  expect(result.success).toBe(true);
  expect(result.data?.grades).toHaveLength(1);
  expect(result.data?.grades[0]).toMatchObject({ semester: '1151', credits: 1.5, score: 0 });
});

test.each([
  document('<h1>系統維護中</h1>'),
  document('<form><input TYPE="password" name="password"></form>'),
])(
  'unrecognized or expired pages cannot become an empty successful grade response',
  async (html) => {
    mockFetch.mockResolvedValue({ status: 200, text: async () => html });
    const result = await puFetchGrades(session);
    expect(result.success).toBe(false);
    expect(result.data).toBeNull();
  },
);

test('an explicit empty grade response with student context remains an empty success', async () => {
  mockFetch.mockResolvedValue({
    status: 200,
    text: async () => document('<p>學號(Student No.)：412345678</p><p>查無成績資料</p>'),
  });
  const result = await puFetchGrades(session);
  expect(result.success).toBe(true);
  expect(result.data?.grades).toEqual([]);
});

test('school credit subtotals preserve decimals without deriving missing categories from grades', async () => {
  mockFetch.mockImplementation(async (url: string) => ({
    status: 200,
    text: async () =>
      document(
        url.includes('score_all.php')
          ? '<p>學期別(Semester)：115 [ 1 ]</p><table><tr><td>資料庫 Database</td><td>資工一</td><td>必修</td><td>1.5</td><td>不通過</td></tr></table>'
          : '<h1>學分試算表</h1><p>【必修】：1.5學分</p><p>【小計(不含輔雙)】：1.5</p>',
      ),
  }));
  const result = await puFetchCreditAudit(session);
  expect(result.error).toBeUndefined();
  expect(result.success).toBe(true);
  expect(result.data?.creditTotals).toMatchObject({ required: 1.5, subtotal: 1.5, elective: null });
  expect(result.data?.semesterGrades[0].courses[0]).toMatchObject({
    credits: 1.5,
    score: '不通過',
  });
});

test.each([
  ['0', '0', 0, 0],
  ['1.5', '0', 1.5, 0],
  ['', '未公布', undefined, undefined],
  ['0invalid', 'Infinity', undefined, undefined],
])(
  'professional elective credits distinguish %s / %s from missing values',
  async (credits, earned, expectedCredits, expectedEarned) => {
    const html = document(`<h1>學分試算表</h1><h2>專業選修必備選項</h2>
    <table><tr><th>課群名稱</th><th>課程名稱</th><th>修課班級</th><th>學期</th><th>學分數</th><th>取得學分</th></tr>
    <tr><td>資工專業</td><td>資料庫</td><td>資工一</td><td>1151</td><td>${credits}</td><td>${earned}</td></tr></table>
    <h2>修習學分累計</h2>`);
    mockFetch.mockResolvedValue({ status: 200, text: async () => html });
    const result = await puFetchCreditAudit(session);
    expect(result.error).toBeUndefined();
    expect(result.data?.professionalElectiveOptions).toHaveLength(1);
    expect(result.data?.professionalElectiveOptions[0]).toMatchObject({
      credits: expectedCredits,
      earnedCredits: expectedEarned,
    });
  },
);

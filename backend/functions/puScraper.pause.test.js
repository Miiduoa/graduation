const { EventEmitter } = require('events');
const https = require('https');
const {
  puLogin,
  puFetchCourses,
  puFetchGrades,
  puFetchAnnouncements,
  puFetchAbsence,
  puFetchCreditSummary,
  puFetchStudentInfo,
} = require('./puScraper');
const { isEcampusFetchPaused, ecampusPausedResult } = require('./lib/ecampusFetchPause');

const coursePage = `<p>學號(Student No.)：410000001 姓名(Student Name)：測試 班級(Class)：資管三A</p>
<p>114學年度 第1學期</p><a href="query_course.html">query_course</a>
<table><tr><th>選課代號</th><th>上課班級</th><th>科目</th><th>修別</th><th>學分</th><th>上課時間地點</th><th>老師email</th></tr></table>
<p>查無選課資料</p>`;

function mockRequests(respond = () => ({ html: coursePage })) {
  const requests = [];
  jest.spyOn(https, 'request').mockImplementation((options, callback) => {
    requests.push(options);
    const request = new EventEmitter();
    request.write = jest.fn();
    request.destroy = jest.fn();
    request.end = () => {
      const fixture = respond(options, requests.length - 1);
      const response = new EventEmitter();
      response.headers = fixture.headers || {};
      response.statusCode = fixture.status || 200;
      callback(response);
      response.emit('data', Buffer.from(fixture.html || ''));
      response.emit('end');
    };
    return request;
  });
  return requests;
}

const ENV = 'PU_ECAMPUS_FETCH_PAUSED';
const original = process.env[ENV];

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  delete process.env[ENV];
});
afterEach(() => {
  jest.restoreAllMocks();
  if (original === undefined) delete process.env[ENV];
  else process.env[ENV] = original;
});

describe('isEcampusFetchPaused', () => {
  test.each([
    ['1', true],
    ['true', true],
    ['TRUE', true],
    [' true ', true],
    [undefined, false],
    ['', false],
    ['0', false],
    ['false', false],
    ['yes', false],
    ['on', false],
  ])('%p → %p', (value, expected) => {
    expect(isEcampusFetchPaused(value === undefined ? {} : { [ENV]: value })).toBe(expected);
  });
});

describe('E 校園暫停時，資料抓取對 alcat／mypu 的請求數為 0', () => {
  const cookies = { SID: 'session' };
  const cases = [
    ['courses', () => puFetchCourses(cookies, '')],
    ['grades', () => puFetchGrades(cookies, '')],
    ['grades', () => puFetchGrades(cookies, '', { mypuCookies: { PHPSESSID: 'mypu' } })],
    ['announcements', () => puFetchAnnouncements(cookies)],
    ['absence', () => puFetchAbsence(cookies)],
    ['creditSummary', () => puFetchCreditSummary(cookies)],
    ['studentInfo', () => puFetchStudentInfo(cookies)],
  ];

  test.each(cases)('%s', async (kind, run) => {
    process.env[ENV] = '1';
    const requests = mockRequests();
    const result = await run();
    expect(requests).toHaveLength(0);
    expect(result).toEqual(ecampusPausedResult(kind));
    expect(result).toMatchObject({ success: false, paused: true, code: 'ecampus-paused' });
  });

  test('關閉時課表照常讀取 alcat query_course.html（行為不變）', async () => {
    process.env[ENV] = 'false';
    const requests = mockRequests();
    const result = await puFetchCourses(cookies, '');
    expect(result.paused).toBeUndefined();
    expect(result.success).toBe(true);
    expect(requests.map((row) => `${row.method} ${row.hostname}${row.path}`)).toEqual([
      'GET alcat.pu.edu.tw/stu_query/query_course.html',
    ]);
  });

  test('關閉時成績照常走 alcat → mypu SSO 轉接', async () => {
    const requests = mockRequests(() => ({ html: '<p>empty</p>' }));
    await puFetchGrades(cookies, '');
    expect(requests.length).toBeGreaterThan(0);
    expect(requests[0].hostname).toBe('alcat.pu.edu.tw');
  });
});

describe('學號登入（puLogin）不受暫停開關影響', () => {
  test.each(['1', undefined])('開關 %p 時登入請求相同', async (value) => {
    if (value !== undefined) process.env[ENV] = value;
    const requests = mockRequests();
    const result = await puLogin('410000001', 'test-password');
    expect(result.success).toBe(true);
    expect(requests.map((row) => `${row.method} ${row.hostname}${row.path}`)).toEqual([
      'GET alcat.pu.edu.tw/',
      'POST alcat.pu.edu.tw/index_check.php',
      'GET alcat.pu.edu.tw/stu_query/query_course.html',
    ]);
  });
});

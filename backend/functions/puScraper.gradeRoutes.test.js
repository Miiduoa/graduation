const { EventEmitter } = require('events');
const https = require('https');
const { puFetchGrades, puFetchCreditSummary } = require('./puScraper');

const DIRECT = '/stu_query/score_all.php';
const LEGACY = '/score_query/score_all.php';
const header = '<tr><th>學期別</th><th>課程名稱</th><th>修課班級</th><th>修別</th><th>學分數</th><th>成績</th></tr>';
const grade = (term, title, credits, score) => `<tr><td>${term}</td><td>${title}</td><td>測試班</td><td>選修</td><td>${credits}</td><td>${score}</td></tr>`;
const transcript = `<table>${header}${grade('1142', '資料庫', 3, 86)}${grade('1151', '微學分', 0.5, 'Pass')}${grade('1151', '實習', 1, 0)}</table>`;
const single = `<table>${header}${grade('1151', '資料庫', 3, 86)}</table>`;

function mockSchool(respond) {
  const calls = [];
  jest.spyOn(https, 'request').mockImplementation((options, callback) => {
    calls.push(options);
    const request = new EventEmitter();
    request.write = jest.fn();
    request.destroy = jest.fn();
    request.end = () => {
      const fixture = respond(options, calls.length - 1);
      if (fixture.error) { request.emit('error', new Error(fixture.error)); return; }
      const response = new EventEmitter();
      response.statusCode = fixture.status || 200;
      response.headers = fixture.headers || {};
      callback(response);
      response.emit('data', Buffer.from(fixture.html || ''));
      response.emit('end');
    };
    return request;
  });
  return calls;
}

beforeEach(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

test('uses the existing e-campus transcript entry before contacting mypu', async () => {
  const calls = mockSchool(() => ({ html: transcript }));
  const result = await puFetchGrades({ SID: 'fixture' });
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({ hostname: 'alcat.pu.edu.tw', path: DIRECT, family: 4 });
  expect(result).toMatchObject({ success: true, allSemesters: ['1142', '1151'] });
  expect(result.grades.map(row => [row.credits, row.score])).toEqual([[3, 86], [0.5, 'Pass'], [1, 0]]);
  expect(result.cookies).toBeUndefined();
});

test('does not require more than one semester for a valid direct transcript', async () => {
  const calls = mockSchool(() => ({ html: single }));
  expect((await puFetchGrades({ SID: 'fixture' })).grades).toHaveLength(1);
  expect(calls).toHaveLength(1);
});

test('passes the requested semester to the same document parser', async () => {
  mockSchool(() => ({ html: transcript }));
  const result = await puFetchGrades({ SID: 'fixture' }, '1151');
  expect(result.grades).toHaveLength(2);
  expect(result.grades.every(row => row.semester === '1151')).toBe(true);
});

test('feeds the same direct grade source into the derived credit summary', async () => {
  const calls = mockSchool(() => ({ html: transcript }));
  const result = await puFetchCreditSummary({ SID: 'fixture' });
  expect(result).toMatchObject({ success: true, creditSummary: {
    totalEarned: 3.5, officialAudit: false, totalRequired: null,
  } });
  expect(calls).toHaveLength(1);
});

test.each([
  ['missing route', { status: 404 }],
  ['maintenance HTML', { html: '<p>系統維護中</p>' }],
  ['empty recognized table', { html: `<table>${header}</table>` }],
  ['network error', { error: 'ECONNRESET' }],
])('retains the legacy path after a direct %s', async (_label, directResponse) => {
  const calls = mockSchool((options) => options.path === DIRECT ? directResponse : { html: transcript });
  const result = await puFetchGrades({ SID: 'fixture' });
  expect(result.success).toBe(true);
  expect(result.grades).toHaveLength(3);
  expect(calls.map(call => call.path)).toEqual([DIRECT, LEGACY]);
});

test('keeps same-name cookie rotation when falling back to an older route', async () => {
  const cookies = { SID: 'original' };
  const calls = mockSchool((options) => options.path === DIRECT
    ? { html: '<p>轉接中</p>', headers: { 'set-cookie': ['SID=renewed; Path=/; Secure'] } }
    : { html: transcript });
  expect((await puFetchGrades(cookies)).success).toBe(true);
  expect(calls[1].headers.Cookie).toBe('SID=renewed');
  expect(cookies).toEqual({ SID: 'original' });
});

test('resolves a relative direct redirect within the same school host', async () => {
  const calls = mockSchool((_options, index) => index === 0
    ? { status: 302, headers: { location: 'history.php', 'set-cookie': ['SID=next; Path=/'] } }
    : { html: transcript });
  expect((await puFetchGrades({ SID: 'fixture' })).success).toBe(true);
  expect(calls.map(call => call.path)).toEqual([DIRECT, '/stu_query/history.php']);
  expect(calls[1].headers.Cookie).toBe('SID=next');
});

test.each([[401, 'session-expired'], [403, 'permission-denied'], [429, 'resource-exhausted']])(
  'stops after an explicit HTTP %s instead of trying other school endpoints', async (status, code) => {
    const calls = mockSchool(() => ({ status }));
    expect(await puFetchGrades({ SID: 'fixture' })).toMatchObject({ success: false, code, grades: [] });
    expect(calls).toHaveLength(1);
  },
);

test('asks for reconnection when the direct page is the login form', async () => {
  const calls = mockSchool(() => ({ html: '<form action="index_check.php"><input name="uid"><input name="upassword"></form>' }));
  expect(await puFetchGrades({ SID: 'fixture' })).toMatchObject({ success: false, code: 'session-expired' });
  expect(calls).toHaveLength(1);
});

test('keeps valid legacy grades when the last source has no recognizable rows', async () => {
  mockSchool((options) => {
    if (options.path === DIRECT) return { status: 404 };
    if (options.hostname === 'alcat.pu.edu.tw' && options.path === LEGACY) return { html: single };
    return { html: `<table>${header}</table>` };
  });
  expect(await puFetchGrades({ SID: 'fixture' })).toMatchObject({ success: true, grades: [{ courseName: '資料庫' }] });
});

test('returns unavailable rather than successful zero grades for changed pages', async () => {
  mockSchool(() => ({ html: '<p>校務版面已改版</p>' }));
  expect(await puFetchGrades({ SID: 'fixture' })).toMatchObject({ success: false, grades: [] });
});

test('keeps partial coverage instead of claiming the whole transcript was read', async () => {
  mockSchool(() => ({ html: `<table>${header}${grade('1151', '可讀課程', 0.5, 0)}${grade('1151', '需核對課程', '待確認', 90)}</table>` }));
  expect(await puFetchGrades({ SID: 'fixture' })).toMatchObject({
    success: true, coverage: { status: 'partial', skippedRows: 1 }, grades: [{ credits: 0.5, score: 0 }],
  });
});

test('never sends session cookies to a foreign redirect', async () => {
  const calls = mockSchool((options) => options.path === DIRECT
    ? { status: 302, headers: { location: 'https://other.example/collect' } }
    : { html: transcript });
  await puFetchGrades({ SID: 'fixture' });
  expect(calls.every(call => call.hostname === 'alcat.pu.edu.tw')).toBe(true);
});

const { EventEmitter } = require('events');
const https = require('https');
const { puLogin, puFetchCourses, puFetchGrades } = require('./puScraper');

const gradePage = `<table>
  <tr><th>學期別</th><th>課程名稱</th><th>修課班級</th><th>修別</th><th>學分數</th><th>成績</th></tr>
  <tr><td>1151</td><td>資料庫</td><td>資管三</td><td>必修</td><td>3</td><td>86</td></tr>
</table>`;

function mockRequests(respond) {
  const requests = [];
  jest.spyOn(https, 'request').mockImplementation((options, callback) => {
    requests.push(options);
    const request = new EventEmitter();
    request.write = jest.fn();
    request.destroy = jest.fn();
    request.end = () => {
      const fixture = respond(options, requests.length - 1);
      if (!fixture) return;
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

describe('PU session continuity and bounded requests', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  test('keeps same-name session cookie rotations through the grade bridge', async () => {
    const form = `<form method="post" action="https://mypu.pu.edu.tw/index_redirect_mypu.php">
      <input type="hidden" name="sysID" value="score_query">
    </form>`;
    const requests = mockRequests((options, index) => {
      if (index === 0) return { html: form, headers: { 'set-cookie': ['SID=renewed; Path=/; Secure'] } };
      if (index === 1) return { html: '<p>已轉入 MyPU</p>', headers: { 'set-cookie': ['PHPSESSID=mypu; Path=/'] } };
      return { html: gradePage };
    });
    const result = await puFetchGrades({ SID: 'original' });
    expect(result.success).toBe(true);
    expect(requests.map(row => `${row.method || 'GET'} ${row.hostname}${row.path}`)).toEqual([
      'GET alcat.pu.edu.tw/index_chkLogin.php?link=index_ToNewPlt.php?sysID=score_query',
      'POST mypu.pu.edu.tw/index_redirect_mypu.php',
      'GET mypu.pu.edu.tw/score_query/score_all.php',
    ]);
    expect(requests[1].headers.Cookie).toBe('SID=renewed');
    expect(requests[2].headers.Cookie).toMatch(/SID=renewed/);
    expect(requests[2].headers.Cookie).toMatch(/PHPSESSID=mypu/);
    expect(requests.every(row => row.family === 4)).toBe(true);
  });

  test('resolves relative redirects against the actual current page', async () => {
    const requests = mockRequests((options, index) => {
      if (index === 0) return { status: 303, headers: { location: 'next.php', 'set-cookie': ['SID=next; Path=/'] } };
      if (index === 1) {
        return {
          html: `<form method="post" action="https://mypu.pu.edu.tw/index_redirect_mypu.php">
            <input type="hidden" name="sysID" value="score_query">
          </form>`,
        };
      }
      if (index === 2) return { html: '<p>已轉入 MyPU</p>' };
      return { html: gradePage };
    });
    const result = await puFetchGrades({ SID: 'original' });
    expect(result.success).toBe(true);
    expect(requests[1]).toMatchObject({ hostname: 'alcat.pu.edu.tw', path: '/next.php' });
    expect(requests[1].headers.Cookie).toBe('SID=next');
  });

  test.each([
    'https://unrelated.example/collect',
    'https://alcat.pu.edu.tw.attacker.example/collect',
    'https://alcat.pu.edu.tw:8443/collect',
    'https://name:secret@mypu.pu.edu.tw/collect',
  ])('does not send the session to an untrusted redirect: %s', async (location) => {
    const requests = mockRequests(() => ({ status: 302, headers: { location } }));
    const result = await puFetchCourses({ SID: 'original' });
    expect(result).toMatchObject({ success: false, courses: [], error: 'Untrusted campus redirect' });
    expect(requests).toHaveLength(1);
  });

  test('terminates a redirect loop instead of returning an empty successful result', async () => {
    const requests = mockRequests(() => ({ status: 308, headers: { location: '/loop' } }));
    const result = await puFetchCourses({ SID: 'original' });
    expect(result).toMatchObject({ success: false, error: 'Too many campus redirects' });
    expect(requests).toHaveLength(4);
  });

  test('times out a connection that never returns headers', async () => {
    jest.useFakeTimers();
    mockRequests(() => null);
    const pending = puFetchCourses({ SID: 'original' });
    await jest.advanceTimersByTimeAsync(10_000);
    await expect(pending).resolves.toMatchObject({ success: false, error: 'Campus request timed out' });
  });

  test('bounds HTML response size', async () => {
    mockRequests(() => ({ html: 'x'.repeat(4 * 1024 * 1024 + 1) }));
    await expect(puFetchCourses({ SID: 'original' })).resolves.toMatchObject({
      success: false, error: 'Campus response is too large',
    });
  });

  test('returns the final verified session cookie after student login', async () => {
    mockRequests((_options, index) => {
      if (index === 0) return { html: '<form></form>', headers: { 'set-cookie': ['SID=warmup; Path=/'] } };
      if (index === 1) return { html: '<p>登入</p>', headers: { 'set-cookie': ['SID=login; Path=/'] } };
      return {
        html: '<p>學號(Student No.)：412345678 姓名(Student Name)：林同學</p>',
        headers: { 'set-cookie': ['SID=verified; Path=/; Secure'] },
      };
    });
    const result = await puLogin('412345678', 'fixture-password');
    expect(result).toMatchObject({ success: true, cookies: { SID: 'verified' } });
  });

  test('preserves fractional course credits from the official source', async () => {
    mockRequests(() => ({ html: `<p>學號(Student No.)：412345678 學期總學分：2.5</p>
      <table><tr><th>選課代號 course code</th><th>班級</th><th>科目</th><th>修別</th><th>學分</th><th>時間</th><th>老師</th></tr>
      <tr><td>IM01</td><td>資管</td><td>微學分</td><td>選修</td><td>0.5</td><td>另行公告</td><td></td></tr></table>` }));
    const result = await puFetchCourses({ SID: 'original' });
    expect(result).toMatchObject({ success: true, totalCredits: 2.5, courses: [{ credits: 0.5 }] });
  });
});

describe('PU course document recognition', () => {
  const student = '<p>學號(Student No.)：412345678 姓名(Student Name)：林同學</p>';
  const header = '<tr><th>選課代號 course code</th><th>班級</th><th>科目</th><th>修別</th><th>學分</th><th>時間</th><th>老師</th></tr>';

  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  test.each([
    ['missing course table', '<p>課程查詢版面已更新</p>'],
    ['unrelated table', '<table><tr><td>service</td><td>class</td><td>status</td><td>type</td><td>3</td><td>time</td><td>contact</td></tr></table>'],
    ['truncated course row', `<table>${header}<tr><td>IM01</td><td>資管</td><td>資料庫</td></tr></table>`],
    ['unrecognizable credits', `<table>${header}<tr><td>IM01</td><td>資管</td><td>資料庫</td><td>必修</td><td>unknown</td><td>二 3</td><td></td></tr></table>`],
    ['empty message only in script', '<script>const emptyText = "本學期尚未選課";</script><p>課程查詢版面已更新</p>'],
  ])('fails closed for %s instead of inventing an empty timetable', async (_label, document) => {
    mockRequests(() => ({ html: student + document }));
    const result = await puFetchCourses({ SID: 'fixture-session' });
    expect(result).toMatchObject({ success: false, courses: [] });
    expect(result.code).toBeUndefined();
  });

  test.each([
    ['recognized table with zero rows', `<table>${header}</table>`],
    ['explicit empty row', `<table>${header}<tr><td colspan="7">本學期無選課資料</td></tr></table>`],
    ['explicit empty page', '<p>本學期尚未選課</p>'],
  ])('preserves a legitimate %s', async (_label, document) => {
    mockRequests(() => ({ html: student + document }));
    await expect(puFetchCourses({ SID: 'fixture-session' })).resolves.toMatchObject({
      success: true, courses: [],
    });
  });

  test('uses the recognized Chinese course header instead of an unrelated trailing table', async () => {
    mockRequests(() => ({ html: student + `<table>${header.replace(' course code', '')}
      <tr><td>IM01</td><td>資管</td><td>資料庫</td><td>必修</td><td>3</td><td>另行公告</td><td></td></tr></table>
      <table><tr><td>其他查詢</td></tr></table>` }));
    await expect(puFetchCourses({ SID: 'fixture-session' })).resolves.toMatchObject({
      success: true, courses: [{ code: 'IM01', name: '資料庫', credits: 3 }],
    });
  });
});

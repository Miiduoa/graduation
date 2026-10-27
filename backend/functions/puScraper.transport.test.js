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
    const requests = mockRequests((options, index) => {
      if (index === 0) return { html: '<p>校務轉接</p>', headers: { 'set-cookie': ['SID=renewed; Path=/; Secure'] } };
      if (index === 1) return { html: '<p>校務選單</p>' };
      return { html: gradePage };
    });
    const result = await puFetchGrades({ SID: 'original' });
    expect(result.success).toBe(true);
    expect(requests.map(row => row.hostname + row.path)).toEqual([
      'alcat.pu.edu.tw/score_query/score_all.php',
      'alcat.pu.edu.tw/index_menu.php',
      'mypu.pu.edu.tw/score_query/score_all.php',
    ]);
    expect(requests[1].headers.Cookie).toBe('SID=renewed');
    expect(requests[2].headers.Cookie).toBe('SID=renewed');
    expect(requests.every(row => row.family === 4)).toBe(true);
  });

  test('resolves relative redirects against the actual current page', async () => {
    const requests = mockRequests((options, index) => {
      if (index === 0) return { status: 303, headers: { location: 'next.php', 'set-cookie': ['SID=next; Path=/'] } };
      if (index === 1) return { html: gradePage };
      return { html: '<p>暫無其他資料</p>' };
    });
    const result = await puFetchGrades({ SID: 'original' });
    expect(result.success).toBe(true);
    expect(requests[1]).toMatchObject({ hostname: 'alcat.pu.edu.tw', path: '/score_query/next.php' });
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

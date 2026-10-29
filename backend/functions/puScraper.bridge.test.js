const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');
const https = require('https');
const {
  puFetchGrades,
  looksLikePuLoginPage,
  parseCampusAutoPostForm,
  SCORE_BRIDGE_PATH,
  GRADE_FETCH_BUDGET_MS,
  MAX_TRANSIENT_HOP_RETRIES,
} = require('./puScraper');

const FIXTURES = path.join(__dirname, 'fixtures');
const notLoggedInHtml = fs.readFileSync(path.join(FIXTURES, 'mypu-not-logged-in.html'), 'utf8');
const toNewPltHtml = fs.readFileSync(path.join(FIXTURES, 'alcat-tonewplt-score.html'), 'utf8');
const scoreAllHtml = fs.readFileSync(path.join(FIXTURES, 'mypu-score-all.html'), 'utf8');

function mockRequests(respond) {
  const requests = [];
  jest.spyOn(https, 'request').mockImplementation((options, callback) => {
    requests.push(options);
    const request = new EventEmitter();
    request.write = jest.fn();
    request.destroy = jest.fn();
    request.end = () => {
      const fixture = respond(options, requests.length - 1, request);
      if (!fixture) return;
      if (fixture.error) {
        const error = new Error(fixture.error.message || 'socket hang up');
        error.code = fixture.error.code || 'ECONNRESET';
        process.nextTick(() => request.emit('error', error));
        return;
      }
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

describe('PU mypu score SSO bridge', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  test('recognizes the depersonalized mypu login-expired snapshot', () => {
    expect(notLoggedInHtml).toContain('尚未登入');
    expect(notLoggedInHtml).toContain('已逾時');
    expect(notLoggedInHtml).not.toMatch(/s\d{7,}/);
    expect(looksLikePuLoginPage(notLoggedInHtml)).toBe(true);
    expect(looksLikePuLoginPage(toNewPltHtml)).toBe(false);
    expect(looksLikePuLoginPage(scoreAllHtml)).toBe(false);
    expect(looksLikePuLoginPage('<p>系統維護中，請稍後再試</p>')).toBe(false);
  });

  test('parses the auto-submit POST fields from the ToNewPlt snapshot', () => {
    const form = parseCampusAutoPostForm(toNewPltHtml, 'https://alcat.pu.edu.tw/index_ToNewPlt.php');
    expect(form?.action.href).toBe('https://mypu.pu.edu.tw/index_redirect_mypu.php');
    expect(form?.fields).toEqual({
      sysID: 'score_query',
      uid: 's0000000',
      chk: 'fixture-sso-token',
      from: 'alcat',
    });
  });

  test('does not POST the session to an unrelated form action', () => {
    const html = `<form method="post" action="https://evil.test/collect">
      <input type="hidden" name="sid" value="original">
    </form>`;
    expect(parseCampusAutoPostForm(html, 'https://alcat.pu.edu.tw/index_ToNewPlt.php')).toBeNull();
  });

  test('follows chkLogin → ToNewPlt POST → mypu score_all with the snapshot pages', async () => {
    const requests = mockRequests((options, index, request) => {
      if (index === 0) {
        return {
          status: 302,
          headers: { location: '/index_ToNewPlt.php?sysID=score_query' },
        };
      }
      if (index === 1) return { html: toNewPltHtml };
      if (index === 2) {
        expect(options.method).toBe('POST');
        expect(String(request.write.mock.calls[0]?.[0] || '')).toContain('sysID=score_query');
        expect(String(request.write.mock.calls[0]?.[0] || '')).toContain('uid=s0000000');
        return {
          status: 302,
          headers: {
            location: '/score_query/score_all.php',
            'set-cookie': ['PHPSESSID=mypu-fixture; Path=/'],
          },
        };
      }
      return { html: scoreAllHtml, headers: { 'set-cookie': ['PHPSESSID=mypu-fixture; Path=/'] } };
    });

    const result = await puFetchGrades({ SID: 'alcat-session' });
    expect(result.success).toBe(true);
    expect(result.grades).toHaveLength(2);
    expect(result.allSemesters).toEqual(expect.arrayContaining(['1151', '1142']));
    expect(requests.map((row) => `${row.method || 'GET'} ${row.hostname}${row.path}`)).toEqual([
      `GET alcat.pu.edu.tw${SCORE_BRIDGE_PATH}`,
      'GET alcat.pu.edu.tw/index_ToNewPlt.php?sysID=score_query',
      'POST mypu.pu.edu.tw/index_redirect_mypu.php',
      'GET mypu.pu.edu.tw/score_query/score_all.php',
    ]);
    expect(requests[3].headers.Cookie).toMatch(/PHPSESSID=mypu-fixture/);
    expect(requests[3].headers.Cookie || '').not.toMatch(/(?:^|;\s*)SID=/);
    expect(result.mypuCookies).toEqual({ PHPSESSID: 'mypu-fixture' });
  });

  test('reuses stored mypu cookies so two grade fetches only bridge once', async () => {
    const requests = mockRequests((options) => {
      const hostPath = `${options.hostname}${options.path}`;
      if (hostPath.includes('index_chkLogin')) {
        return { status: 302, headers: { location: '/index_ToNewPlt.php?sysID=score_query' } };
      }
      if (hostPath.includes('index_ToNewPlt')) return { html: toNewPltHtml };
      if (hostPath.includes('index_redirect_mypu')) {
        return {
          status: 302,
          headers: {
            location: '/score_query/score_all.php',
            'set-cookie': ['PHPSESSID=mypu-live; Path=/'],
          },
        };
      }
      return { html: scoreAllHtml, headers: { 'set-cookie': ['PHPSESSID=mypu-live; Path=/'] } };
    });

    const first = await puFetchGrades({ SID: 'alcat-session' });
    expect(first.success).toBe(true);
    expect(first.mypuCookies).toEqual({ PHPSESSID: 'mypu-live' });
    const second = await puFetchGrades({ SID: 'alcat-session' }, '', {
      mypuCookies: first.mypuCookies,
    });
    expect(second.success).toBe(true);
    expect(second.grades).toHaveLength(2);
    expect(requests.filter((row) => String(row.path).includes('index_chkLogin'))).toHaveLength(1);
    expect(requests.filter((row) => String(row.path).includes('index_redirect_mypu'))).toHaveLength(1);
    expect(requests.filter((row) => String(row.path).includes('score_all.php')).length).toBeGreaterThan(1);
  });

  test('re-bridges once when stored mypu cookies return the not-logged-in page', async () => {
    let scoreGets = 0;
    const requests = mockRequests((options) => {
      const hostPath = `${options.hostname}${options.path}`;
      if (hostPath.includes('score_all.php')) {
        scoreGets += 1;
        if (scoreGets === 1) return { html: notLoggedInHtml };
        return { html: scoreAllHtml, headers: { 'set-cookie': ['PHPSESSID=mypu-refreshed; Path=/'] } };
      }
      if (hostPath.includes('index_chkLogin') || hostPath.includes('index_ToNewPlt')) {
        return { html: toNewPltHtml };
      }
      if (hostPath.includes('index_redirect_mypu')) {
        return {
          html: '<p>轉接完成</p>',
          headers: { 'set-cookie': ['PHPSESSID=mypu-refreshed; Path=/'] },
        };
      }
      return { html: scoreAllHtml };
    });
    const result = await puFetchGrades({ SID: 'alcat-session' }, '', {
      mypuCookies: { PHPSESSID: 'stale-mypu' },
    });
    expect(result.success).toBe(true);
    expect(result.mypuCookies).toEqual({ PHPSESSID: 'mypu-refreshed' });
    expect(requests.filter((row) => String(row.path).includes('index_chkLogin'))).toHaveLength(1);
  });

  test('retries a transient chkLogin hop without treating it as an expired session', async () => {
    let chkLogin = 0;
    mockRequests((options) => {
      const hostPath = `${options.hostname}${options.path}`;
      if (hostPath.includes('index_chkLogin')) {
        chkLogin += 1;
        if (chkLogin === 1) return { error: { code: 'ECONNRESET', message: 'socket hang up' } };
        return { html: toNewPltHtml };
      }
      if (hostPath.includes('index_redirect_mypu')) {
        return {
          status: 302,
          headers: {
            location: '/score_query/score_all.php',
            'set-cookie': ['PHPSESSID=mypu-retried; Path=/'],
          },
        };
      }
      return { html: scoreAllHtml, headers: { 'set-cookie': ['PHPSESSID=mypu-retried; Path=/'] } };
    });
    const result = await puFetchGrades({ SID: 'alcat-session' });
    expect(result.success).toBe(true);
    expect(result.mypuCookies).toEqual({ PHPSESSID: 'mypu-retried' });
    expect(chkLogin).toBe(2);
  });

  test('does not report session-expired when the score bridge keeps resetting', async () => {
    const requests = mockRequests(() => ({
      error: { code: 'ECONNRESET', message: 'socket hang up' },
    }));
    const result = await puFetchGrades({ SID: 'alcat-session' });
    expect(result).toMatchObject({ success: false, grades: [] });
    expect(result.code).not.toBe('session-expired');
    expect(requests.filter((row) => String(row.path).includes('index_chkLogin')).length).toBe(3);
    expect(JSON.stringify(result)).not.toMatch(/alcat-session|SID|PHPSESSID|ECONNRESET/);
  });

  test('counts mypu hop retries toward the grade fetch budget', async () => {
    const started = 1_700_000_000_000;
    let now = started;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const requests = mockRequests(() => {
      now += 20_000;
      return { error: { code: 'ECONNRESET', message: 'socket hang up' } };
    });
    const result = await puFetchGrades({ SID: 'alcat-session' });
    expect(result).toMatchObject({ success: false, grades: [] });
    expect(result.code).not.toBe('session-expired');
    const chkLogin = requests.filter((row) => String(row.path).includes('index_chkLogin')).length;
    expect(chkLogin).toBeGreaterThan(0);
    expect(chkLogin).toBeLessThan(1 + MAX_TRANSIENT_HOP_RETRIES);
    expect(now - started).toBeLessThanOrEqual(GRADE_FETCH_BUDGET_MS);
    expect(JSON.stringify(result)).not.toMatch(/alcat-session|SID|PHPSESSID|ECONNRESET/);
  });

  test('reports session-expired when mypu returns the not-logged-in snapshot', async () => {
    mockRequests((options, index) => {
      if (index === 0) return { html: toNewPltHtml };
      if (index === 1) return { html: '<p>轉接完成</p>', headers: { 'set-cookie': ['PHPSESSID=dead; Path=/'] } };
      return { html: notLoggedInHtml };
    });
    await expect(puFetchGrades({ SID: 'stale' })).resolves.toMatchObject({
      success: false,
      code: 'session-expired',
      grades: [],
    });
  });
});

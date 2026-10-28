const { EventEmitter } = require('events');
const https = require('https');
const { puFetchCreditOverview } = require('./puScraper');

const overview = '<table><tr><th>修習學分累計</th></tr><tr><td>【必修】：30.5學分 【選修】：8學分 【小計】：38.5 【畢業應修總學分】：128</td></tr></table>';

function mockRequests(respond) {
  const requests = [];
  const handles = [];
  jest.spyOn(https, 'request').mockImplementation((options, callback) => {
    const index = requests.length;
    requests.push(options);
    const request = new EventEmitter();
    request.write = jest.fn();
    request.destroy = jest.fn();
    request.end = () => {
      const fixture = respond(options, index);
      if (!fixture) return;
      const deliver = () => {
        if (fixture.error) { request.emit('error', new Error(fixture.error)); return; }
        const response = new EventEmitter();
        response.headers = fixture.headers || {};
        response.statusCode = fixture.status || 200;
        callback(response);
        if (fixture.abort) { response.emit('aborted'); return; }
        response.emit('data', Buffer.from(fixture.html || ''));
        response.emit('end');
      };
      if (fixture.delayMs) setTimeout(deliver, fixture.delayMs);
      else deliver();
    };
    handles.push(request);
    return request;
  });
  return { requests, handles };
}

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe('bounded school credit-overview fetch', () => {
  test('fetches only the fixed overview with the existing cookie and IPv4 transport', async () => {
    const { requests } = mockRequests(() => ({ html: overview, headers: { 'content-type': 'text/html; charset=UTF-8' } }));
    const result = await puFetchCreditOverview({ SID: 'fixture-secret' });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ hostname: 'alcat.pu.edu.tw', path: '/grade_review/tab_1.php', method: 'GET', family: 4 });
    expect(requests[0].headers.Cookie).toBe('SID=fixture-secret');
    expect(result).toMatchObject({ success: true, creditOverview: {
      version: 1, source: 'pu-credit-review', totals: { required: 30.5, subtotal: 38.5, totalRequired: 128 },
      coverage: { status: 'partial' },
    } });
    expect(JSON.stringify(result)).not.toMatch(/fixture-secret|cookies|sessionId|html|studentId/);
  });

  test('follows one relative trusted redirect and carries its rotated cookie', async () => {
    const { requests } = mockRequests((_options, index) => index === 0
      ? { status: 302, headers: { location: 'tab_1.php?view=overview', 'set-cookie': ['SID=rotated; Path=/; Secure'] } }
      : { html: overview });
    expect((await puFetchCreditOverview({ SID: 'original' })).success).toBe(true);
    expect(requests).toHaveLength(2);
    expect(requests[1]).toMatchObject({ hostname: 'alcat.pu.edu.tw', path: '/grade_review/tab_1.php?view=overview', family: 4 });
    expect(requests[1].headers.Cookie).toBe('SID=rotated');
  });

  test('does not perform a third request when a second redirect is returned', async () => {
    const { requests } = mockRequests(() => ({ status: 302, headers: { location: '/grade_review/tab_1.php' } }));
    expect(await puFetchCreditOverview({ SID: 'fixture' })).toMatchObject({ success: false, code: 'unavailable', creditOverview: null });
    expect(requests).toHaveLength(2);
  });

  test.each([
    'https://unrelated.example/collect',
    'https://alcat.pu.edu.tw.attacker.example/collect',
    'https://alcat.pu.edu.tw:8443/collect',
    'https://name:secret@mypu.pu.edu.tw/collect',
    'ftp://alcat.pu.edu.tw/grade_review/tab_1.php',
    '//unrelated.example/collect',
  ])('does not forward credentials to an untrusted redirect: %s', async location => {
    const { requests } = mockRequests(() => ({ status: 302, headers: { location } }));
    const result = await puFetchCreditOverview({ SID: 'fixture-secret' });
    expect(result).toMatchObject({ success: false, code: 'unavailable', creditOverview: null });
    expect(requests).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain(location);
  });

  test.each([undefined, null, {}, [], 'SID=fixture'])('does not send a request for an absent or invalid cookie jar', async cookies => {
    const { requests } = mockRequests(() => ({ html: overview }));
    expect(await puFetchCreditOverview(cookies)).toMatchObject({ success: false, code: 'session-expired', creditOverview: null });
    expect(requests).toHaveLength(0);
  });

  test.each([401, 403])('reports the session as expired for HTTP %s', async status => {
    mockRequests(() => ({ status, html: overview }));
    expect(await puFetchCreditOverview({ SID: 'fixture' })).toMatchObject({ success: false, code: 'session-expired', creditOverview: null });
  });

  test('recognizes a redirected login form without using its stale academic markup', async () => {
    mockRequests((_options, index) => index === 0
      ? { status: 302, headers: { location: '/login.php' } }
      : { html: '<form action="/index_check.php"><input type="password"></form>' + overview });
    expect(await puFetchCreditOverview({ SID: 'fixture' })).toMatchObject({ success: false, code: 'session-expired', creditOverview: null });
  });

  test.each([
    ['HTTP failure', { status: 503, html: overview }],
    ['removed endpoint', { status: 404 }],
    ['missing redirect location', { status: 302 }],
    ['different document format', { html: overview, headers: { 'content-type': 'application/json' } }],
    ['unknown HTML', { html: '<h1>新版服務</h1>' }],
    ['maintenance', { html: '<h1>系統維護中</h1>' + overview }],
    ['truncated stream', { abort: true }],
    ['transport error', { error: 'network failed SID=fixture-secret' }],
  ])('keeps %s distinct from a successful zero-credit response', async (_name, fixture) => {
    mockRequests(() => fixture);
    const result = await puFetchCreditOverview({ SID: 'fixture-secret' });
    expect(result).toMatchObject({ success: false, code: 'unavailable', creditOverview: null });
    expect(JSON.stringify(result)).not.toMatch(/fixture-secret|network failed/);
  });

  test('limits an unresponsive connection to ten seconds', async () => {
    jest.useFakeTimers();
    const { requests, handles } = mockRequests(() => null);
    const pending = puFetchCreditOverview({ SID: 'fixture' });
    await jest.advanceTimersByTimeAsync(10_000);
    expect(await pending).toMatchObject({ success: false, code: 'unavailable' });
    expect(requests).toHaveLength(1);
    expect(handles[0].destroy).toHaveBeenCalledTimes(1);
  });

  test('bounds the whole single-redirect fetch by two request deadlines', async () => {
    jest.useFakeTimers();
    const { requests, handles } = mockRequests((_options, index) => index === 0
      ? { delayMs: 9_000, status: 302, headers: { location: 'tab_1.php?view=overview' } }
      : null);
    const start = Date.now();
    const pending = puFetchCreditOverview({ SID: 'fixture' });
    await jest.advanceTimersByTimeAsync(19_000);
    expect(await pending).toMatchObject({ success: false, code: 'unavailable' });
    expect(Date.now() - start).toBe(19_000);
    expect(requests).toHaveLength(2);
    expect(handles[1].destroy).toHaveBeenCalledTimes(1);
  });

  test('does not restart reading when headers arrive after the deadline', async () => {
    jest.useFakeTimers();
    const { requests } = mockRequests(() => ({ delayMs: 11_000, status: 302, headers: { location: 'late.php' } }));
    const pending = puFetchCreditOverview({ SID: 'fixture' });
    await jest.advanceTimersByTimeAsync(10_000);
    expect(await pending).toMatchObject({ success: false, code: 'unavailable' });
    await jest.advanceTimersByTimeAsync(2_000);
    expect(requests).toHaveLength(1);
  });

  test('rejects an oversized response before parsing', async () => {
    const { handles } = mockRequests(() => ({ html: 'x'.repeat(4 * 1024 * 1024 + 1) }));
    expect(await puFetchCreditOverview({ SID: 'fixture' })).toMatchObject({ success: false, code: 'unavailable', creditOverview: null });
    expect(handles[0].destroy).toHaveBeenCalledTimes(1);
  });
});

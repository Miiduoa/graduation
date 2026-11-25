const { EventEmitter } = require('events');

jest.mock('https', () => ({ request: jest.fn() }));
const https = require('https');
const { tcFetchCoursePageForAuthorization, setCampusHttpFetch } = require('./tronClassScraper');

const html = '<!doctype html><input type="hidden" id="courseId" value="123">' +
  '<input type="hidden" id="enrollment-is-student" value="True">';

function respond({ status = 200, body = html, headers = { 'content-type': 'text/html; charset=utf-8' } } = {}) {
  https.request.mockImplementationOnce((options, callback) => {
    const request = new EventEmitter();
    request.destroy = jest.fn();
    request.end = jest.fn(() => {
      const response = new EventEmitter();
      response.statusCode = status;
      response.headers = headers;
      callback(response);
      process.nextTick(() => {
        response.emit('data', Buffer.from(body));
        response.emit('end');
      });
    });
    return request;
  });
}

beforeEach(() => {
  https.request.mockReset();
  setCampusHttpFetch(null);
});
afterEach(() => {
  jest.useRealTimers();
  setCampusHttpFetch(null);
});

test('reads only the fixed course page with the server binding cookies', async () => {
  respond({ headers: { 'content-type': 'text/html; charset=utf-8', 'content-length': String(Buffer.byteLength(html)) } });
  await expect(tcFetchCoursePageForAuthorization({ session: 'synthetic-cookie' }, 123)).resolves.toBe(html);
  expect(https.request).toHaveBeenCalledTimes(1);
  expect(https.request.mock.calls[0][0]).toMatchObject({
    hostname: 'tronclass.pu.edu.tw', path: '/course/123', method: 'GET',
    headers: { Cookie: 'session=synthetic-cookie', Accept: 'text/html', 'Accept-Encoding': 'identity' },
  });
});

test.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '123', '../profile', null])(
  'does not build a course URL from invalid ID %p', async id => {
    await expect(tcFetchCoursePageForAuthorization({}, id)).rejects.toMatchObject({ status: 400 });
    expect(https.request).not.toHaveBeenCalled();
  },
);

test.each([301, 302, 303, 307, 308, 401, 403, 404, 500])(
  'rejects HTTP %s without following redirects or retrying', async status => {
    respond({ status, headers: { 'content-type': 'text/html', location: 'https://identity.pu.edu.tw/login' } });
    await expect(tcFetchCoursePageForAuthorization({}, 123)).rejects.toMatchObject({ status });
    expect(https.request).toHaveBeenCalledTimes(1);
  },
);

test.each([
  {}, { 'content-type': 'application/json' }, { 'content-type': 'text/plain' },
  { 'content-type': ['text/html'] },
  { 'content-type': 'text/html', 'content-encoding': 'gzip' },
  { 'content-type': 'text/html', 'content-length': '0' },
  { 'content-type': 'text/html', 'content-length': 'invalid' },
  { 'content-type': 'text/html', 'content-length': ['123'] },
])('rejects non-HTML or inconsistent response headers %p', async headers => {
  respond({ headers });
  await expect(tcFetchCoursePageForAuthorization({}, 123))
    .rejects.toMatchObject({ code: 'TC_COURSE_CONTEXT_INVALID', status: 502 });
  expect(https.request).toHaveBeenCalledTimes(1);
});

test('rejects an empty HTML page', async () => {
  respond({ body: '  ' });
  await expect(tcFetchCoursePageForAuthorization({}, 123))
    .rejects.toMatchObject({ code: 'TC_COURSE_CONTEXT_INVALID', status: 502 });
});

test('destroys the request as soon as its HTML exceeds the byte limit', async () => {
  respond({ body: 'x'.repeat(2 * 1024 * 1024 + 1) });
  await expect(tcFetchCoursePageForAuthorization({}, 123)).rejects.toThrow('too large');
  expect(https.request.mock.results[0].value.destroy).toHaveBeenCalledTimes(1);
});

test('does not start a page request after caller cancellation', async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(tcFetchCoursePageForAuthorization({}, 123, { signal: controller.signal }))
    .rejects.toMatchObject({ code: 'ABORT_ERR' });
  expect(https.request).not.toHaveBeenCalled();
});

test('bounds a hanging page request by the caller budget and never retries it', async () => {
  jest.useFakeTimers();
  https.request.mockImplementation(() => {
    const request = new EventEmitter();
    request.end = jest.fn();
    request.destroy = jest.fn();
    return request;
  });
  const pending = expect(tcFetchCoursePageForAuthorization({}, 123, { timeoutMs: 35 })).rejects.toThrow('timed out');
  await jest.advanceTimersByTimeAsync(35);
  await pending;
  expect(https.request).toHaveBeenCalledTimes(1);
  expect(https.request.mock.results[0].value.destroy).toHaveBeenCalledTimes(1);
});

test('forwards caller cancellation through the configured relay', async () => {
  const controller = new AbortController();
  const relay = jest.fn((_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
    queueMicrotask(() => controller.abort());
  }));
  setCampusHttpFetch(relay);
  await expect(tcFetchCoursePageForAuthorization({}, 123, { signal: controller.signal })).rejects.toThrow();
  expect(relay).toHaveBeenCalledTimes(1);
  expect(https.request).not.toHaveBeenCalled();
});

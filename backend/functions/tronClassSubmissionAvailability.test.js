const { EventEmitter } = require('events');
jest.mock('https', () => ({ request: jest.fn() }));
const https = require('https');
const {
  tcFetchStudentMakeUpHomeworkRecord, tcFetchStudentResubmitHomeworkRecord, setCampusHttpFetch,
} = require('./tronClassScraper');

function respond({ status = 200, body = '{}', headers = {} } = {}) {
  https.request.mockImplementationOnce((options, callback) => {
    const request = new EventEmitter();
    request.destroy = jest.fn();
    request.write = jest.fn();
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
beforeEach(() => { https.request.mockReset(); setCampusHttpFetch(null); });
afterEach(() => { jest.useRealTimers(); setCampusHttpFetch(null); });

describe.each([
  ['make-up', 'make_up_record', tcFetchStudentMakeUpHomeworkRecord],
  ['resubmit', 'resubmit_record', tcFetchStudentResubmitHomeworkRecord],
])('fixed individual %s record read', (path, key, read) => {
  test('uses one bounded GET, preserves the envelope and writes no request body', async () => {
    const raw = { [key]: { has_submitted: false, user_id: 303, homework_id: 202 } };
    respond({ body: JSON.stringify(raw) });
    await expect(read({ session: 'synthetic-private-cookie' }, 202, 303)).resolves.toEqual(raw);
    expect(https.request).toHaveBeenCalledTimes(1);
    expect(https.request.mock.calls[0][0]).toMatchObject({
      hostname: 'tronclass.pu.edu.tw', method: 'GET',
      path: `/api/homework/202/students/303/${path}-record`,
      headers: { Cookie: 'session=synthetic-private-cookie', Accept: 'application/json' },
    });
    expect(https.request.mock.results[0].value.write).not.toHaveBeenCalled();
  });

  test('preserves explicit null instead of inventing a record', async () => {
    respond({ body: JSON.stringify({ [key]: null }) });
    await expect(read({}, 202, 303)).resolves.toEqual({ [key]: null });
  });

  test.each([{}, { [key]: [] }, { [key]: false }, { [key]: '' }, { data: { [key]: null } }])(
    'does not convert an invalid or missing envelope into no special permission: %p', async raw => {
      respond({ body: JSON.stringify(raw) });
      await expect(read({}, 202, 303)).rejects.toMatchObject({ code: 'TC_HOMEWORK_RESPONSE_INVALID', status: 502 });
      expect(https.request).toHaveBeenCalledTimes(1);
    },
  );

  test.each([0, '303', '../profile', Number.MAX_SAFE_INTEGER + 1])('rejects an unsafe selector before reading: %p', async value => {
    await expect(read({}, 202, value)).rejects.toMatchObject({ code: 'TC_HOMEWORK_INVALID_ID', status: 400 });
    await expect(read({}, value, 303)).rejects.toMatchObject({ code: 'TC_HOMEWORK_INVALID_ID', status: 400 });
    expect(https.request).not.toHaveBeenCalled();
  });

  test.each([302, 401, 403, 404, 503])('does not follow a redirect or probe after HTTP %s', async status => {
    respond({ status, headers: { location: 'https://untrusted.test' } });
    await expect(read({}, 202, 303)).rejects.toThrow();
    expect(https.request).toHaveBeenCalledTimes(1);
  });

  test('does not expose source text in malformed JSON errors', async () => {
    respond({ body: '{"private-student-record":' });
    await expect(read({}, 202, 303)).rejects.toMatchObject({
      code: 'TC_HOMEWORK_RESPONSE_INVALID', message: 'TC_HOMEWORK_RESPONSE_INVALID', status: 502,
    });
  });

  test('honors a cancelled caller before issuing any request', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(read({}, 202, 303, { signal: controller.signal })).rejects.toMatchObject({ code: 'ABORT_ERR' });
    expect(https.request).not.toHaveBeenCalled();
  });

  test('does not return a partial record when the source exceeds the byte bound', async () => {
    respond({ body: 'x'.repeat(1024 * 1024 + 1) });
    await expect(read({}, 202, 303)).rejects.toThrow('response is too large');
    expect(https.request.mock.results[0].value.destroy).toHaveBeenCalledTimes(1);
  });
});

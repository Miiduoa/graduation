const { EventEmitter } = require('events');

jest.mock('https', () => ({
  request: jest.fn(),
}));

const https = require('https');
const {
  tcFetchCourses,
  tcFetchProfile,
  tcFetchIdentityProfile,
  tcFetchHomeworkActivitiesPage,
  tcFetchActivitiesRaw,
  tcFetchCourseAnnouncementsStrict,
  tcFetchAnnouncementsStrict,
  tcFetchHomeworkActivityStrict,
  tcFetchStudentHomeworkSubmissionList,
  setCampusHttpFetch,
} = require('./tronClassScraper');

function mockHttpsResponse({ status = 200, headers = {}, body = '{}', delayMs, afterEnd }) {
  https.request.mockImplementationOnce((options, callback) => {
    const req = new EventEmitter();
    req.write = jest.fn();
    req.destroy = jest.fn();
    req.end = jest.fn(() => {
      const res = new EventEmitter();
      res.statusCode = status;
      res.headers = headers;
      callback(res);
      const respond = () => {
        res.emit('data', Buffer.from(body));
        res.emit('end');
        afterEnd?.();
      };
      if (delayMs === undefined) process.nextTick(respond);
      else setTimeout(respond, delayMs);
    });
    return req;
  });
}

describe('tronClassScraper', () => {
  beforeEach(() => {
    https.request.mockReset();
    setCampusHttpFetch(null);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
    setCampusHttpFetch(null);
  });

  test('fetches courses through current my-courses endpoint first', async () => {
    mockHttpsResponse({
      body: JSON.stringify({
        courses: [
          {
            id: 123,
            name: '資料結構',
            course_code: 'CS101',
            department: { id: 7, name: '資工系' },
            instructors: [{ id: 1, name: '王老師' }],
            credit: '3',
            course_attributes: { student_count: 42 },
            role: 'student',
          },
        ],
        paging: { pages: 1 },
      }),
    });

    const courses = await tcFetchCourses({ session: 'cookie' });

    expect(https.request).toHaveBeenCalledTimes(1);
    expect(https.request.mock.calls[0][0]).toMatchObject({
      method: 'POST',
      path: '/api/my-courses',
    });
    expect(courses[0]).toMatchObject({
      id: 123,
      name: '資料結構',
      course_code: 'CS101',
      department_name: '資工系',
      credit: 3,
      student_count: 42,
      role: 'student',
    });
  });

  test('treats unauthorized profile responses as expired TronClass sessions', async () => {
    mockHttpsResponse({
      status: 401,
      body: JSON.stringify({ message: '' }),
    });

    await expect(tcFetchProfile({ session: 'expired' })).rejects.toThrow(
      'TronClass session 已失效，請重新登入',
    );
  });

  test('reads fresh identity proof and preserves profile cookie rotation for linking', async () => {
    const profile = { id: 57, login_name: 's411234567' };
    mockHttpsResponse({
      body: JSON.stringify(profile),
      headers: { 'set-cookie': ['session=rotated; Secure; HttpOnly'] },
    });
    await expect(tcFetchIdentityProfile({ session: 'old', other: 'retained' })).resolves.toEqual({
      profile, cookies: { session: 'rotated', other: 'retained' },
    });
    expect(https.request.mock.calls[0][0]).toMatchObject({
      hostname: 'tronclass.pu.edu.tw', path: '/api/profile', method: 'GET',
    });
  });

  test.each([302, 401, 403, 404, 503])('never fabricates identity proof after profile HTTP %s', async (status) => {
    mockHttpsResponse({ status });
    await expect(tcFetchIdentityProfile({ session: 'cookie' })).rejects.toThrow();
    expect(https.request).toHaveBeenCalledTimes(1);
  });

  test('bounds a nonresponding identity check without attempting an HTML fallback', async () => {
    jest.useFakeTimers();
    https.request.mockImplementation(() => {
      const req = new EventEmitter();
      req.end = jest.fn();
      req.destroy = jest.fn();
      return req;
    });
    const pending = expect(tcFetchIdentityProfile({ session: 'cookie' })).rejects.toThrow('timed out');
    await jest.advanceTimersByTimeAsync(8000);
    await pending;
    expect(https.request).toHaveBeenCalledTimes(1);
    expect(https.request.mock.results[0].value.destroy).toHaveBeenCalledTimes(1);
  });

  test('accepts a verified empty course list without making a second account lookup', async () => {
    mockHttpsResponse({ body: JSON.stringify({ courses: [], paging: { pages: 0 } }) });
    await expect(tcFetchCourses({ session: 'cookie' })).resolves.toEqual([]);
    expect(https.request).toHaveBeenCalledTimes(1);
  });

  test.each([
    {}, { courses: null }, { courses: {} },
    { courses: [null] }, { courses: [{ id: 1 }] },
    { courses: [{ id: '../other', name: '課程' }] },
    { courses: [{ id: 1, name: '課程' }], pages: 1_000_000 },
    { courses: [{ id: 1, name: '課程' }], pages: -1 },
    { courses: [{ id: 1, name: '課程' }], pages: 1.5 },
    { courses: [], pages: 2 },
  ])('rejects malformed or incomplete course responses instead of displaying no courses: %j', async (response) => {
    mockHttpsResponse({ body: JSON.stringify(response) });
    await expect(tcFetchCourses({ session: 'cookie' }, { userId: 1 })).rejects.toMatchObject({ code: 'TC_COURSES_INVALID' });
    expect(https.request).toHaveBeenCalledTimes(1);
  });

  test('loads all explicitly declared pages, including a numeric string page count', async () => {
    mockHttpsResponse({ body: JSON.stringify({ courses: [{ id: 1, name: '課程一' }], paging: { pages: '2' } }) });
    mockHttpsResponse({ body: JSON.stringify({ courses: [{ id: 2, name: '課程二' }], paging: { pages: '2' } }) });
    const courses = await tcFetchCourses({ session: 'cookie' });
    expect(courses.map(course => course.id)).toEqual([1, 2]);
    const secondBody = https.request.mock.results[1].value.write.mock.calls[0][0].toString();
    expect(JSON.parse(secondBody)).toMatchObject({ page: 2, page_size: 50 });
  });

  test('does not truncate at the first full page when pagination metadata is absent', async () => {
    mockHttpsResponse({ body: JSON.stringify({ courses: Array.from({ length: 50 }, (_, i) => ({ id: i + 1, name: `課程${i + 1}` })) }) });
    mockHttpsResponse({ body: JSON.stringify({ courses: [{ id: 51, name: '課程51' }] }) });
    const courses = await tcFetchCourses({ session: 'cookie' });
    expect(courses).toHaveLength(51);
    expect(https.request).toHaveBeenCalledTimes(2);
  });

  test('rejects a server repeating a page instead of accumulating duplicate courses', async () => {
    const page = JSON.stringify({ courses: [{ id: 1, name: '課程' }], pages: 2 });
    mockHttpsResponse({ body: page });
    mockHttpsResponse({ body: page });
    await expect(tcFetchCourses({ session: 'cookie' })).rejects.toThrow('repeated course page');
    expect(https.request).toHaveBeenCalledTimes(2);
  });

  test('uses the same validation on the legacy course endpoint', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockHttpsResponse({ status: 404 });
    mockHttpsResponse({ body: JSON.stringify({ courses: [{ id: 3, name: '舊版課程', credit: '0' }], pages: 1 }) });
    const courses = await tcFetchCourses({ session: 'cookie' }, { userId: 9, status: 'upcoming' });
    expect(courses[0]).toMatchObject({ id: 3, credit: 0 });
    const requested = new URL(https.request.mock.calls[1][0].path, 'https://tronclass.pu.edu.tw');
    expect(requested.pathname).toBe('/api/users/9/courses');
    expect(JSON.parse(requested.searchParams.get('conditions'))).toEqual({ status: ['notStarted'] });
  });

  test('rejects malformed legacy data instead of falling back to an empty course list', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockHttpsResponse({ status: 404 });
    mockHttpsResponse({ body: JSON.stringify({ message: 'temporarily unavailable' }) });
    await expect(tcFetchCourses({ session: 'cookie' }, { userId: 9 })).rejects.toMatchObject({ code: 'TC_COURSES_INVALID' });
  });

  test('preserves zero and fractional credits without coercing invalid values', async () => {
    const credits = ['0', 0, '0.5', '', '3units', -1, null];
    mockHttpsResponse({ body: JSON.stringify({ courses: credits.map((credit, i) => ({ id: i + 1, name: '課程', credit })), pages: 1 }) });
    const courses = await tcFetchCourses({ session: 'cookie' });
    expect(courses.map(course => course.credit)).toEqual([0, 0, 0.5, null, null, null, null]);
  });

  test('bounds a nonresponding course read and its legacy fallback', async () => {
    jest.useFakeTimers();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    https.request.mockImplementation(() => {
      const req = new EventEmitter();
      req.write = jest.fn();
      req.end = jest.fn();
      req.destroy = jest.fn();
      return req;
    });
    const pending = expect(tcFetchCourses({ session: 'cookie' }, { userId: 9 })).rejects.toThrow('timed out');
    await jest.advanceTimersByTimeAsync(16_000);
    await pending;
    expect(https.request).toHaveBeenCalledTimes(2);
  });

  test('reads a homework page without inventing rows', async () => {
    mockHttpsResponse({
      body: JSON.stringify({
        homework_activities: [{ id: 20001, title: '期末專題提案', submitted: false }],
        total: 1,
        page: 1,
        page_size: 50,
      }),
    });
    await expect(tcFetchHomeworkActivitiesPage({ session: 'cookie' }, 10001, 1)).resolves.toMatchObject({
      total: 1,
      homework_activities: [{ id: 20001, title: '期末專題提案', submitted: false }],
    });
    expect(https.request.mock.calls[0][0].path).toBe('/api/courses/10001/homework-activities?page=1&page_size=50');
  });

  test.each([false, true, [], [1], {}, '', ' ', '1e2', '0x10', '-1', '1.5', 'invalid', -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects malformed homework totals instead of converting a short page into a complete list: %p', async total => {
      mockHttpsResponse({ body: JSON.stringify({ homework_activities: [], total }) });
      await expect(tcFetchHomeworkActivitiesPage({}, 10001, 1)).rejects.toMatchObject({
        code: 'TC_HOMEWORK_RESPONSE_INVALID', status: 502,
      });
      expect(https.request).toHaveBeenCalledTimes(1);
    },
  );

  test.each([
    { page: 2 }, { page: '2' }, { page: 0 }, { page: [1] }, { page: true },
    { page_size: 20 }, { page_size: '20' }, { page_size: false }, { page_size: [50] },
  ])('rejects mismatched homework page metadata before returning its rows: %p', async metadata => {
    mockHttpsResponse({ body: JSON.stringify({ homework_activities: [{ id: 20001 }], total: 1, ...metadata }) });
    await expect(tcFetchHomeworkActivitiesPage({}, 10001, 1)).rejects.toMatchObject({
      code: 'TC_HOMEWORK_RESPONSE_INVALID', status: 502,
    });
    expect(https.request).toHaveBeenCalledTimes(1);
  });

  test.each([
    { homework_activities: [{ id: 20001 }], total: 0 },
    { homework_activities: Array.from({ length: 51 }, (_, index) => ({ id: 20001 + index })), total: 51 },
  ])('rejects contradictory or oversized homework pages: %p', async response => {
    mockHttpsResponse({ body: JSON.stringify(response) });
    await expect(tcFetchHomeworkActivitiesPage({}, 10001, 1)).rejects.toMatchObject({
      code: 'TC_HOMEWORK_RESPONSE_INVALID', status: 502,
    });
  });

  test.each([
    [{ total: '1', page: '1', page_size: '50' }, 1],
    [{ total: 1, page: 1, page_size: 50 }, 1],
    [{}, null],
    [{ total: null, page: null, page_size: null }, null],
  ])('preserves supported numeric and absent homework pagination metadata: %p', async (metadata, total) => {
    const homework = [{ id: 20001, title: '期末專題提案', submitted: false }];
    mockHttpsResponse({ body: JSON.stringify({ homework_activities: homework, ...metadata }) });
    await expect(tcFetchHomeworkActivitiesPage({}, 10001, 1)).resolves.toEqual({
      homework_activities: homework, total, page: 1, page_size: 50,
    });
  });

  test.each([0, '0'])('preserves an explicit empty homework list with total %p', async total => {
    mockHttpsResponse({ body: JSON.stringify({ homework_activities: [], total }) });
    await expect(tcFetchHomeworkActivitiesPage({}, 10001, 1)).resolves.toMatchObject({
      homework_activities: [], total: 0,
    });
  });

  test('keeps school 500 on homework instead of returning an empty list', async () => {
    mockHttpsResponse({ status: 500, body: '{}' });
    await expect(tcFetchHomeworkActivitiesPage({ session: 'cookie' }, 10001, 1)).rejects.toMatchObject({
      status: 500,
    });
  });

  describe('caller cancellation and read budgets', () => {
    const reads = [
      ['courses', options => tcFetchCourses({}, { userId: 9 }, options)],
      ['homework page', options => tcFetchHomeworkActivitiesPage({}, 10001, 1, 50, options)],
      ['activity', options => tcFetchHomeworkActivityStrict({}, 20001, options)],
      ['student history', options => tcFetchStudentHomeworkSubmissionList({}, 20001, 123, options)],
      ['course activities', options => tcFetchActivitiesRaw({}, 10001, '', options)],
      ['course announcements', options => tcFetchCourseAnnouncementsStrict({}, 10001, options)],
      ['site announcements', options => tcFetchAnnouncementsStrict({}, options)],
    ];

    test.each(reads)('does not start an already cancelled %s read', async (_name, read) => {
      const controller = new AbortController();
      controller.abort(new Error('private-reason'));
      await expect(read({ signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError', code: 'ABORT_ERR' });
      expect(https.request).not.toHaveBeenCalled();
    });

    test.each(reads)('destroys an active direct %s request when its caller aborts', async (_name, read) => {
      const controller = new AbortController();
      https.request.mockImplementation(() => {
        const request = new EventEmitter();
        request.write = jest.fn(); request.end = jest.fn(); request.destroy = jest.fn();
        return request;
      });
      const pending = expect(read({ signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError', code: 'ABORT_ERR' });
      await Promise.resolve(); await Promise.resolve();
      expect(https.request).toHaveBeenCalledTimes(1);
      controller.abort(new Error('private-reason'));
      await pending;
      expect(https.request.mock.results[0].value.destroy).toHaveBeenCalledTimes(1);
      expect(https.request).toHaveBeenCalledTimes(1); // no course fallback
    });

    test.each(reads)('shortens the actual %s transport deadline from caller options', async (_name, read) => {
      jest.useFakeTimers();
      https.request.mockImplementation(() => {
        const request = new EventEmitter();
        request.write = jest.fn(); request.end = jest.fn(); request.destroy = jest.fn();
        return request;
      });
      const pending = expect(read({ timeoutMs: 100 })).rejects.toThrow('timed out');
      await jest.advanceTimersByTimeAsync(100);
      await pending;
      expect(https.request).toHaveBeenCalledTimes(1);
      expect(https.request.mock.results[0].value.destroy).toHaveBeenCalledTimes(1);
    });

    test.each([0, -1, 1.5, NaN, Infinity])('rejects an invalid timeout before transport: %p', async timeoutMs => {
      await expect(tcFetchCourses({}, {}, { timeoutMs })).rejects.toMatchObject({ code: 'TC_READ_INVALID_OPTIONS' });
      await expect(tcFetchHomeworkActivitiesPage({}, 10001, 1, 50, { timeoutMs })).rejects.toMatchObject({ code: 'TC_READ_INVALID_OPTIONS' });
      expect(https.request).not.toHaveBeenCalled();
    });

    test('bounds a homework page by default and does not allow options to remove its eight-second limit', async () => {
      jest.useFakeTimers();
      https.request.mockImplementation(() => {
        const request = new EventEmitter();
        request.end = jest.fn(); request.destroy = jest.fn();
        return request;
      });
      const pending = expect(tcFetchHomeworkActivitiesPage({}, 10001, 1, 50, { timeoutMs: 60_000 })).rejects.toThrow('timed out');
      await jest.advanceTimersByTimeAsync(8_000);
      await pending;
      expect(https.request.mock.results[0].value.destroy).toHaveBeenCalledTimes(1);
    });

    test('bounds a homework page response before JSON parsing', async () => {
      mockHttpsResponse({ body: 'x'.repeat(2 * 1024 * 1024 + 1) });
      await expect(tcFetchHomeworkActivitiesPage({}, 10001, 1)).rejects.toThrow('response is too large');
      expect(https.request.mock.results[0].value.destroy).toHaveBeenCalledTimes(1);
    });

    test('does not start another course page or fallback after cancellation at the first response', async () => {
      const controller = new AbortController();
      mockHttpsResponse({ body: JSON.stringify({ courses: [{ id: 1, name: '課程' }], pages: 2 }),
        afterEnd: () => controller.abort() });
      await expect(tcFetchCourses({}, { userId: 9 }, { signal: controller.signal })).rejects.toMatchObject({ code: 'ABORT_ERR' });
      expect(https.request).toHaveBeenCalledTimes(1);
    });

    test('destroys a direct request whose headers arrived but body never finished, ignoring late body events', async () => {
      const controller = new AbortController();
      let response;
      https.request.mockImplementation((_options, callback) => {
        const request = new EventEmitter();
        request.destroy = jest.fn();
        request.end = jest.fn(() => {
          response = new EventEmitter();
          response.statusCode = 200; response.headers = {};
          callback(response);
          response.emit('data', Buffer.from('{"list":'));
        });
        return request;
      });
      const pending = expect(tcFetchStudentHomeworkSubmissionList({}, 20001, 123, { signal: controller.signal }))
        .rejects.toMatchObject({ code: 'ABORT_ERR' });
      await Promise.resolve(); await Promise.resolve();
      expect(response).toBeDefined();
      controller.abort();
      await pending;
      expect(https.request.mock.results[0].value.destroy).toHaveBeenCalledTimes(1);
      response.emit('data', Buffer.from('[]}'));
      response.emit('end');
      expect(https.request).toHaveBeenCalledTimes(1);
    });

    test('uses one total budget across internal course pages and discards a late second page', async () => {
      jest.useFakeTimers();
      mockHttpsResponse({ delayMs: 600, body: JSON.stringify({ courses: [{ id: 1, name: '第一頁' }], pages: 2 }) });
      mockHttpsResponse({ delayMs: 600, body: JSON.stringify({ courses: [{ id: 2, name: '第二頁' }], pages: 2 }) });
      const pending = expect(tcFetchCourses({}, { userId: 9 }, { timeoutMs: 1_000 })).rejects.toThrow('timed out');
      await jest.advanceTimersByTimeAsync(1_000);
      await pending;
      expect(https.request).toHaveBeenCalledTimes(2);
      expect(https.request.mock.results[1].value.destroy).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(1_000);
      expect(https.request).toHaveBeenCalledTimes(2);
    });

    test('shares the remaining course budget across profile and HTML fallback instead of renewing it', async () => {
      jest.useFakeTimers();
      jest.spyOn(console, 'warn').mockImplementation(() => {});
      mockHttpsResponse({ delayMs: 300, status: 404 });
      mockHttpsResponse({ delayMs: 300, body: '{}' });
      mockHttpsResponse({ delayMs: 600, body: '<html>late profile</html>' });
      const pending = expect(tcFetchCourses({}, {}, { timeoutMs: 1_000 })).rejects.toThrow('timed out');
      await jest.advanceTimersByTimeAsync(1_000);
      await pending;
      expect(https.request.mock.calls.map(([options]) => options.path)).toEqual(['/api/my-courses', '/api/profile', '/user/index']);
      expect(https.request.mock.results[2].value.destroy).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(1_000);
      expect(https.request).toHaveBeenCalledTimes(3);
    });

    test('passes caller cancellation through injected relay fetch without falling back to HTTPS', async () => {
      const controller = new AbortController();
      let upstream;
      setCampusHttpFetch(jest.fn((_url, init) => new Promise((_resolve, reject) => {
        upstream = init.signal;
        init.signal.addEventListener('abort', () => reject(Object.assign(new Error('private-reason'), { name: 'AbortError' })), { once: true });
      })));
      const pending = expect(tcFetchCourses({}, { userId: 9 }, { signal: controller.signal })).rejects.toMatchObject({ code: 'ABORT_ERR' });
      controller.abort();
      await pending;
      expect(upstream.aborted).toBe(true);
      expect(https.request).not.toHaveBeenCalled();
    });

    test('removes its caller listener when direct request construction throws', async () => {
      const controller = new AbortController();
      const remove = jest.spyOn(controller.signal, 'removeEventListener');
      https.request.mockImplementation(() => { throw new Error('synthetic socket creation failure'); });
      await expect(tcFetchHomeworkActivitiesPage({}, 10001, 1, 50, { signal: controller.signal })).rejects.toThrow('synthetic socket creation failure');
      expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    });
  });

  test('reads activities without a courseware_activity-only filter', async () => {
    mockHttpsResponse({
      body: JSON.stringify({ activities: [{ id: 30001, title: '講義', type: 'material' }] }),
    });
    await expect(tcFetchActivitiesRaw({ session: 'cookie' }, 10001, '')).resolves.toEqual([
      { id: 30001, title: '講義', type: 'material' },
    ]);
    expect(https.request.mock.calls[0][0].path).toBe('/api/courses/10001/activities');
  });

  test('does not treat course announcement 404 as an empty success', async () => {
    mockHttpsResponse({ status: 404, body: '{}' });
    await expect(tcFetchCourseAnnouncementsStrict({ session: 'cookie' }, 10001)).rejects.toMatchObject({
      status: 404,
    });
  });

  describe('official student homework read endpoints', () => {
    test('reads the direct activity object with one fixed GET and leaves scope validation to the caller', async () => {
      const raw = { id: 20001, course_id: 10001, type: 'homework', data: { homework_type: 'file_upload' }, published: true };
      mockHttpsResponse({ body: JSON.stringify(raw) });
      await expect(tcFetchHomeworkActivityStrict({ session: 'private-fixture' }, 20001)).resolves.toEqual(raw);
      expect(https.request).toHaveBeenCalledTimes(1);
      expect(https.request.mock.calls[0][0]).toMatchObject({
        hostname: 'tronclass.pu.edu.tw', method: 'GET', path: '/api/activities/20001', family: 4,
        headers: { Accept: 'application/json', Cookie: 'session=private-fixture' },
      });
      expect(https.request.mock.results[0].value.write).not.toHaveBeenCalled();
    });

    test('preserves the student list envelope, order and draft/final fields without inventing pages', async () => {
      const raw = {
        list: [
          { id: 901, student_id: 123, status: 'draft', submitted_at: null, content: 'draft-fixture' },
          { id: 902, student_id: 123, status: 'submitted', submitted_at: '2026-11-16T01:00:00Z', content: 'final-fixture' },
        ],
        paging: { pages: 3 },
      };
      mockHttpsResponse({ body: JSON.stringify(raw) });
      await expect(tcFetchStudentHomeworkSubmissionList({ session: 'private-fixture' }, 20001, 123)).resolves.toEqual(raw);
      expect(https.request).toHaveBeenCalledTimes(1);
      expect(https.request.mock.calls[0][0]).toMatchObject({
        hostname: 'tronclass.pu.edu.tw', method: 'GET', path: '/api/activities/20001/students/123/submission_list',
      });
      expect(https.request.mock.results[0].value.write).not.toHaveBeenCalled();
    });

    test('distinguishes an explicit empty list from a missing list', async () => {
      mockHttpsResponse({ body: '{"list":[]}' });
      await expect(tcFetchStudentHomeworkSubmissionList({}, 20001, 123)).resolves.toEqual({ list: [] });
      expect(https.request).toHaveBeenCalledTimes(1);
    });

    test.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '20001', '../profile', '1?student=2', null, undefined, true, {}])(
      'rejects non-numeric or unsafe identifiers before any school request: %p', async (id) => {
        await expect(tcFetchHomeworkActivityStrict({}, id)).rejects.toMatchObject({ code: 'TC_HOMEWORK_INVALID_ID', status: 400 });
        await expect(tcFetchStudentHomeworkSubmissionList({}, id, 123)).rejects.toMatchObject({ code: 'TC_HOMEWORK_INVALID_ID', status: 400 });
        await expect(tcFetchStudentHomeworkSubmissionList({}, 20001, id)).rejects.toMatchObject({ code: 'TC_HOMEWORK_INVALID_ID', status: 400 });
        expect(https.request).not.toHaveBeenCalled();
      },
    );

    describe.each([
      ['activity', () => tcFetchHomeworkActivityStrict({ session: 'private-fixture' }, 20001)],
      ['student history', () => tcFetchStudentHomeworkSubmissionList({ session: 'private-fixture' }, 20001, 123)],
    ])('%s failures', (_name, read) => {
      test.each([301, 302, 303, 307, 308, 401, 403, 404, 503])('rejects HTTP %s without redirecting or probing a fallback', async (status) => {
        mockHttpsResponse({ status, headers: { location: 'https://other.test/credential-target' }, body: '{}' });
        const pending = read();
        if ([302, 401, 403].includes(status)) await expect(pending).rejects.toThrow('session 已失效');
        else await expect(pending).rejects.toMatchObject({ status, code: 'TC_HTTP' });
        expect(https.request).toHaveBeenCalledTimes(1);
        expect(https.request.mock.calls[0][0]).toMatchObject({ hostname: 'tronclass.pu.edu.tw', method: 'GET' });
        expect(https.request.mock.results[0].value.write).not.toHaveBeenCalled();
      });

      test('recognizes an HTML login page and never reports no submissions', async () => {
        mockHttpsResponse({ body: '<html><form>private-login-response</form></html>' });
        await expect(read()).rejects.toThrow('session 已失效');
        expect(https.request).toHaveBeenCalledTimes(1);
      });

      test('does not include source text in malformed JSON errors', async () => {
        mockHttpsResponse({ body: '{"private-source-content":' });
        await expect(read()).rejects.toMatchObject({ code: 'TC_HOMEWORK_RESPONSE_INVALID', message: 'TC_HOMEWORK_RESPONSE_INVALID', status: 502 });
        expect(https.request).toHaveBeenCalledTimes(1);
      });

      test('bounds a stalled read to eight seconds and does not retry', async () => {
        jest.useFakeTimers();
        https.request.mockImplementation(() => {
          const req = new EventEmitter();
          req.end = jest.fn();
          req.destroy = jest.fn();
          return req;
        });
        const pending = expect(read()).rejects.toThrow('timed out');
        await jest.advanceTimersByTimeAsync(8000);
        await pending;
        expect(https.request).toHaveBeenCalledTimes(1);
        expect(https.request.mock.results[0].value.destroy).toHaveBeenCalledTimes(1);
      });

      test('destroys an oversized response instead of parsing or returning a truncated list', async () => {
        mockHttpsResponse({ body: 'x'.repeat(1024 * 1024 + 1) });
        await expect(read()).rejects.toThrow('response is too large');
        expect(https.request).toHaveBeenCalledTimes(1);
        expect(https.request.mock.results[0].value.destroy).toHaveBeenCalledTimes(1);
      });
    });

    test.each([null, [], {}, { activity: { id: 20001 } }, { id: 0 }, { id: '20001/other' }, { message: 'unavailable' }])(
      'rejects an invalid direct activity envelope: %p', async (raw) => {
        mockHttpsResponse({ body: JSON.stringify(raw) });
        await expect(tcFetchHomeworkActivityStrict({}, 20001)).rejects.toMatchObject({ code: 'TC_HOMEWORK_RESPONSE_INVALID', status: 502 });
        expect(https.request).toHaveBeenCalledTimes(1);
      },
    );

    test.each([null, [], {}, { list: null }, { list: {} }, { submissions: [] }, { data: { list: [] } }])(
      'rejects an invalid submission_list envelope instead of returning empty history: %p', async (raw) => {
        mockHttpsResponse({ body: JSON.stringify(raw) });
        await expect(tcFetchStudentHomeworkSubmissionList({}, 20001, 123)).rejects.toMatchObject({ code: 'TC_HOMEWORK_RESPONSE_INVALID', status: 502 });
        expect(https.request).toHaveBeenCalledTimes(1);
      },
    );

    test('rejects a list above the item limit without truncating it or requesting another page', async () => {
      mockHttpsResponse({ body: JSON.stringify({ list: Array.from({ length: 1001 }, (_, id) => ({ id })) }) });
      await expect(tcFetchStudentHomeworkSubmissionList({}, 20001, 123)).rejects.toMatchObject({ code: 'TC_HOMEWORK_RESPONSE_INVALID', status: 502 });
      expect(https.request).toHaveBeenCalledTimes(1);
    });
  });
});

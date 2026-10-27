const { EventEmitter } = require('events');

jest.mock('https', () => ({
  request: jest.fn(),
}));

const https = require('https');
const { tcFetchCourses, tcFetchProfile, tcFetchIdentityProfile } = require('./tronClassScraper');

function mockHttpsResponse({ status = 200, headers = {}, body = '{}' }) {
  https.request.mockImplementationOnce((options, callback) => {
    const req = new EventEmitter();
    req.write = jest.fn();
    req.end = jest.fn(() => {
      const res = new EventEmitter();
      res.statusCode = status;
      res.headers = headers;
      callback(res);
      process.nextTick(() => {
        res.emit('data', Buffer.from(body));
        res.emit('end');
      });
    });
    return req;
  });
}

describe('tronClassScraper', () => {
  beforeEach(() => {
    https.request.mockReset();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
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
});

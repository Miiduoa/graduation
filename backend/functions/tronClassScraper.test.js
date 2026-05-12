const { EventEmitter } = require('events');

jest.mock('https', () => ({
  request: jest.fn(),
}));

const https = require('https');
const { tcFetchCourses, tcFetchProfile } = require('./tronClassScraper');

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
});

const { EventEmitter } = require('events');
const https = require('https');
const { parsePuCourseTime } = require('./puCourseTime');
const { puFetchCourses, puFetchGrades } = require('../puScraper');

describe('PU course meeting parser', () => {
  test('parses the documented source without changing its period meaning', () => {
    expect(parsePuCourseTime('二(Tue)  3, 4:PH303')).toEqual({
      dayOfWeek: 2, periods: [3, 4], location: 'PH303', startTime: '10:10', endTime: '12:00',
    });
    expect(parsePuCourseTime('一(Mon) 3, 1, 3:PH217')).toMatchObject({ periods: [1, 3] });
    expect(parsePuCourseTime('二（Tue）　3，4：主顧303')).toMatchObject({
      dayOfWeek: 2, periods: [3, 4], location: '主顧303',
    });
  });

  test.each([
    ['一', 'Mon', 1], ['二', 'Tue', 2], ['三', 'Wed', 3], ['四', 'Thu', 4],
    ['五', 'Fri', 5], ['六', 'Sat', 6], ['日', 'Sun', 7],
  ])('supports %s (%s), including weekend meetings', (chinese, english, dayOfWeek) => {
    expect(parsePuCourseTime(`${chinese}(${english}) 4:`)).toEqual({
      dayOfWeek, periods: [4], location: '', startTime: '11:10', endTime: '12:00',
    });
  });

  test('keeps missing room data empty and uses the existing night-period timetable', () => {
    expect(parsePuCourseTime('六(Sat) 4')).toMatchObject({ periods: [4], location: '' });
    expect(parsePuCourseTime('五(Fri) 10, 11, 12, 13:PH320')).toMatchObject({
      startTime: '18:30', endTime: '22:05',
    });
  });

  test.each([
    null, undefined, '', {}, 123, '另行公告', '一(Mon) :PH303', '一(Mon) 0:PH303',
    '一(Mon) 14:PH303', '一(Mon) 3, 99:PH303', '一(Mon) -1:PH303',
    '一(Mon) 3.5:PH303', '一(Mon) 3,,4:PH303', '一(Mon) 3 4:PH303',
    '一(Mon) 3-4:PH303', '一(Tue) 3:PH303', '一(Unknown) 3:PH303',
  ])('does not invent default times for unsupported input: %p', (raw) => {
    expect(parsePuCourseTime(raw)).toBeNull();
  });

  test.each([
    '二(Tue) 3, 4:PH303 四(Thu) 7, 8:PH301',
    '二(Tue) 3, 4:PH303\n四(Thu) 7:PH301',
    '二(Tue) 3:PH303；二(Tue) 7:PH301',
    '二(Tue) 3:PH303 / 7:PH301',
    '二(Tue) 3:PH303 週四 7:PH301',
    '二(Tue) 3:PH303 Thu 7:PH301',
  ])('rejects multi-meeting rows instead of disguising the second meeting as a room: %s', (raw) => {
    expect(parsePuCourseTime(raw)).toBeNull();
  });
});

describe('course scraper integration', () => {
  afterEach(() => jest.restoreAllMocks());

  function respondWith(html, status = 200) {
    jest.spyOn(https, 'request').mockImplementation((_options, callback) => {
      const request = new EventEmitter();
      request.end = () => {
        const response = new EventEmitter();
        response.headers = {};
        response.statusCode = status;
        callback(response);
        response.emit('data', Buffer.from(html));
        response.emit('end');
      };
      return request;
    });
  }

  function documentWith(raw) {
    return `<p>學號(Student No.)：412345678 姓名(Student Name)：林同學 115學年度 第1學期</p>
      <table><tr><th>選課代號 course code</th><th>班級</th><th>科目</th><th>修別</th><th>學分</th><th>時間</th><th>老師</th></tr>
      <tr><td>IM201</td><td>資管二</td><td>資料庫DATABASE</td><td>必修</td><td>3</td><td>${raw}</td><td>teacher@example.edu.tw</td></tr></table>`;
  }

  test('preserves the full source row when HTML has meetings on multiple days', async () => {
    respondWith(documentWith('二(Tue) 3:PH303<br>四(Thu) 7:PH301'));
    const result = await puFetchCourses({ SID: 'test-session' });
    expect(result.success).toBe(true);
    expect(result.courses[0]).toMatchObject({
      code: 'IM201', name: '資料庫', dayOfWeek: null, periods: [],
      startTime: null, endTime: null, location: '',
      timePlaceRaw: '二(Tue) 3:PH303 四(Thu) 7:PH301',
    });
  });

  test('does not turn an unknown period into an 08:10 class', async () => {
    respondWith(documentWith('二(Tue) 14:PH303'));
    const result = await puFetchCourses({ SID: 'test-session' });
    expect(result.courses[0]).toMatchObject({
      dayOfWeek: null, startTime: null, endTime: null, timePlaceRaw: '二(Tue) 14:PH303',
    });
  });

  test('marks an actual login page as an expired session', async () => {
    respondWith('<form action="index_check.php"><input type="password" name="password"></form>');
    await expect(puFetchCourses({ SID: 'expired' })).resolves.toMatchObject({
      success: false, code: 'session-expired', courses: [],
    });
  });

  test('does not classify transport errors as expired sessions', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    respondWith('', 503);
    const result = await puFetchCourses({ SID: 'test-session' });
    expect(result).toMatchObject({ success: false, error: 'HTTP 503' });
    expect(result.code).toBeUndefined();
  });

  test('grade fetches report expiration only when the final page is a login page', async () => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    respondWith('<form action="index_check.php"><input type="password" name="password"></form>');
    await expect(puFetchGrades({ SID: 'expired' })).resolves.toMatchObject({
      success: false, code: 'session-expired', grades: [],
    });
  });

  test('changed grade markup is not mislabeled as an expired session', async () => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    respondWith('<p>Unknown document structure</p>');
    const result = await puFetchGrades({ SID: 'test-session' });
    expect(result.success).toBe(false);
    expect(result.code).toBeUndefined();
  });
});

'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const https = require('https');
const { puFetchGrades } = require('./puScraper');

const paths = ['/stu_query/score_all.php', '/score_query/score_all.php', '/index_menu.php'];
const login = '<form action="index_check.php"><input name="uid"><input name="upassword"></form>';
const transcript = '<table><tr><th>學期別</th><th>課程名稱</th><th>修課班級</th><th>修別</th><th>學分數</th><th>成績</th></tr>' +
  '<tr><td>1151</td><td>資料庫</td><td>測試班</td><td>必修</td><td>3</td><td>85</td></tr></table>';

function mockSchool(respond) {
  const calls = [];
  jest.spyOn(https, 'request').mockImplementation((options, callback) => {
    calls.push(options);
    const request = new EventEmitter();
    request.write = () => {};
    request.destroy = () => {};
    request.end = () => {
      const fixture = respond(options);
      const response = new EventEmitter();
      response.statusCode = fixture.status || 200;
      response.headers = fixture.headers || {};
      callback(response);
      response.emit('data', Buffer.from(fixture.html || ''));
      response.emit('end');
    };
    return request;
  });
  return calls;
}

afterEach(() => jest.restoreAllMocks());

for (const [index, path] of paths.entries()) {
  test(`stops all later grade sources when ${path} becomes a login form`, async () => {
    const cookies = { SID: 'synthetic-session' };
    const calls = mockSchool(options => options.path === path
      ? { html: login, headers: { 'set-cookie': ['SID=guest; Path=/; Secure'] } }
      : { status: 404 });
    const result = await puFetchGrades(cookies);
    assert.equal(result.success, false);
    assert.equal(result.code, 'session-expired');
    assert.equal(result.grades.length, 0);
    assert.deepEqual(calls.map(call => call.path), paths.slice(0, index + 1));
    assert.ok(calls.every(call => call.hostname === 'alcat.pu.edu.tw'));
    assert.deepEqual(cookies, { SID: 'synthetic-session' });
  });
}

test('a relative redirect from the menu to a login page does not start the mypu fallback', async () => {
  const calls = mockSchool(options => options.path === '/index_menu.php'
    ? { status: 302, headers: { location: 'login.php' } }
    : options.path === '/login.php' ? { html: login } : { status: 404 });
  const result = await puFetchGrades({ SID: 'synthetic-session' });
  assert.equal(result.code, 'session-expired');
  assert.deepEqual(calls.map(call => call.path), [...paths, '/login.php']);
  assert.ok(calls.every(call => call.hostname === 'alcat.pu.edu.tw'));
});

test('does not present an earlier bridge result as successful after the same portal requests login', async () => {
  const calls = mockSchool(options => {
    if (options.path === paths[0]) return { status: 404 };
    if (options.hostname === 'alcat.pu.edu.tw' && options.path === paths[1]) return { html: transcript };
    if (options.path === paths[2]) return { html: login };
    return { html: transcript };
  });
  const result = await puFetchGrades({ SID: 'synthetic-session' });
  assert.equal(result.success, false);
  assert.equal(result.code, 'session-expired');
  assert.equal(result.grades.length, 0);
  assert.deepEqual(calls.map(call => call.path), paths);
});

test('still uses mypu after a valid menu and preserves same-name cookie rotation', async () => {
  const cookies = { SID: 'synthetic-session' };
  const calls = mockSchool(options => {
    if (options.hostname === 'mypu.pu.edu.tw') return { html: transcript };
    if (options.path === paths[2]) return { html: '<p>目前開放中的系統</p>', headers: { 'set-cookie': ['SID=renewed; Path=/'] } };
    return { status: 404 };
  });
  const result = await puFetchGrades(cookies);
  assert.equal(result.success, true);
  assert.equal(result.grades.length, 1);
  assert.equal(result.grades[0].courseName, '資料庫');
  assert.equal(calls.length, 4);
  assert.equal(calls[3].hostname, 'mypu.pu.edu.tw');
  assert.equal(calls[3].headers.Cookie, 'SID=renewed');
  assert.deepEqual(cookies, { SID: 'synthetic-session' });
});

/* eslint-disable @typescript-eslint/no-require-imports */
/* global require */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');
const original = require.extensions['.ts'];
require.extensions['.ts'] = (module, filename) => {
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  module._compile(source, filename);
};
const {
  createAssistantCalendarReceipt,
  parseAssistantCalendarEvent,
  parseAssistantCalendarReceipt,
  parseAssistantCalendarExecutionResult,
} = require('../src/assistantExecution.ts');
require.extensions['.ts'] = original;

const mutationId = 'av2_0123456789abcdef0123456789abcdef';
const event = { title: '資料結構作業', date: '2026-11-07', allDay: false, startTime: '20:00', endTime: '21:00' };
const expected = { schoolId: 'pu', mutationId, event, storage: 'synced' };
const record = () => ({
  ...event, id: mutationId, kind: 'events', schoolId: 'pu', academicYear: '', semester: '',
  batchId: mutationId, importedAt: '2026-11-07T10:00:00.000Z',
  source: { type: 'paste', name: '助理確認', line: 1, rawText: '' },
});
const receipt = () => ({
  version: 1, operation: 'calendar.create', status: 'verified', schoolId: 'pu', mutationId,
  verifiedAt: '2026-11-07T10:01:00.000Z', storage: 'synced', revision: 2, replay: false,
  record: record(),
});
const check = (status = 'absent', overrides = {}) => ({
  version: 1, operation: 'calendar.create', status, schoolId: 'pu', mutationId,
  storage: 'synced', checkedAt: '2026-11-07T10:01:00.000Z', revision: 1,
  authorizationValid: false, retryable: false, ...overrides,
});

test('核對同一事件與範圍，保留穩定ID且回傳獨立的單筆回條', () => {
  const raw = receipt();
  const parsed = parseAssistantCalendarReceipt(raw, expected);
  assert.deepEqual(parsed, raw);
  raw.record.title = '事後變更';
  raw.record.source.name = '事後來源';
  assert.equal(parsed.record.title, event.title);
  assert.equal(parsed.record.source.name, '助理確認');
});

test('裝置回條不需要雲端revision，接受安全ID、地點與原始建立時間', () => {
  const id = 'device_event-123';
  const localEvent = { ...event, location: '家裡' };
  const localRecord = { ...record(), ...localEvent, id, batchId: id,
    source: { type: 'paste', name: '助理行程', line: 1, rawText: '' } };
  const parsed = createAssistantCalendarReceipt({
    schoolId: 'pu', mutationId: id, event: localEvent, record: localRecord,
    storage: 'device', verifiedAt: '2026-11-07T18:01:00+08:00',
  });
  assert.equal(parsed.status, 'verified');
  assert.equal(parsed.replay, false);
  assert.equal(parsed.record.importedAt, localRecord.importedAt);
  assert.equal(parsed.record.location, '家裡');
  assert.equal('revision' in parsed, false);
});

test('HTTP成功或任意confirmed欄位不是執行證據', () => {
  for (const value of [{}, { confirmed: true }, { ...receipt(), confirmed: true }, null, []]) {
    assert.throws(() => parseAssistantCalendarReceipt(value, expected));
  }
  for (const [key, value] of [
    ['version', 2], ['operation', 'calendar.delete'], ['status', 'pending'],
    ['storage', 'external'], ['schoolId', 'nthu'], ['mutationId', 'other-event-123'],
  ]) assert.throws(() => parseAssistantCalendarReceipt({ ...receipt(), [key]: value }, expected), key);
  assert.throws(() => parseAssistantCalendarReceipt(receipt(), { ...expected, storage: 'device' }));
});

test('每個確認的事件欄位必須精確相同，不接受另一時段或額外地點', () => {
  for (const change of [
    { title: '其他作業' }, { date: '2026-11-08' }, { allDay: true },
    { startTime: '20:30' }, { endTime: '22:00' }, { endDate: '2026-11-08' },
    { location: '另一棟樓' },
  ]) {
    const raw = receipt();
    Object.assign(raw.record, change);
    assert.throws(() => parseAssistantCalendarReceipt(raw, expected), JSON.stringify(change));
  }
});

test('事件ID、批次與學校皆綁定原提議', () => {
  for (const change of [
    { id: 'different-id' }, { batchId: 'different-batch' }, { schoolId: 'nthu' },
    { kind: 'grades' }, { academicYear: '115' }, { semester: '1' },
  ]) {
    const raw = receipt();
    Object.assign(raw.record, change);
    assert.throws(() => parseAssistantCalendarReceipt(raw, expected));
  }
});

test('禁止將原始匯入文字、成績或任意附加資料夾在事件回條', () => {
  for (const change of [
    { grade: 'PRIVATE_GRADE' }, { credits: 3 }, { teacher: 'PRIVATE_TEACHER' },
    { courseCode: 'PRIVATE_COURSE' }, { linkedCourseId: 'unverified' },
    { classExceptions: [] }, { rawText: 'PRIVATE_RAW' },
  ]) {
    const raw = receipt();
    Object.assign(raw.record, change);
    assert.throws(() => parseAssistantCalendarReceipt(raw, expected));
  }
  for (const source of [
    { type: 'paste', line: 1, rawText: 'PRIVATE_RAW' },
    { type: 'file', line: 1, rawText: '' },
    { type: 'paste', line: 2, rawText: '' },
    { type: 'paste', line: 1, rawText: '', secret: 'SECRET' },
  ]) assert.throws(() => parseAssistantCalendarReceipt({ ...receipt(), record: { ...record(), source } }, expected));
});

test('雲端已核對回條需要有效revision，裝置也不接受錯誤版本數值', () => {
  for (const revision of [undefined, -1, 0, 0.5, Infinity, Number.MAX_SAFE_INTEGER + 1, '2']) {
    const raw = receipt();
    if (revision === undefined) delete raw.revision;
    else raw.revision = revision;
    assert.throws(() => parseAssistantCalendarReceipt(raw, expected), String(revision));
  }
  assert.throws(() => parseAssistantCalendarReceipt({ ...receipt(), storage: 'device', revision: -1 }, { ...expected, storage: 'device' }));
});

test('時間戳記必須完整合法，不能只傳日期或會被Date自動修正的日期', () => {
  for (const timestamp of ['', '2026-11-07', '2026-02-31T00:00:00Z', 'tomorrow', '2026-11-07T25:00:00Z']) {
    assert.throws(() => parseAssistantCalendarReceipt({ ...receipt(), verifiedAt: timestamp }, expected));
    assert.throws(() => parseAssistantCalendarReceipt({ ...receipt(), record: { ...record(), importedAt: timestamp } }, expected));
  }
});

test('共用事件驗證保留跨日與全天規則，禁止無效或不完整時段', () => {
  assert.deepEqual(parseAssistantCalendarEvent({ ...event, endDate: '2026-11-08', startTime: '23:00', endTime: '00:30' }),
    { ...event, endDate: '2026-11-08', startTime: '23:00', endTime: '00:30' });
  assert.deepEqual(parseAssistantCalendarEvent({ title: '讀書日', date: '2026-11-07', endDate: '2026-11-08', allDay: true }),
    { title: '讀書日', date: '2026-11-07', endDate: '2026-11-08', allDay: true });
  for (const value of [
    { ...event, endTime: '19:00' }, { ...event, date: '2026-02-31' },
    { ...event, allDay: true }, { ...event, startTime: undefined },
    { title: '讀書日', date: '2026-11-07', endDate: '2026-11-07', allDay: true },
    { ...event, token: 'untrusted' }, { ...event, title: ' 字首空白' },
  ]) assert.throws(() => parseAssistantCalendarEvent(value));
});

test('驗證不得執行getter，也不接受原型物件或隱藏附加資料', () => {
  let calls = 0;
  const raw = receipt();
  Object.defineProperty(raw.record, 'title', { enumerable: true, get() { calls++; return event.title; } });
  assert.throws(() => parseAssistantCalendarReceipt(raw, expected));
  assert.equal(calls, 0);
  assert.throws(() => parseAssistantCalendarReceipt(Object.create(receipt()), expected));
  const symbol = receipt();
  symbol[Symbol('private')] = 'PRIVATE';
  assert.throws(() => parseAssistantCalendarReceipt(symbol, expected));
});

test('absent與conflict不夾帶紀錄，也不把未查到誤認為可新建', () => {
  assert.deepEqual(parseAssistantCalendarExecutionResult(check(), expected), check());
  const absent = check('absent', { authorizationValid: true, retryable: true });
  assert.deepEqual(parseAssistantCalendarExecutionResult(absent, expected), absent);
  const conflict = check('conflict', { authorizationValid: true });
  assert.deepEqual(parseAssistantCalendarExecutionResult(conflict, expected), conflict);
  for (const value of [
    check('absent', { retryable: true }), check('conflict', { authorizationValid: true, retryable: true }),
    check('absent', { record: record() }), check('conflict', { record: record() }),
    check('absent', { schoolId: 'nthu' }),
  ]) assert.throws(() => parseAssistantCalendarExecutionResult(value, expected));
});

test('撤銷回條明確限制為提議，重試仍可表示alreadyRevoked', () => {
  const revoked = check('revoked', { alreadyRevoked: true });
  assert.deepEqual(parseAssistantCalendarExecutionResult(revoked, expected), revoked);
  for (const value of [
    check('revoked', { alreadyRevoked: true, authorizationValid: true }),
    check('revoked', { alreadyRevoked: false, retryable: true }),
    check('revoked'), check('revoked', { alreadyRevoked: true, deleted: true }),
  ]) assert.throws(() => parseAssistantCalendarExecutionResult(value, expected));
});

test('事件回條factory仍需通過expected比對，不能把不同讀回內容當完成', () => {
  assert.throws(() => createAssistantCalendarReceipt({
    ...expected, record: { ...record(), title: '另一件事' },
    storage: 'synced', revision: 2, verifiedAt: '2026-11-07T10:01:00Z',
  }));
  assert.deepEqual(parseAssistantCalendarExecutionResult(receipt(), expected), receipt());
});

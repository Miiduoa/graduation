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
const { clubEventInput } = require('../src/clubForms.ts');
require.extensions['.ts'] = original;

const dateFields = ['startsAt', 'endsAt', 'registrationDeadline', 'cancellationDeadline'];

test('活動與截止時間依台灣時間解析，不受 UTC 或其他裝置時區影響', () => {
  const originalTimezone = process.env.TZ;
  try {
    for (const timezone of ['UTC', 'America/Los_Angeles', 'Asia/Taipei']) {
      process.env.TZ = timezone;
      if (timezone === 'UTC') assert.equal(new Date('2026-11-17T18:00').getTimezoneOffset(), 0);
      for (const field of dateFields) {
        assert.equal(
          clubEventInput({ [field]: '2026-11-17T18:00' })[field],
          Date.parse('2026-11-17T18:00:00+08:00'),
        );
        assert.equal(
          clubEventInput({ [field]: '2026-11-17T18:00:45' })[field],
          Date.parse('2026-11-17T18:00:45+08:00'),
        );
        const midnight = clubEventInput({ [field]: '2026-11-17' })[field];
        assert.equal(midnight, Date.parse('2026-11-17T00:00:00+08:00'));
        assert.notEqual(midnight, Date.parse('2026-11-17T00:00:00Z'));
      }
    }
  } finally {
    if (originalTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimezone;
  }
});

test('含明確時區的時間保留原始瞬間', () => {
  for (const value of [
    '2026-11-17T18:00:00Z',
    '2026-11-17T18:00:00+08:00',
    '2026-11-17T18:00:00.123-05:00',
  ]) {
    for (const field of dateFields) {
      assert.equal(clubEventInput({ [field]: value })[field], Date.parse(value));
    }
  }
});

test('名額仍為數字，其他文字欄位保持原樣', () => {
  assert.deepEqual(clubEventInput({ capacity: '25', title: '活動名稱', location: '地點' }), {
    capacity: 25,
    title: '活動名稱',
    location: '地點',
  });
});

test('空白、無效或自動進位的日期時間會拒絕解析', () => {
  for (const value of [
    '', ' ', 'invalid', '2026-02-29', '2026-02-30T18:00',
    '2026-02-30T18:00:00Z', '2026-13-01', '2026-11-00',
    '2026-11-17T24:00', '2026-11-17T18:60', '2026-11-17T18:00:60',
    '2026-11-17T18:00:00+25:00',
  ]) {
    for (const field of dateFields) {
      assert.throws(() => clubEventInput({ [field]: value }), RangeError);
    }
  }
  assert.equal(clubEventInput({ startsAt: '2028-02-29' }).startsAt, Date.parse('2028-02-29T00:00:00+08:00'));
});

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
const { dormParcelReturnNotice, projectDormParcel, DORM_PACKAGES_EMPTY } = require('../src/dormitoryCloud.ts');
require.extensions['.ts'] = original;
const arrivedAt = Date.parse('2026-11-12T10:00:00+08:00');
const parcel = projectDormParcel('estimate', { status: 'arrived', arrivedAt });
test('推算退件日前一天提醒，滿三天與四天以上不再稱明天', () => {
  assert.equal(dormParcelReturnNotice(parcel, arrivedAt + 86400000), '');
  assert.equal(dormParcelReturnNotice(parcel, arrivedAt + 2 * 86400000), '預估明天起可能退件（依到件日加三天推算，實際期限以宿舍公告為準）');
  for (const days of [3, 4, 10])
    assert.equal(
      dormParcelReturnNotice(parcel, arrivedAt + days * 86400000),
      '已到件多日，請確認領取期限',
    );
  assert.equal(
    dormParcelReturnNotice({ ...parcel, status: 'picked_up' }, arrivedAt + 4 * 86400000),
    '',
  );
  assert.equal(dormParcelReturnNotice({ ...parcel, arrivedAt: null }), '');
});
test('台灣午夜跨入推算日期後，使用保守領取期限提示', () => {
  assert.equal(
    dormParcelReturnNotice(parcel, Date.parse('2026-11-14T23:59:59+08:00')),
    '預估明天起可能退件（依到件日加三天推算，實際期限以宿舍公告為準）',
  );
  assert.equal(
    dormParcelReturnNotice(parcel, Date.parse('2026-11-15T00:00:00+08:00')),
    '已到件多日，請確認領取期限',
  );
});

test('包裹空白狀態只描述個人紀錄', () => {
  assert.equal(DORM_PACKAGES_EMPTY, '此處目前沒有顯示登錄給你的包裹；郵局包裹及掛號郵件請至櫃檯領取。');
});

test('只投影明確的退件／領取期限欄位，接受現有時間格式', () => {
  const expected = Date.parse('2026-11-20T10:00:00+08:00');
  const aliases = ['returnAt', 'returnBy', 'returnDate', 'pickupDeadline', 'holdUntil', 'retainUntil', 'pickupBy'];
  for (const field of aliases) {
    for (const value of [expected, '2026-11-20T10:00:00+08:00', { seconds: expected / 1000 }, { toMillis: () => expected }]) {
      assert.equal(projectDormParcel('official', { [field]: value }).returnAt, expected, field);
    }
  }
  assert.equal(projectDormParcel('missing', {}).returnAt, null);
  assert.equal(projectDormParcel('unrelated', {
    returnedAt: expected, deadline: expected, expiresAt: expected, dueDate: expected,
  }).returnAt, null);
  for (const value of [null, '', '無效日期', false, NaN, Infinity, { seconds: NaN }, { seconds: Infinity }, 1e20]) {
    assert.equal(projectDormParcel('invalid', { returnAt: value }).returnAt, null);
    assert.equal(projectDormParcel('fallback', { returnAt: value, pickupDeadline: expected }).returnAt, expected);
  }
  assert.equal(projectDormParcel('precedence', { returnAt: expected, pickupDeadline: expected + 86400000 }).returnAt, expected);
});

test('登錄期限無論在未來或過去都顯示原日期，不依到件日推算，也不宣稱已退件', () => {
  const now = Date.parse('2026-11-17T10:00:00+08:00');
  for (const [returnAt, date] of [
    ['2026-11-20T02:00:00Z', '2026/11/20 10:00:00'],
    ['2026-11-15T02:00:00Z', '2026/11/15 10:00:00'],
  ]) {
    for (const arrival of [null, now - 2 * 86400000, now - 10 * 86400000]) {
      const official = projectDormParcel('official', { returnAt, arrivedAt: arrival });
      const notice = dormParcelReturnNotice(official, now);
      assert.equal(notice.replace(/\s/g, ' '), `登錄退件／領取期限：${date}（台灣時間）`);
      assert.doesNotMatch(notice, /預估|推算|加三天|明天|已退件|已到件多日/);
    }
  }
});

test('沒有有效登錄期限時只保留誠實推算，不將其他日期當成官方期限', () => {
  for (const fields of [{}, { returnAt: '無效日期' }, { returnedAt: arrivedAt }, { deadline: arrivedAt, expiresAt: arrivedAt }]) {
    const estimate = projectDormParcel('estimate', { arrivedAt, ...fields });
    for (const days of [1, 2, 3, 4, 10]) {
      const notice = dormParcelReturnNotice(estimate, arrivedAt + days * 86400000);
      assert.equal(notice, dormParcelReturnNotice(parcel, arrivedAt + days * 86400000));
      assert.doesNotMatch(notice, /登錄退件|官方期限|校方期限|學校期限/);
    }
  }
});

test('已領取與已退件包裹不顯示待退件提醒，不論是否有登錄期限', () => {
  for (const status of ['picked', 'picked_up', 'returned']) {
    for (const returnAt of [null, arrivedAt, arrivedAt + 10 * 86400000]) {
      const completed = projectDormParcel('completed', { status, arrivedAt, returnAt });
      assert.equal(completed.status, status === 'returned' ? 'returned' : 'collected');
      assert.equal(dormParcelReturnNotice(completed, arrivedAt + 4 * 86400000), '');
    }
  }
});

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
const { dormParcelReturnNotice, projectDormParcel, DORM_PACKAGES_EMPTY, watchDormParcels } = require('../src/dormitoryCloud.ts');
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

test('API 成功省略期限時，依公開識別碼保留 legacy 期限，兩種到達順序皆可更新與清除', async () => {
  for (const apiFirst of [false, true]) {
    let snapshot;
    let finish;
    const changes = [];
    const stop = watchDormParcels(
      (rows) => { snapshot = rows; return () => {}; },
      (change) => { change(true); return () => {}; },
      () => new Promise((resolve) => { finish = resolve; }),
      (rows) => changes.push(rows),
      () => assert.fail('不應讀取失敗'),
    );
    try {
      const legacy = (deadline) => [{ id: 'legacy-document', data: {
        publicId: 'dw_public', pickupDeadline: deadline, description: '舊名稱',
        status: 'arrived', staffNote: '不可帶入 API 投影',
      } }];
      const api = [{ id: 'dw_public', data: {
        description: '目前名稱', arrivedAt, status: 'picked_up',
      } }, { id: 'dw_private', data: { description: '私有包裹', arrivedAt } }];
      if (!apiFirst) snapshot(legacy('2026-11-25T02:00:00Z'));
      finish({ rows: api });
      await Promise.resolve();
      if (apiFirst) snapshot(legacy('2026-11-25T02:00:00Z'));
      assert.deepEqual(changes.at(-1), [{ ...api[0], data: {
        ...api[0].data, returnAt: Date.parse('2026-11-25T02:00:00Z'),
      } }, api[1]]);
      assert.equal(dormParcelReturnNotice(projectDormParcel('dw_public', changes.at(-1)[0].data)), '');
      snapshot(legacy('2026-11-26T02:00:00Z'));
      assert.equal(projectDormParcel('dw_public', changes.at(-1)[0].data).returnAt, Date.parse('2026-11-26T02:00:00Z'));
      snapshot(legacy(null));
      assert.deepEqual(changes.at(-1), api);
      snapshot([]);
      assert.deepEqual(changes.at(-1), api);
    } finally {
      stop();
    }
  }
});

test('API 的期限、清除、包裹清單優先，不將其他包裹期限混入或復活已移除包裹', async () => {
  for (const apiFields of [{ returnAt: '2026-11-27T02:00:00Z' }, { pickupDeadline: null }, {}]) {
    const api = [{ id: 'dw_public', data: apiFields }, { id: 'dw_unmatched', data: {} }];
    let result;
    const stop = watchDormParcels(
      (rows) => {
        rows([
          { id: 'raw-id', data: { publicId: 'dw_public', returnAt: '2026-11-25T02:00:00Z' } },
          { id: 'removed', data: { returnAt: '2026-11-26T02:00:00Z' } },
        ]);
        return () => {};
      },
      (change) => { change(true); return () => {}; },
      async () => ({ rows: api }),
      (rows) => { result = rows; },
      () => assert.fail('不應讀取失敗'),
    );
    try {
      await Promise.resolve();
      assert.deepEqual(result.map((row) => row.id), ['dw_public', 'dw_unmatched']);
      assert.deepEqual(result[1], api[1]);
      if (Object.keys(apiFields).length) assert.deepEqual(result[0], api[0]);
      else assert.equal(result[0].data.returnAt, Date.parse('2026-11-25T02:00:00Z'));
    } finally {
      stop();
    }
  }
});

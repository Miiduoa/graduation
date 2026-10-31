const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');

// Exercise the real scraper and request construction without school credentials.
function reader(responses) {
  const calls = [];
  const transport = {
    request(options, callback) {
      const entry = { options, body: null }; calls.push(entry);
      const req = new EventEmitter();
      req.write = (body) => { entry.body = body.toString(); };
      req.destroy = () => {};
      req.end = () => {
        process.nextTick(() => {
          const fixture = responses[calls.indexOf(entry)];
          if (!fixture) return req.emit('error', new Error('Unexpected extra school request'));
          const result = typeof fixture === 'function' ? fixture(entry) : fixture;
          const res = new EventEmitter();
          res.statusCode = result.status ?? 200; res.headers = {};
          callback(res);
          res.emit('data', Buffer.from(JSON.stringify(result.data ?? {})));
          res.emit('end');
        });
      };
      return req;
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'tronClassScraper.js'), 'utf8'), {
    module, require: (name) => {
      if (name === 'https') return transport;
      if (name === './lib/puCampusTransport') {
        // The production transport now supports an optional relay; keep this
        // sandbox's real HTTP construction on the injected HTTPS fixture.
        return { sendWithCampusFetch: async () => null, setCampusHttpFetch: () => {} };
      }
      throw new Error('Unexpected dependency in isolated scraper: ' + name);
    },
    URL, URLSearchParams, Buffer, setTimeout, clearTimeout,
    console: { log() {}, warn() {} },
  }, { filename: 'tronClassScraper.js' });
  return { calls, fetch: () => module.exports.tcFetchCourses({ session: 'synthetic-test-only' }, { userId: 9 }) };
}
const course = (id) => ({ id, name: `課程 ${id}`, course_code: String(id).padStart(4, '0') });
const page = (id, pages) => ({ data: { courses: [course(id)], ...(pages === undefined ? {} : { pages }) } });

for (const legacy of [false, true]) {
  const prefix = legacy ? [{ status: 404 }] : [];
  test(`${legacy ? '備援' : '主要'}來源：保留先前總頁數，不因中途缺欄位而漏掉第三頁`, async () => {
    const r = reader([...prefix, page(1, 3), page(2), page(3)]);
    const rows = await r.fetch();
    assert.equal(JSON.stringify(rows.map((row) => row.id)), '[1,2,3]');
    assert.equal(r.calls.length, prefix.length + 3);
  });
  test(`${legacy ? '備援' : '主要'}來源：宣告的最後一頁為空不能當完整清單`, async () => {
    const r = reader([...prefix, page(1, 2), { data: { courses: [], pages: 2 } }]);
    await assert.rejects(r.fetch(), { code: 'TC_COURSES_INVALID' });
    assert.equal(r.calls.length, prefix.length + 2);
  });
  test(`${legacy ? '備援' : '主要'}來源：中途空頁且缺少總頁數不能回傳部分資料`, async () => {
    const r = reader([...prefix, page(1, 3), { data: { courses: [] } }]);
    await assert.rejects(r.fetch(), { code: 'TC_COURSES_INVALID' });
    assert.equal(r.calls.length, prefix.length + 2);
  });
}
for (const next of [1, 3, '3']) {
  test(`讀取期間總頁數改成 ${JSON.stringify(next)} 時要求整次重讀`, async () => {
    const r = reader([page(1, 2), page(2, next)]);
    await assert.rejects(r.fetch(), { code: 'TC_COURSES_INVALID' });
    assert.equal(r.calls.length, 2);
  });
}
test('同一回應兩個總頁數欄位矛盾時不任選其中之一', async () => {
  const r = reader([{ data: { courses: [course(1)], pages: 1, paging: { pages: 2 } } }]);
  await assert.rejects(r.fetch(), { code: 'TC_COURSES_INVALID' });
  assert.equal(r.calls.length, 1);
});
test('總頁數延後出現但小於目前頁碼時，不認定清單完整', async () => {
  const r = reader([{ data: { courses: Array.from({ length: 50 }, (_, i) => course(i + 1)) } }, page(51, 1)]);
  await assert.rejects(r.fetch(), { code: 'TC_COURSES_INVALID' });
});
test('數字與等值數字字串不是頁數變動', async () => {
  const r = reader([page(1, 2), page(2, '2')]);
  assert.equal((await r.fetch()).length, 2);
});
test('允許第一頁明確為空，不以錯誤假造資料', async () => {
  for (const pages of [0, 1, undefined]) {
    const r = reader([{ data: { courses: [], ...(pages === undefined ? {} : { pages }) } }]);
    assert.equal((await r.fetch()).length, 0); assert.equal(r.calls.length, 1);
  }
});
test('沒有頁數的滿頁仍繼續讀到真正空頁', async () => {
  const r = reader([{ data: { courses: Array.from({ length: 50 }, (_, i) => course(i + 1)) } }, { data: { courses: [] } }]);
  assert.equal((await r.fetch()).length, 50); assert.equal(r.calls.length, 2);
});
test('備援請求帶上學期欄位，校方回傳的學期不在正規化時遺失', async () => {
  const r = reader([{ status: 404 }, ({ options }) => {
    const fields = new URL(options.path, 'https://tronclass.pu.edu.tw').searchParams.get('fields');
    return { data: { courses: [{ ...course(1), ...(fields?.split(',').includes('semester')
      ? { semester: { name: '115學年度第一學期' } } : {}) }], pages: 1 } };
  }]);
  const rows = await r.fetch(); assert.equal(rows[0].semester.name, '115學年度第一學期');
});
test('頁面讀取中授權失效，不回傳已取得的前幾頁，也不改走備援', async () => {
  const r = reader([page(1, 2), { status: 401 }]);
  await assert.rejects(r.fetch(), /session 已失效/); assert.equal(r.calls.length, 2);
});
test('總頁數上限仍為 20，不放寬既有來源限制', async () => {
  const r = reader([page(1, 21)]);
  await assert.rejects(r.fetch(), { code: 'TC_COURSES_INVALID' }); assert.equal(r.calls.length, 1);
});
test('重複課堂識別仍拒絕，不用去重掩蓋重複頁面', async () => {
  const r = reader([page(1, 2), page(1, 2)]);
  await assert.rejects(r.fetch(), /repeated course page/);
});

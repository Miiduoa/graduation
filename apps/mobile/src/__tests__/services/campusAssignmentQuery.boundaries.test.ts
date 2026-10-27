import { strict as assert } from 'node:assert';
import {
  ASSIGNMENT_WORKBENCH_PAGE_SIZE, assignmentDeadlineLabel, assignmentDueTime,
  queryCampusAssignments, type CampusAssignmentRow,
} from '../../services/campusAssignmentQuery';

// 固定台灣 10/28 00:30，不依賴執行測試當天或執行器所在時區。
const NOW = Date.parse('2026-10-28T00:30:00+08:00');
type Query = Parameters<typeof queryCampusAssignments>[0];
function row(title: string, dueAt: string | null = null, groupName = '資料庫'): CampusAssignmentRow {
  return { title, dueAt, groupName };
}
function query(items: readonly CampusAssignmentRow[], overrides: Partial<Omit<Query, 'items'>> = {}) {
  return queryCampusAssignments({ items, query: '', filter: 'all', sort: 'deadline', page: 0,
    now: NOW, ...overrides });
}
function titles(result: ReturnType<typeof query>) {
  return result.rows.map(({ assignment }) => assignment.title);
}

test('台灣今日包含當天已逾期作業，但不包含前一日或隔日', () => {
  const result = query([
    row('昨天', '2026-10-27T15:59:59.999Z'),
    row('今日已逾期', '2026-10-27T16:00:00Z'),
    row('今日晚上', '2026-10-28T15:59:59.999Z'),
    row('明天', '2026-10-28T16:00:00Z'), row('未知'),
  ], { filter: 'today' });
  assert.deepEqual(titles(result), ['今日已逾期', '今日晚上']);
  assert.deepEqual(result.rows.map(({ overdue }) => overdue), [true, false]);
});

test('七日以台灣日曆邊界計算，不是從現在起算 168 小時', () => {
  const result = query([
    row('已逾期', new Date(NOW - 1).toISOString()),
    row('此刻截止', new Date(NOW).toISOString()),
    row('第七日最後', '2026-11-03T23:59:59.999+08:00'),
    row('第八日', '2026-11-04T00:00:00+08:00'),
    row('168小時內但已跨第八日', '2026-11-04T00:29:59+08:00'), row('未提供'),
  ], { filter: 'seven-days' });
  assert.deepEqual(titles(result), ['此刻截止', '第七日最後']);
  assert.ok(result.rows.every(({ overdue }) => !overdue));
});

test('只有早於現在的有效期限才歸入逾期', () => {
  const result = query([
    row('過期', new Date(NOW - 1).toISOString()), row('此刻', new Date(NOW).toISOString()),
    row('稍後', new Date(NOW + 1).toISOString()), row('未提供'), row('無效', 'not-a-date'),
  ], { filter: 'overdue' });
  assert.deepEqual(titles(result), ['過期']);
});

test('未知或無效日期保留未知，不偽造為逾期或今天', () => {
  const items = [row('未知'), row('無效', 'not-a-date'), row('今天', new Date(NOW).toISOString())];
  const result = query(items, { filter: 'undated' });
  assert.deepEqual(titles(result), ['未知', '無效']);
  assert.ok(result.rows.every(({ overdue }) => !overdue));
});

test('截止排序保留相同時間與未知時間的原始次序', () => {
  const due = new Date(NOW + 1).toISOString();
  const result = query([row('未知一'), row('同時一', due), row('更早', new Date(NOW).toISOString()),
    row('同時二', due), row('未知二')]);
  assert.deepEqual(titles(result), ['更早', '同時一', '同時二', '未知一', '未知二']);
});

test('課程排序先正規化課名，同課再依期限與原始次序排序', () => {
  const result = query([
    row('B', null, 'B'), row('A較晚', new Date(NOW + 1000).toISOString(), 'Ａ'),
    row('a較早', new Date(NOW).toISOString(), 'a'), row('A未知', null, 'A'),
  ], { sort: 'course' });
  assert.deepEqual(titles(result), ['a較早', 'A較晚', 'A未知', 'B']);
});

test('搜尋支援全半形、大小寫、空白與跨標題課名的全部關鍵字', () => {
  const result = query([row('Final Report', null, 'Database'), row('Final Quiz', null, 'Database'),
    row('Report', null, 'Statistics')], { query: '  ＤＡＴＡＢＡＳＥ\u3000REPORT\t' });
  assert.deepEqual(titles(result), ['Final Report']);
});

for (const term of ['[a-z]+.*', '(a+)+$', '<script>', '.*']) {
  test(`搜尋將 ${term} 當成一般文字，不當成正規表示式或程式`, () => {
    const result = query([row(`原文 ${term}`), row('普通作業')], { query: term });
    assert.deepEqual(titles(result), [`原文 ${term}`]);
  });
}

test('搜尋在分頁前比對全部已載入資料，不漏掉第 12 筆之後的結果', () => {
  const items = Array.from({ length: 40 }, (_, index) => row(`作業-${index}`));
  const result = query(items, { query: '作業-39' });
  assert.equal(result.loaded, 40);
  assert.equal(result.matched, 1);
  assert.deepEqual(titles(result), ['作業-39']);
});

test('分頁逐筆保留 25 份作業，不重複、不漏列、不把頁面數當總數', () => {
  const items = Array.from({ length: 25 }, (_, index) => row(`作業-${index}`));
  const pages = [0, 1, 2].map((page) => query(items, { page }));
  assert.equal(ASSIGNMENT_WORKBENCH_PAGE_SIZE, 12);
  assert.deepEqual(pages.map(({ start, end, rows }) => [start, end, rows.length]),
    [[1, 12, 12], [13, 24, 12], [25, 25, 1]]);
  assert.ok(pages.every(({ loaded, matched, pageCount }) => loaded === 25 && matched === 25 && pageCount === 3));
  assert.deepEqual(pages.flatMap(titles), items.map(({ title }) => title));
  assert.equal(new Set(pages.flatMap(({ rows }) => rows.map(({ key }) => key))).size, 25);
});

for (const page of [-3, NaN, Infinity, -Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
  test(`無效頁碼 ${String(page)} 安全回到第一頁`, () => {
    const items = Array.from({ length: 25 }, (_, index) => row(`作業-${index}`));
    assert.equal(query(items, { page }).page, 0);
  });
}

test('過大但有效的頁碼收斂到最後一頁', () => {
  const result = query(Array.from({ length: 25 }, (_, index) => row(`作業-${index}`)), { page: 100 });
  assert.equal(result.page, 2);
  assert.deepEqual(titles(result), ['作業-24']);
});

test('篩選後頁碼重新收斂，但 loaded 仍是原本載入數', () => {
  const items = Array.from({ length: 25 }, (_, index) => row(`作業-${index}`));
  const result = query(items, { query: '作業-24', page: 2 });
  assert.equal(result.page, 0);
  assert.equal(result.pageCount, 1);
  assert.equal(result.loaded, 25);
  assert.equal(result.matched, 1);
  assert.deepEqual(titles(result), ['作業-24']);
});

test('沒有搜尋結果時回傳空區間，不偽造第 1 筆或負數範圍', () => {
  assert.deepEqual(query([row('作業')], { query: '不存在', page: 7 }), {
    loaded: 1, matched: 0, page: 0, pageCount: 1, start: 0, end: 0, rows: [],
  });
  assert.equal(query([]).loaded, 0);
});

test('同名且沒有來源 ID 的舊作業仍是不同列，不依標題去重', () => {
  const items = [row('同名'), row('同名'), row('同名')];
  const result = query(items);
  assert.equal(result.matched, 3);
  assert.equal(new Set(result.rows.map(({ key }) => key)).size, 3);
  result.rows.forEach(({ assignment }, index) => assert.equal(assignment, items[index]));
});

test('查詢與排序不修改來源陣列或作業欄位', () => {
  const items = Object.freeze([Object.freeze(row('B', null, 'B')),
    Object.freeze(row('A', new Date(NOW).toISOString(), 'A'))]);
  const original = JSON.stringify(items);
  assert.deepEqual(titles(query(items, { sort: 'course' })), ['A', 'B']);
  assert.equal(JSON.stringify(items), original);
  assert.equal(items[0].title, 'B');
});

for (const now of [NaN, Infinity, -Infinity]) {
  test(`無效現在時間 ${String(now)} 明確失敗，不回傳看似有效的作業統計`, () => {
    assert.throws(() => query([], { now }), /invalid-assignment-query-time/);
  });
}

test('不論來源使用 UTC 或明確時差，同一時間點得到相同結果', () => {
  assert.equal(assignmentDueTime('2026-10-28T00:00:00+08:00'),
    assignmentDueTime('2026-10-27T16:00:00Z'));
  assert.equal(assignmentDueTime('not-a-date'), null);
  assert.equal(assignmentDueTime(null), null);
});

test('期限標籤用台灣時間顯示午夜，並明確區分逾期與此刻截止', () => {
  const label = assignmentDeadlineLabel(row('午夜', '2026-10-27T16:00:00Z'), NOW);
  assert.ok(label.startsWith('期限已過 · '));
  assert.ok(label.includes('10/28'));
  assert.ok(label.includes('00:00'));
  assert.ok(assignmentDeadlineLabel(row('此刻', new Date(NOW).toISOString()), NOW).startsWith('截止 '));
  assert.equal(assignmentDeadlineLabel(row('未知'), NOW), '截止日期未提供，請核對原始作業頁');
});

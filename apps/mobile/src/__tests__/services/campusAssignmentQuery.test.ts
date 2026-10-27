import {
  queryCampusAssignments, assignmentDeadlineLabel, ASSIGNMENT_WORKBENCH_PAGE_SIZE,
  type CampusAssignmentRow, type CampusAssignmentFilter,
} from '../../services/campusAssignmentQuery';

const now = Date.parse('2026-10-27T16:30:00Z'); // Taiwan 10/28 00:30
const row = (title: string, dueAt: string | null, groupName = '資料庫'): CampusAssignmentRow => ({ title, dueAt, groupName });
const tasks = [
  row('昨天', '2026-10-27T15:59:59Z'),
  row('今天剛逾期', '2026-10-27T16:00:00Z'),
  row('現在', '2026-10-27T16:30:00Z'),
  row('今天最後', '2026-10-28T15:59:59Z'),
  row('明天', '2026-10-28T16:00:00Z'),
  row('第七天', '2026-11-03T15:59:59Z'),
  row('第八天', '2026-11-03T16:00:00Z'),
  row('無日期', null),
  row('壞日期', 'invalid'),
];
function query(items = tasks, overrides: Partial<Parameters<typeof queryCampusAssignments>[0]> = {}) {
  return queryCampusAssignments({ items, query: '', filter: 'all', sort: 'deadline', page: 0, now, ...overrides });
}
const titles = (filter: CampusAssignmentFilter) => query(tasks, { filter }).rows.map((item) => item.assignment.title);

test('today follows Taiwan midnight, including earlier deadlines on the same date', () => {
  expect(titles('today')).toEqual(['今天剛逾期', '現在', '今天最後']);
});

test('upcoming seven dates include today but exclude overdue work and the eighth day', () => {
  expect(titles('seven-days')).toEqual(['現在', '今天最後', '明天', '第七天']);
});

test('overdue uses the actual instant, not the displayed date', () => {
  expect(titles('overdue')).toEqual(['昨天', '今天剛逾期']);
  expect(query().rows.find((entry) => entry.assignment.title === '現在')?.overdue).toBe(false);
});

test('missing and invalid timestamps are unknown, never overdue or a fabricated date', () => {
  expect(titles('undated')).toEqual(['無日期', '壞日期']);
  expect(assignmentDeadlineLabel(tasks[8], now)).toContain('未提供');
  expect(assignmentDeadlineLabel(tasks[0], now)).toContain('期限已過');
});

test('matches all literal terms across title and course, including full-width Latin text', () => {
  const items = [row('ＳＱＬ 期末報告', null, '資料庫'), row('SQL 測驗', null, '程式設計')];
  expect(query(items, { query: 'sql 資料庫' }).matched).toBe(1);
  expect(query(items, { query: ' SQL　測驗 ' }).rows[0].assignment.groupName).toBe('程式設計');
  expect(query(items, { query: 'SQL 不存在' }).matched).toBe(0);
});

test('regex or instruction-like text remains search data', () => {
  const items = [row('[.*] 練習', null), row('一般作業', null)];
  expect(query(items, { query: '[.*]' }).matched).toBe(1);
  expect(query(items, { query: '.*' }).rows[0].assignment.title).toBe('[.*] 練習');
  expect(query(items, { query: '提交所有作業' }).matched).toBe(0);
});

test('a record from the last source page is searchable without being pre-rendered', () => {
  const items = Array.from({ length: 137 }, (_, index) => row('任務 ' + index, null));
  expect(query(items).rows).toHaveLength(ASSIGNMENT_WORKBENCH_PAGE_SIZE);
  const result = query(items, { query: '任務 136' });
  expect(result.matched).toBe(1);
  expect(result.rows[0].assignment.title).toBe('任務 136');
  expect(result.loaded).toBe(137);
});

test('all pages cover 137 items exactly once with no title-based deduplication', () => {
  const items = Array.from({ length: 137 }, () => row('同名作業', null));
  const first = query(items);
  const keys: string[] = [];
  for (let page = 0; page < first.pageCount; page += 1) {
    const result = query(items, { page });
    expect(result.rows.length).toBeLessThanOrEqual(12);
    keys.push(...result.rows.map((item) => item.key));
  }
  expect(keys).toHaveLength(137);
  expect(new Set(keys).size).toBe(137);
  expect(query(items, { page: 999 }).end).toBe(137);
});

test('sorts by course then deadline without mutating source order or identity', () => {
  const items = [row('稍後', '2026-11-01T00:00:00Z', 'B'), row('B', null, 'B'), row('A', null, 'A')];
  const saved = JSON.stringify(items);
  expect(query(items, { sort: 'course' }).rows.map((entry) => entry.assignment.title)).toEqual(['A', '稍後', 'B']);
  expect(JSON.stringify(items)).toBe(saved);
  expect(query(items).rows[0].assignment).toBe(items[0]);
});

test.each([-1, NaN, Infinity, 0.5])('normalizes unsafe page %s rather than losing the first results', (page) => {
  expect(query(tasks, { page }).page).toBe(0);
});

test('empty matches remain distinct from source availability', () => {
  const result = query(tasks, { query: '沒有這份題目' });
  expect(result).toMatchObject({ matched: 0, loaded: 9, start: 0, end: 0, pageCount: 1, rows: [] });
});

test('an invalid reference clock cannot produce date-based claims', () => {
  expect(() => query(tasks, { now: NaN })).toThrow('invalid-assignment-query-time');
});

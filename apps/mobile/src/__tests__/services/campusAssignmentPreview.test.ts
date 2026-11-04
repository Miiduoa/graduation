import { assignmentFollowUp } from '../../services/assignmentFollowUp';
import { runOfflineCampusTool } from '../../services/offlineCampusTools';
import type { CampusSenseSnapshot } from '../../services/campusSenseSnapshot';
import type { OnDeviceSchoolContext } from '../../services/onDeviceSchoolContext';

const checkedAt = '2026-10-27T01:00:00Z';
const context: OnDeviceSchoolContext = {
  schoolId: 'pu', schoolName: '靜宜大學', checkedAt,
  timetable: { source: 'not-available', updatedAt: null, courses: [] },
};
function snapshot(loaded: number, total = loaded): CampusSenseSnapshot {
  return {
    userId: 'A', schoolId: 'pu', checkedAt,
    schedule: { status: 'unavailable', count: null },
    announcements: { status: 'unavailable', items: [] },
    assignments: {
      status: 'available', count: total,
      items: Array.from({ length: loaded }, (_, i) => ({
        title: '課程作業 ' + i, groupName: '資料庫', dueAt: null,
      })),
    },
  };
}
const answer = (loaded: number, total = loaded) =>
  runOfflineCampusTool('我有哪些作業還沒交？', context, snapshot(loaded, total), 'A')?.content ?? '';

test('a fully synced list still discloses the eight-row text preview limit', () => {
  const content = answer(137);
  expect(content).toContain('待交作業：137 筆');
  expect(content.split('\n').filter((line) => /^\d+\. /.test(line))).toHaveLength(8);
  expect(content).toContain('第 1–8 筆，共 137 筆符合');
  expect(content).toContain('下一頁');
  expect(content).not.toContain('尚未同步');
});

test('hidden loaded rows are counted separately from rows never obtained', () => {
  const content = answer(50, 70);
  expect(content).toContain('第 1–8 筆，共 50 筆符合');
  expect(content).toContain('另有 20 筆尚未同步，未納入本機規劃');
});

test('no loaded rows is not a verified empty workload when the source total is positive', () => {
  const content = answer(0, 12);
  expect(content).toContain('另有 12 筆尚未同步');
  expect(content).not.toContain('0 筆。');
});

test('a complete short list has no phantom missing-work warning', () => {
  const content = answer(3);
  expect(content.split('\n').filter((line) => /^\d+\. /.test(line))).toHaveLength(3);
  expect(content).not.toContain('下一頁');
  expect(content).not.toContain('尚未同步');
});

test('partial coverage keeps page ranges separate from rows the phone has not synced', () => {
  const source = snapshot(17, 24);
  const question = '我有哪些作業還沒交？';
  const pages = [0, 8, 16].map((offset) =>
    runOfflineCampusTool(question, context, source, 'A', question, { offset, asOf: Date.parse(checkedAt) }));
  expect(pages.map((p) => p?.assignmentRead?.items.length)).toEqual([8, 8, 1]);
  expect(pages.flatMap((p) => p!.assignmentRead!.items)).toEqual(source.assignments.items);
  expect(pages[2]?.content).toContain('第 17 筆，共 17 筆符合');
  expect(pages[2]?.content).toContain('7 筆尚未同步');
  expect(pages[2]?.content).not.toContain('回覆「下一頁」');
});

test('relative date paging stays on the original Taiwan day and stops when the snapshot expires', () => {
  const start = '2026-11-04T15:59:00Z';
  const source = { ...snapshot(10), checkedAt: start };
  source.assignments.items = source.assignments.items.map((item, index) =>
    ({ ...item, dueAt: index === 0 ? '2026-11-05T17:00:00Z' : '2026-11-05T12:00:00Z' }));
  const question = '明天有哪些作業？';
  const first = runOfflineCampusTool(question, { ...context, checkedAt: start }, source, 'A');
  const page = { asOf: first!.assignmentRead!.page!.asOf, offset: 8 };
  const afterMidnight = { ...context, checkedAt: '2026-11-04T16:01:00Z' };
  const next = runOfflineCampusTool(question, afterMidnight, source, 'A', question, page);
  expect(next?.assignmentRead?.items).toEqual([source.assignments.items[9]]);
  expect(next?.content).toContain('第 9 筆，共 9 筆符合');
  const expired = { ...context, checkedAt: '2026-11-04T16:15:00Z' };
  expect(runOfflineCampusTool(question, expired, source, 'A', question, page)?.tool).toBe('online-required');
});


test('paging preserves a reminder choice without arming a reminder on a new query', () => {
  const source = snapshot(17);
  const now = Date.parse(checkedAt);
  const first = runOfflineCampusTool('我有哪些待交作業？', context, source, 'A')!.assignmentRead;
  const pick = assignmentFollowUp('幫我設提醒', first, source, now);
  if (!pick || !('reply' in pick)) throw new Error('Expected to choose a specific assignment first');
  const more = assignmentFollowUp('還有其他的嗎？', pick.reply.assignmentRead, source, now);
  if (!more || !('question' in more)) throw new Error('Expected the next page of the same query');
  const next = runOfflineCampusTool(more.question, context, source, 'A', more.filter, more.page)!.assignmentRead;
  const selected = assignmentFollowUp('第二個', next, source, now);
  expect(selected).toMatchObject({ reply: { assignmentRead: { items: [source.assignments.items[9]], reviewReminder: true } } });
  const tomorrow = assignmentFollowUp('那明天呢？', next, source, now);
  expect(tomorrow).toMatchObject({ question: '明天有哪些待交作業？' });
  expect(tomorrow).not.toHaveProperty('page');
});

test('jumps to bounded result pages without treating a page number as an assignment selection', () => {
  const source = snapshot(87);
  const read = runOfflineCampusTool('我有哪些作業？', context, source, 'A')!.assignmentRead;
  const query = (question: string) => assignmentFollowUp(question, read, source, Date.parse(checkedAt));
  for (const input of ['第十一頁', '最後一頁']) expect(query(input)).toMatchObject({ page: { offset: 80 } });
  expect(query('第３頁')).toMatchObject({ page: { offset: 16 } });
  expect(query('回到第一頁')).toMatchObject({ page: { offset: 0 } });
  for (const input of ['第0頁', '第十二頁', '第一百頁']) {
    expect(query(input)).toMatchObject({ reply: { content: expect.stringContaining('共 11 頁'), assignmentRead: read } });
  }
});

// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { V2Error, type Model } from './contracts';
import { directReads } from './directRead';
import { fixtureAdapter, fixtureBinding, FIXTURE_NOW as now, FIXTURE_SECRET as secret } from './fixtures';
import { run } from './runner';

const usage = { prompt_tokens: 40, completion_tokens: 20, total_tokens: 60 };
const vagueModel: Model = async () => ({
  message: { role: 'assistant', content: '請開啟相關頁面查看。' }, usage,
});
function ask(question: string, fixture = fixtureAdapter(), model: Model = vagueModel, signal = new AbortController().signal) {
  return run({ question, history: [], binding: { ...fixtureBinding, conversationId: crypto.randomUUID() },
    adapter: fixture.adapter, secret, now, writes: true, signal, log: () => {}, model });
}

it('answers the actual timetable immediately without asking a model to choose a page or tool', async () => {
  const fixture = fixtureAdapter();
  const ledger = vi.spyOn(fixture.adapter, 'ledger');
  const courses = vi.spyOn(fixture.adapter, 'courses');
  const realms = vi.spyOn(fixture.adapter, 'realms');
  const model = vi.fn(vagueModel);
  const result = await ask('我今天有什麼課', fixture, model);
  expect(result.answer).toContain('09:00–10:00　程式設計｜資訊101');
  expect(result.answer).toContain('13:00–15:00　資料結構｜資訊202');
  expect(result.answer).not.toContain('開啟相關頁面');
  expect(result.steps).toContainEqual(expect.objectContaining({ name: 'get_schedule', status: 'ok' }));
  expect(result.cards).toEqual([]);
  expect(fixture.writes).toEqual([]);
  expect(ledger).toHaveBeenCalledOnce();
  expect(courses).not.toHaveBeenCalled();
  expect(realms).not.toHaveBeenCalled();
  expect(model).not.toHaveBeenCalled();
  expect(result.modelCalls).toBe(0);
  expect(result.usage.total_tokens).toBe(0);
  expect(result).toHaveProperty('dataRead', true);
});

it('finds the next future class and its room instead of repeating the first class of the day', async () => {
  const result = await ask('下一堂在哪');
  expect(result.answer).toContain('下一堂課');
  expect(result.answer).toContain('13:00–15:00　資料結構｜資訊202');
  expect(result.answer).not.toMatch(/程式設計|語文館/);
  const tomorrow = await ask('明天下一堂在哪');
  expect(tomorrow.answer).toContain('明天（2026-11-05）');
  expect(tomorrow.answer).toContain('09:00–11:00　英文｜語文館');
  expect(tomorrow.answer).not.toContain('資料結構');
});

it('lists remaining work with real deadlines, excluding submitted work and keeping undated work visible', async () => {
  const fixture = fixtureAdapter();
  const original = fixture.adapter.work;
  fixture.adapter.work = async (id) => [...await original(id), {
    id: 'undated', courseId: 'course-a', kind: 'assignment', title: '未定日期報告',
    dueAt: null, state: 'open', submitted: false,
  }];
  const ledger = vi.spyOn(fixture.adapter, 'ledger');
  const result = await ask('今天還有什麼作業沒交', fixture);
  expect(result.answer).toContain('樹與圖作業｜截止 2026-11-05 23:59');
  expect(result.answer).toContain('程式練習｜截止 2026-11-07 23:59');
  expect(result.answer).toContain('未定日期報告');
  expect(result.answer).not.toContain('已交報告');
  expect(result.answer).toContain('2026-11-04 至 2026-11-10');
  expect(ledger).not.toHaveBeenCalled();
  expect(result.cards).toEqual([]);
});

it('uses tomorrow in Taipei for a calendar query without loading class workspaces', async () => {
  const fixture = fixtureAdapter();
  const ledger = await fixture.adapter.ledger();
  ledger.records.push({ ...ledger.records[0], id: 'tomorrow-meeting', kind: 'events', title: '專題討論',
    date: '2026-11-05', allDay: false, startTime: '18:00', endTime: '19:00' });
  fixture.adapter.ledger = async () => ledger;
  const courses = vi.spyOn(fixture.adapter, 'courses');
  const result = await ask('明天有哪些行程', fixture);
  expect(result.answer).toContain('明天（2026-11-05）');
  expect(result.answer).toContain('專題討論｜18:00–19:00');
  expect(result.answer).not.toContain('讀書會');
  expect(courses).not.toHaveBeenCalled();
});

it('does not list an all-day event on its exclusive end date', async () => {
  const fixture = fixtureAdapter();
  const ledger = await fixture.adapter.ledger();
  ledger.records.push({ ...ledger.records[0], id: 'all-day', kind: 'events', title: '全天校外參訪',
    date: '2026-11-04', endDate: '2026-11-05', allDay: true, startTime: undefined, endTime: undefined });
  fixture.adapter.ledger = async () => ledger;
  expect((await ask('今天有哪些行程', fixture)).answer).toContain('全天校外參訪｜全天');
  expect((await ask('明天有哪些行程', fixture)).answer).not.toContain('全天校外參訪');
});

it('keeps a timed overnight event on the date it still overlaps', async () => {
  const fixture = fixtureAdapter();
  const ledger = await fixture.adapter.ledger();
  ledger.records.push({ ...ledger.records[0], id: 'overnight', kind: 'events', title: '跨日專題討論',
    date: '2026-11-04', endDate: '2026-11-05', allDay: false, startTime: '23:00', endTime: '01:00' });
  fixture.adapter.ledger = async () => ledger;
  const result = await ask('明天有哪些行程', fixture);
  expect(result.answer).toContain('跨日專題討論｜2026-11-04 23:00–2026-11-05 01:00');
  expect(result.modelCalls).toBe(0);
});

it('answers a combined timetable and pending-work question from both sources in the same reply', async () => {
  const fixture = fixtureAdapter();
  const model = vi.fn(vagueModel);
  const result = await ask('今天的課表和還沒交的作業', fixture, model);
  expect(result.answer).toContain('程式設計｜資訊101');
  expect(result.answer).toContain('樹與圖作業｜截止 2026-11-05 23:59');
  expect(result.steps.map((step) => step.name)).toEqual(['get_schedule', 'get_due_work']);
  expect(result.cards).toEqual([]);
  expect(fixture.writes).toEqual([]);
  expect(model).not.toHaveBeenCalled();
});

it.each([
  ['下一堂課在哪，幾點', ['get_schedule'], ['資料結構｜資訊202']],
  ['今天有什麼課，還有什麼作業沒交', ['get_schedule', 'get_due_work'], ['程式設計｜資訊101', '樹與圖作業']],
  ['今天的課表；行程與未繳作業', ['get_schedule', 'get_calendar', 'get_due_work'], ['程式設計｜資訊101', '讀書會', '樹與圖作業']],
] as const)('keeps complete supported read clauses deterministic despite punctuation: %s', async (question, expectedTools, facts) => {
  const model = vi.fn(vagueModel);
  const result = await ask(question, fixtureAdapter(), model);
  expect(result.steps.map((step) => step.name)).toEqual(expectedTools);
  for (const fact of facts) expect(result.answer).toContain(fact);
  expect(result.modelCalls).toBe(0);
  expect(model).not.toHaveBeenCalled();
  expect(result.cards).toEqual([]);
});

it('keeps factual queries independent of provider outages and model claims', async () => {
  const offline = vi.fn(async () => { throw new V2Error(429, 'PROVIDER_RATE_LIMITED'); });
  const unavailable = await ask('我今天有什麼課', fixtureAdapter(), offline);
  expect(unavailable.answer).toContain('資料結構｜資訊202');
  expect(offline).not.toHaveBeenCalled();
  const unreliable = vi.fn(async () => ({
    message: { role: 'assistant', content: '今天只有量子物理，地點外校999。' }, usage,
  }));
  const hallucinated = await ask('我今天有什麼課', fixtureAdapter(), unreliable);
  expect(unreliable).not.toHaveBeenCalled();
  expect(hallucinated.answer).not.toMatch(/量子物理|外校999/);
  expect(hallucinated.answer).toContain('程式設計');
});

it('does not turn unavailable, unplaced or partly queried sources into a claim of no work', async () => {
  const unavailable = fixtureAdapter();
  unavailable.adapter.ledger = async () => { throw new V2Error(503, 'SOURCE_UNAVAILABLE'); };
  const failed = await ask('我今天有什麼課', unavailable);
  expect(failed.answer).toContain('目前無法讀取已同步課表');
  expect(failed.answer).not.toMatch(/今天沒有課|沒有課程紀錄/);

  const incomplete = fixtureAdapter();
  const ledger = await incomplete.adapter.ledger();
  delete ledger.records[0].startTime;
  delete ledger.records[0].endTime;
  incomplete.adapter.ledger = async () => ledger;
  const unplaced = await ask('我今天有什麼課', incomplete);
  expect(unplaced.answer).toContain('另有 1 筆課表缺少可定位的日期或節次');
  expect(unplaced.answer).toContain('資料結構');

  const partial = fixtureAdapter();
  partial.adapter.courses = async () => ({ courses: [{ id: 'course-a', title: '可讀課程' }, { id: 'private', title: '尚未讀取課程' }], partial: false });
  const original = partial.adapter.work;
  partial.adapter.work = async (id) => id === 'private'
    ? Promise.reject(new V2Error(403, 'FORBIDDEN_SCOPE')) : original(id);
  const work = await ask('今天還有什麼作業沒交', partial);
  expect(work.answer).toContain('樹與圖作業');
  expect(work.answer).toContain('仍有課程未完成查詢：尚未讀取課程');
  expect(work.answer).toContain('以上不是完整清單');
});

it('revalidates school scope and propagates revoked authentication without returning private facts', async () => {
  const foreign = fixtureAdapter();
  const ledger = await foreign.adapter.ledger();
  foreign.adapter.ledger = async () => ({ ...ledger, schoolId: 'other-school' });
  const result = await ask('我今天有什麼課', foreign);
  expect(result.answer).toContain('目前無法讀取');
  expect(result.answer).not.toContain('程式設計');

  const revoked = fixtureAdapter();
  revoked.adapter.ledger = async () => { throw new V2Error(401, 'SESSION_REVOKED'); };
  await expect(ask('我今天有什麼課', revoked)).rejects.toMatchObject({ status: 401 });
});

it('cancels a pending read and never returns its late result', async () => {
  const fixture = fixtureAdapter();
  const controller = new AbortController();
  const ledger = await fixture.adapter.ledger();
  let finish!: (value: typeof ledger) => void;
  fixture.adapter.ledger = async () => new Promise((resolve) => { finish = resolve; });
  const model = vi.fn(vagueModel);
  const result = ask('我今天有什麼課', fixture, model, controller.signal);
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  controller.abort();
  finish(ledger);
  await expect(result).rejects.toMatchObject({ status: 499 });
  expect(model).not.toHaveBeenCalled();
});

it.each([
  '打開課表', '不要讀我的課表', '翻譯「今天有什麼課」', '如果我問今天有什麼課呢',
  '明天下午有什麼課', '下週三有什麼課', '2026-02-30 有什麼課',
  '幫我明天 19:00 到 20:00 安排英文讀書', '今天的課表有哪些功能',
  '明天有哪些行程，然後幫我傳訊息', '今天有哪些課，順便幫我預約',
  '今天有什麼課，也幫我把課表分享給小明', '今天有哪些作業沒交？幫我交掉',
  '我有哪些已繳作業', '今天作業繳了嗎', '今天有什麼課，空檔有哪些', '今天有課嗎，空堂在哪裡',
  '今天有哪些已繳和未繳作業', '我有哪些已提交的作業', '資料結構有哪些作業沒交', '微積分的作業沒交',
  '我有哪些已繳與未繳作業', '今天哪些作業交了，哪些還沒交',
  '取消今天的未繳作業提醒', '幫我交掉今天未繳的作業',
  '有哪些作業沒交，只看資料結構', '今天有哪些作業已經提交',
  '今天有什麼課，教室怎麼走', '下一堂課教室怎麼走',
  '今天有什麼課，走路去教室', '今天有什麼課，教室地圖在哪',
  '今天的課表和行程有衝突嗎', '程式設計今天幾點上課',
  '今天中午有什麼課', '今天夜間有什麼課', '只有資料結構今天有沒有課',
  '明天有哪些和小明的行程', '今天有什麼課，列印課表',
])('leaves navigation, negation, examples, ambiguous dates and writes to their existing handlers: %s', (question) => {
  expect(directReads(question, now)).toEqual([]);
});

it('still answers generic remaining-work questions with a due-work read', () => {
  expect(directReads('今天還有什麼作業沒交', now).map((read) => read.kind)).toEqual(['due-work']);
  expect(directReads('我有哪些作業沒交', now).map((read) => read.kind)).toEqual(['due-work']);
});

it('still answers a next-class place-and-time question that uses a comma', () => {
  expect(directReads('下一堂課在哪，幾點', now).map((read) => read.kind)).toEqual(['next-class']);
});

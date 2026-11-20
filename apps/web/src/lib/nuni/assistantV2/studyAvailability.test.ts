// @vitest-environment node
import { expect, it } from 'vitest';
import { confirm } from './actions';
import { fixtureAdapter, fixtureBinding as binding, FIXTURE_SECRET as secret } from './fixtures';
import { run } from './runner';
import { createTools } from './tools';

const day = '2026-11-04';
const at = (time: string) => Date.parse(day + 'T' + time + '+08:00');
const evening = at('19:30:20');

function askWithStaleSuggestion(question: string, now: number, f = fixtureAdapter()) {
  return run({
    question,
    now,
    binding,
    secret,
    writes: true,
    adapter: f.adapter,
    history: [],
    signal: new AbortController().signal,
    log: () => {},
    model: async () => ({
      message: { role: 'assistant', content: '建議早上 08:00–09:00。' },
      usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
    }),
  });
}

it('uses the remaining Taipei day for availability and confirmed study slots', async () => {
  const f = fixtureAdapter();
  const tools = createTools(f.adapter, binding, secret, evening, true);
  const expected = [{ date: day, startTime: '19:31', endTime: '22:00', minutes: 149 }];
  expect((await tools.call('find_free_time', { date: day })).value).toMatchObject({
    slots: expected,
  });
  expect((await tools.call('get_day_overview', { date: day })).value).toMatchObject({
    free: { slots: expected },
  });
  await tools.call('propose_study_plan', { date: day, minMinutes: 60 });
  expect(tools.cards.map(({ args }) => [args.startTime, args.endTime])).toEqual([
    ['19:31', '20:31'],
    ['20:31', '21:31'],
  ]);
  expect(f.writes).toHaveLength(0);
  const { token, args } = tools.cards[0];
  await confirm(binding, { token, args }, secret, evening, f.adapter, true, () => evening);
  expect(f.snapshot().records.at(-1)).toMatchObject({
    date: day,
    startTime: '19:31',
    endTime: '20:31',
  });
});

it('requires enough usable minutes before a class or an assignment deadline', async () => {
  const f = fixtureAdapter();
  const now = at('12:00:01');
  const tools = createTools(f.adapter, binding, secret, now, true);
  const range = { date: day, from: '11:00', to: '14:00', minMinutes: 60 };
  expect((await tools.call('find_free_time', range)).value).toMatchObject({ slots: [] });
  f.adapter.work = async () => [
    {
      id: 'due-soon',
      courseId: 'course-a',
      title: '上課前繳',
      dueAt: day + 'T13:00:00+08:00',
      kind: 'assignment',
      state: 'open',
      submitted: false,
    },
  ];
  expect((await tools.call('propose_study_plan', { date: day })).value).toMatchObject({
    planned: [],
    unplanned: 1,
  });
  expect(tools.cards).toHaveLength(0);
});

it('keeps historical free-time lookup and tomorrow’s slots while refusing past-day plans', async () => {
  const now = Date.parse('2026-11-04T16:00:01Z'); // 00:00:01 on Nov 5 in Taipei
  const tools = createTools(fixtureAdapter().adapter, binding, secret, now, true);
  expect((await tools.call('get_day_overview', { date: day })).value).toMatchObject({
    free: { slots: expect.arrayContaining([expect.objectContaining({ startTime: '08:00' })]) },
  });
  expect((await tools.call('propose_study_plan', { date: day })).value).toMatchObject({
    planned: [],
    unplanned: 2,
  });
  expect((await tools.call('find_free_time', { date: '2026-11-06' })).value).toMatchObject({
    slots: [expect.objectContaining({ startTime: '08:00' })],
  });
  expect(tools.cards).toHaveLength(0);
});

it('rechecks a prospective event before its first write but preserves replay and retrospective entries', async () => {
  const f = fixtureAdapter();
  const tools = createTools(f.adapter, binding, secret, evening, true);
  const event = { title: '讀書', date: day, startTime: '19:31', endTime: '20:31', allDay: false };
  await tools.call('propose_personal_event', event);
  const { token, args } = tools.cards[0];
  const later = at('19:32:00');
  await expect(
    confirm(binding, { token, args }, secret, evening, f.adapter, true, () => later),
  ).rejects.toMatchObject({ code: 'EVENT_START_PASSED' });
  expect(f.writes).toHaveLength(0);
  await confirm(binding, { token, args }, secret, evening, f.adapter, true, () => evening);
  await expect(
    confirm(binding, { token, args }, secret, later, f.adapter, true),
  ).resolves.toMatchObject({ replay: true });
  await tools.call('propose_personal_event', {
    ...event,
    title: '補記午餐',
    startTime: '12:00',
    endTime: '12:30',
  });
  expect(tools.cards).toHaveLength(2);
});

it.each([
  ['幫我安排今天讀書', at('21:30:01'), '找不到能在作業截止前完成的空檔'],
  ['今天早上八點幫我留一小時寫作業', evening, '指定的開始時間已過'],
])(
  'explains an unusable window without proposing another time for %s',
  async (question, now, message) => {
    const f = fixtureAdapter();
    const reply = await askWithStaleSuggestion(question, now, f);
    expect(reply.answer).toContain(message);
    expect(reply.cards).toHaveLength(0);
    expect(f.writes).toHaveLength(0);
  },
);

it.each([
  ['幫我安排今天讀書', day, '19:31'],
  ['幫我規劃 2026-11-05 的讀書時間', '2026-11-05', '08:00'],
  ['幫我安排明早八點讀書', '2026-11-05', '08:00'],
  ['幫我安排在昨天讀書', undefined, undefined],
  ['幫我安排在 2026-11-03 讀書', undefined, undefined],
])(
  'keeps the requested planning day when the model suggests a stale morning for %s',
  async (question, date, startTime) => {
    const reply = await askWithStaleSuggestion(question, evening);
    if (date) expect(reply.cards[0]?.args).toMatchObject({ date, startTime });
    else expect(reply.cards).toHaveLength(0);
  },
);

it('does not silently shift a requested morning into an available evening', async () => {
  const tools = createTools(
    fixtureAdapter().adapter,
    binding,
    secret,
    evening,
    true,
    false,
    '幫我安排今天早上讀書',
  );
  await expect(
    tools.call('propose_study_plan', { date: day, from: '19:00', to: '22:00' }),
  ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  expect(tools.cards).toHaveLength(0);
});

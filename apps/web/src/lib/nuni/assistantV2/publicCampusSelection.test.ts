// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { verifyCard } from './actions';
import { V2Error, type Model, type ModelResult, type Obj } from './contracts';
import { fixtureAdapter, fixtureBinding, FIXTURE_NOW as now, FIXTURE_SECRET as secret } from './fixtures';
import type { PublicCampusRead } from './publicCampus';
import { CAMPUS_EVENT_SELECTION_REQUIRED_MESSAGE, publicCampusEventTargets, publicEventCalendarSourceIntent } from './publicCampusSelection';
import { run } from './runner';
import { createTools } from './tools';

const eventArgs = { title: '攝影講座', date: '2026-11-05', allDay: false, startTime: '20:00', endTime: '21:00' };
const sourceQuestion = '查近期活動，並把第一個加入行程';
function read(): PublicCampusRead {
  return { version: 1, kind: 'events', schoolId: fixtureBinding.schoolId, source: 'school-club-events',
    sourcePath: `schools/${fixtureBinding.schoolId}/clubEvents`, checkedAt: new Date(now).toISOString(),
    status: 'ready', partial: false, href: `/events?schoolId=${fixtureBinding.schoolId}`,
    items: ['second-id', 'first-id'].map((id, index) => ({ id, schoolId: fixtureBinding.schoolId,
      title: '攝影講座', summary: '公開活動摘要', startsAt: `2026-11-05T${index ? '13' : '12'}:00:00.000Z`,
      ...(index ? {} : { endsAt: '2026-11-05T13:00:00.000Z' }),
      href: `/events/${id}?schoolId=${fixtureBinding.schoolId}&source=school-club-events` })) };
}
function setup(question = sourceQuestion) {
  const fixture = fixtureAdapter();
  fixture.adapter.publicCampus = vi.fn(async () => read());
  const binding = { ...fixtureBinding, conversationId: randomUUID() };
  return { fixture, binding, tools: createTools(fixture.adapter, binding, secret, now, true, false, question) };
}
const usage = { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 };
const response = (content = '請查看結果。'): ModelResult => ({ message: { role: 'assistant', content }, usage });
const calls = (...items: [string, Obj][]): ModelResult => ({ usage, message: { role: 'assistant', content: '',
  tool_calls: items.map(([name, args], index) => ({ id: `call-${index}`, type: 'function',
    function: { name, arguments: JSON.stringify(args) } })) } });
const sequenceModel = (...results: (ModelResult | Error)[]) => {
  let index = 0;
  return vi.fn<Model>(async () => {
    const result = results[index++] ?? response();
    if (result instanceof Error) throw result;
    return result;
  });
};
async function ask(question: string, model: Model, fixture = fixtureAdapter(), signal = new AbortController().signal) {
  fixture.adapter.publicCampus ||= vi.fn(async () => read());
  return run({ question, history: [], binding: { ...fixtureBinding, conversationId: randomUUID() },
    adapter: fixture.adapter, secret, now, writes: true, signal, model, log: () => {} });
}

describe('public activity choices retain verified source order', () => {
  it('keeps equal titles as distinct ordered identities and source-only items with no end time', () => {
    const targets = publicCampusEventTargets(read(), fixtureBinding.schoolId);
    expect(targets.map(item => item.id)).toEqual(['second-id', 'first-id']);
    expect(targets[0]).toMatchObject({ source: 'school-club-events', schoolId: fixtureBinding.schoolId,
      checkedAt: new Date(now).toISOString(), endsAt: '2026-11-05T13:00:00.000Z' });
    expect(targets[1]).not.toHaveProperty('endsAt');
    expect(publicCampusEventTargets({ ...read(), partial: true }, fixtureBinding.schoolId)).toEqual(targets);
  });

  it.each([
    (value: PublicCampusRead) => ({ ...value, schoolId: 'foreign' }),
    (value: PublicCampusRead) => ({ ...value, sourcePath: 'users/private/events' }),
    (value: PublicCampusRead) => ({ ...value, items: [value.items[0], { ...value.items[1], href: '/events/other' }] }),
    (value: PublicCampusRead) => ({ ...value, items: [value.items[0], value.items[0]] }),
    (value: PublicCampusRead) => ({ ...value, items: [value.items[0], { ...value.items[1], title: ' ' }] }),
    (value: PublicCampusRead) => ({ ...value, status: 'unavailable', unavailable: 'SOURCE_UNAVAILABLE', items: [] }),
  ])('rejects the whole choice list on invalid provenance or unavailable status', mutate => {
    expect(publicCampusEventTargets(mutate(read()), fixtureBinding.schoolId)).toEqual([]);
  });
});

describe('source-reference guard is independent of a model tool order', () => {
  it.each([
    '查近期活動並把第一個加入行事曆', '查近期活動，將第 2 筆活動加到個人行程',
    '把第二個加入行程', '將剛才活動清單第３個加入行事曆',
    '把公開活動加入行程', '把校園活動加入行事曆', '幫我安排第一個活動',
    '替這個公開活動建立行程', '幫我安排校園活動',
    '將這個活動加入行事曆', '幫我把活動加入行事曆', '近期活動要加入行事曆', '把最早的活動加入行程',
    '將「攝影講座」活動加入行事曆', '把第二個放進行程',
    '查近期活動，另外新增個人行程明天20:00到21:00專題討論',
  ])('requires selected-source preview before any generic event proposal: %s', async question => {
    expect(publicEventCalendarSourceIntent(question)).toBe(true);
    const { fixture, tools } = setup(question);
    const ledger = vi.spyOn(fixture.adapter, 'ledger');
    await expect(tools.call('propose_personal_event', eventArgs)).rejects.toMatchObject({ code: 'CAMPUS_EVENT_SELECTION_REQUIRED' });
    expect(tools.cards).toEqual([]);
    expect(fixture.adapter.publicCampus).not.toHaveBeenCalled();
    expect(ledger).not.toHaveBeenCalled();
    expect(fixture.writes).toEqual([]);
  });

  it.each([
    '幫我明天19:00到20:00安排社團活動', '幫我明天19:00到20:00安排校園活動討論',
    '新增個人行程明天19:00到20:00專題討論', '查近期活動，查未交作業，安排今天讀書30分鐘',
    '新增個人行程明天19:00到20:00校園活動討論',
    '查活動', '查今天課表，查公車',
    '校園活動有哪些，加入社團需要什麼條件',
  ])('does not equate an ordinary appointment or independent study task with an activity import: %s', question => {
    expect(publicEventCalendarSourceIntent(question)).toBe(false);
  });

  it.each(['ready', 'unavailable', 'failure', 'invalid-arguments'] as const)
    ('blocks generic proposals after an activity read attempt ends as %s', async state => {
      const { fixture, tools } = setup('查活動資料');
      if (state === 'unavailable') fixture.adapter.publicCampus = vi.fn(async () => ({ ...read(), items: [],
        status: 'unavailable', unavailable: 'SOURCE_UNAVAILABLE' }));
      if (state === 'failure') fixture.adapter.publicCampus = vi.fn(async () => { throw new Error('offline'); });
      const lookup = tools.call('get_campus_events', state === 'invalid-arguments' ? { schoolId: 'foreign' } : {});
      if (state === 'failure' || state === 'invalid-arguments') await expect(lookup).rejects.toThrow();
      else await lookup;
      // A later model hint cannot rename the original task into a private event.
      await expect(tools.call('propose_personal_event', eventArgs, '新增我自己的行程')).rejects.toMatchObject({ code: 'CAMPUS_EVENT_SELECTION_REQUIRED' });
      expect(tools.recovery('propose_personal_event').nextStep).toBe(CAMPUS_EVENT_SELECTION_REQUIRED_MESSAGE);
      expect(tools.cards).toEqual([]);
      expect(fixture.writes).toEqual([]);
    });

  it('does not turn an activity source request into unrelated coursework when the model chooses study planning', async () => {
    const { fixture, tools } = setup('幫我安排第一個活動');
    await expect(tools.call('propose_study_plan', { date: '2026-11-05' }))
      .rejects.toMatchObject({ code: 'CAMPUS_EVENT_SELECTION_REQUIRED' });
    expect(tools.cards).toEqual([]);
    expect(fixture.writes).toEqual([]);
  });

  it('keeps a separately requested source-guarded study plan available after an activity read', async () => {
    const { fixture, tools, binding } = setup('查近期活動，查未交作業，安排今天讀書30分鐘');
    await tools.call('get_campus_events', {});
    await tools.call('propose_study_plan', { date: '2026-11-04', from: '18:00', to: '20:00', minMinutes: 30 });
    expect(tools.cards.length).toBeGreaterThan(0);
    expect(verifyCard(binding, { token: tools.cards[0].token, args: tools.cards[0].args }, secret, now).studyGuard).toBeDefined();
    expect(fixture.writes).toEqual([]);
  });

  it('rechecks the source boundary after a pending permission read before signing a generic event', async () => {
    const { fixture, tools } = setup('新增自己的行程');
    let release!: () => void;
    let entered!: () => void;
    const waiting = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    let permissions = 0;
    fixture.adapter.permissions = async () => {
      if (++permissions === 2) { entered(); await gate; }
      return { createPersonalEvent: true, prepareFoodOrder: true };
    };
    const proposal = tools.call('propose_personal_event', eventArgs);
    await waiting;
    await tools.call('get_campus_events', {});
    release();
    await expect(proposal).rejects.toMatchObject({ code: 'CAMPUS_EVENT_SELECTION_REQUIRED' });
    expect(tools.cards).toEqual([]);
  });

  it('never revives an earlier list after the latest attempt fails, even if the old read resolves later', async () => {
    const { fixture, tools } = setup('查看活動資料');
    let release!: (value: PublicCampusRead) => void;
    fixture.adapter.publicCampus = vi.fn(async () => new Promise<PublicCampusRead>(resolve => { release = resolve; }));
    const first = tools.call('get_campus_events', {});
    await Promise.resolve();
    await expect(tools.call('get_campus_events', { schoolId: 'foreign' })).rejects.toThrow();
    release(read());
    await first;
    expect(tools.publicEventRead).toBeUndefined();
  });
});

describe('ordinary model runner returns selectable evidence without source-free event cards', () => {
  it.each(['read-first', 'proposal-first'] as const)('blocks a model that proposes %s and retains the actual activity choices', async order => {
    const first = calls(['get_campus_events', {}]);
    const second = calls(['propose_personal_event', eventArgs]);
    const model = sequenceModel(...(order === 'read-first' ? [first, second] : [second, first]), response('已把虛構活動加入行事曆。'));
    const fixture = fixtureAdapter();
    const result = await ask(sourceQuestion, model, fixture);
    expect(model).toHaveBeenCalled();
    expect(result).toMatchObject({ cards: [], dataRead: true, eventTargets: [{ id: 'second-id' }, { id: 'first-id' }] });
    expect(result.steps).toContainEqual({ name: 'propose_personal_event', status: 'error', summary: 'CAMPUS_EVENT_SELECTION_REQUIRED' });
    expect(result.answer).toContain(CAMPUS_EVENT_SELECTION_REQUIRED_MESSAGE);
    expect(result.answer).toContain('攝影講座');
    expect(result.answer).not.toContain('虛構活動');
    expect(fixture.writes).toEqual([]);
  });

  it('returns actual selectable activity results from a non-deterministic read question', async () => {
    const model = sequenceModel(calls(['get_campus_events', {}]), response('我猜沒有任何活動。'));
    const result = await ask('請查看近期校園活動的詳細資料', model);
    expect(model).toHaveBeenCalled();
    expect(result).toMatchObject({ cards: [], dataRead: true, eventTargets: [{ id: 'second-id' }, { id: 'first-id' }] });
    expect(result.answer).toContain('攝影講座');
    expect(result.answer).not.toContain('我猜');
  });

  it('preserves verified choices after provider failure without fabricating a confirmation card', async () => {
    const model = sequenceModel(calls(['get_campus_events', {}]), new Error('provider offline'));
    const result = await ask(sourceQuestion, model);
    expect(result).toMatchObject({ cards: [], dataRead: true, eventTargets: [{ id: 'second-id' }, { id: 'first-id' }] });
    expect(result.answer).toContain('重新核對來源');
  });

  it('does not substitute an earlier list when a later lookup is unavailable', async () => {
    const fixture = fixtureAdapter();
    fixture.adapter.publicCampus = vi.fn().mockResolvedValueOnce(read()).mockResolvedValueOnce({ ...read(),
      status: 'unavailable', unavailable: 'SOURCE_UNAVAILABLE', items: [] });
    const model = sequenceModel(calls(['get_campus_events', { limit: 5 }]), calls(['get_campus_events', { limit: 4 }]), response('請選先前第一筆'));
    const result = await ask(sourceQuestion, model, fixture);
    expect(result).toMatchObject({ cards: [], dataRead: true, eventTargets: [] });
    expect(result.answer).not.toContain('攝影講座');
    expect(result.answer).toContain('無法完整核對');
  });

  it('keeps unavailable sources distinct from an empty feed and refuses model memory as event facts', async () => {
    const fixture = fixtureAdapter();
    fixture.adapter.publicCampus = vi.fn(async () => { throw new Error('offline'); });
    const model = sequenceModel(calls(['get_campus_events', {}]), calls(['propose_personal_event', eventArgs]), response('已完成。'));
    const result = await ask(sourceQuestion, model, fixture);
    expect(result).toMatchObject({ cards: [], dataRead: true, eventTargets: [] });
    expect(result.answer).toContain('尚未取得可選擇的清單');
    expect(result.answer).not.toContain('已完成');
    expect(fixture.writes).toEqual([]);
  });

  it('returns an explicit source-selection response when a model invents completion without performing a read', async () => {
    const result = await ask(sourceQuestion, sequenceModel(response('已完成活動新增，時間是明天中午。')));
    expect(result).toMatchObject({ cards: [], dataRead: true, eventTargets: [] });
    expect(result.answer).toContain(CAMPUS_EVENT_SELECTION_REQUIRED_MESSAGE);
    expect(result.answer).not.toContain('明天中午');
  });

  it('does not convert an authentication failure into a harmless activity-selection result', async () => {
    const fixture = fixtureAdapter();
    fixture.adapter.publicCampus = vi.fn(async () => { throw new V2Error(401, 'SESSION_EXPIRED'); });
    await expect(ask(sourceQuestion, sequenceModel(calls(['get_campus_events', {}])), fixture))
      .rejects.toMatchObject({ status: 401, code: 'SESSION_EXPIRED' });
  });

  it('drops late activity results after cancellation', async () => {
    const fixture = fixtureAdapter(), controller = new AbortController();
    fixture.adapter.publicCampus = vi.fn(async () => { controller.abort(); return read(); });
    await expect(ask(sourceQuestion, sequenceModel(calls(['get_campus_events', {}])), fixture, controller.signal))
      .rejects.toMatchObject({ status: 499, code: 'ABORTED' });
  });

  it('still prepares a complete private appointment with 活動 in its title without involving a model or public source', async () => {
    const fixture = fixtureAdapter(), model = vi.fn<Model>(async () => { throw new Error('No model needed'); });
    const result = await ask('幫我明天19:00到20:00安排校園活動討論', model, fixture);
    expect(result).toMatchObject({ modelCalls: 0, cards: [{ args: { title: '校園活動討論', date: '2026-11-05', startTime: '19:00', endTime: '20:00' } }] });
    expect(model).not.toHaveBeenCalled();
    expect(fixture.adapter.publicCampus).not.toHaveBeenCalled();
    expect(fixture.writes).toEqual([]);
  });
});

// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { V2Error, type Model, type ModelResult, type Obj } from './contracts';
import { crossServiceRequest } from './crossServiceRequest';
import { fixtureAdapter, fixtureBinding, FIXTURE_NOW as now, FIXTURE_SECRET as secret } from './fixtures';
import type { PublicCampusRead } from './publicCampus';
import { CAMPUS_EVENT_SELECTION_REQUIRED_MESSAGE } from './publicCampusSelection';
import type { PublicSocialRead } from './publicSocial';
import { run } from './runner';

const schoolId = 'pu';
const modelClaim = '模型偽造：活動已自動保存，清大資料庫課程已全部取消。';
const usage = { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 };
const answer = (content = modelClaim): ModelResult => ({ message: { role: 'assistant', content }, usage });
const calls = (...items: [string, Obj][]): ModelResult => ({ usage,
  message: { role: 'assistant', content: '', tool_calls: items.map(([name, args], index) => ({
    id: `call-${index}`, type: 'function', function: { name, arguments: JSON.stringify(args) },
  })) },
});
function sequenceModel(...results: (ModelResult | Error)[]) {
  let index = 0;
  return vi.fn<Model>(async () => {
    const result = results[index++] ?? answer();
    if (result instanceof Error) throw result;
    return result;
  });
}

function social(): PublicSocialRead {
  return { version: 1, source: 'platform-public-social', sourcePath: 'social/feed', schoolId,
    checkedAt: new Date(now).toISOString(), query: { limit: 5 }, status: 'ready',
    items: [{ id: 'post-a', tenantId: schoolId, tenantName: '靜宜大學', communityId: 'board-a',
      communityName: '公開交流', text: '這是同學發表的閱讀心得。', author: { displayName: '同學', isSelf: false },
      publishedAt: '2026-11-04T02:00:00.000Z', version: 1 }],
    nextCursor: null, partial: false, href: `/social?schoolId=${schoolId}` };
}

function activities(status: 'ready' | 'unavailable'): PublicCampusRead {
  return { version: 1, kind: 'events', schoolId, source: 'school-club-events',
    sourcePath: `schools/${schoolId}/clubEvents`, checkedAt: new Date(now).toISOString(),
    status, partial: status === 'ready', href: `/events?schoolId=${schoolId}`,
    ...(status === 'unavailable' ? { unavailable: 'SOURCE_UNAVAILABLE' as const } : {}),
    items: status === 'unavailable' ? [] : [{ id: 'photography-a', schoolId, title: '攝影講座',
      summary: '學校公開的活動摘要', startsAt: '2026-11-05T12:00:00.000Z', endsAt: '2026-11-05T13:00:00.000Z',
      href: `/events/photography-a?schoolId=${schoolId}&source=school-club-events` }] };
}

function setup() {
  const fixture = fixtureAdapter();
  const publicSocial = vi.fn(async () => social());
  fixture.adapter.publicSocial = publicSocial;
  const binding = { ...fixtureBinding, schoolId, conversationId: 'connected-fallback-' + randomUUID() };
  return { fixture, publicSocial, binding };
}

async function ask(question: string, model: Model, prepared: ReturnType<typeof setup>) {
  // Unknown prose must use the conversational fallback, where source wrappers
  // previously replaced each other's verified facts and uncertainty messages.
  expect(crossServiceRequest(question, now, schoolId)).toBeNull();
  const reply = await run({ question, history: [], binding: prepared.binding, adapter: prepared.fixture.adapter,
    secret, now, writes: true, signal: new AbortController().signal, model, log: () => {} });
  expect(reply).toMatchObject({ dataRead: true, cards: [] });
  expect(reply.answer).not.toContain(modelClaim);
  expect(prepared.fixture.writes).toEqual([]);
  expect(prepared.fixture.orderCalls).toEqual([]);
  return reply;
}

describe('connected public readers preserve other source-bound fallback answers', () => {
  it('retains the exact failed public catalog notice alongside a successful social source', async () => {
    const prepared = setup();
    const publicCourses = vi.fn().mockRejectedValue(new V2Error(503, 'PUBLIC_COURSES_UNAVAILABLE'));
    prepared.fixture.adapter.publicCourses = publicCourses;
    const model = sequenceModel(answer());
    const question = '查公開動態，查清大星期三3學分資料庫課程，另外比較兩種讀書策略';
    const reply = await ask(question, model, prepared);
    expect(prepared.publicSocial).toHaveBeenCalledExactlyOnceWith({ limit: 5 });
    expect(publicCourses).toHaveBeenCalledExactlyOnceWith({ kind: 'search', schoolId: 'nthu', query: '資料庫',
      filters: { weekday: 3, credits: 3 } });
    expect(reply.answer).toContain('這是同學發表的閱讀心得');
    expect(reply.answer).toContain('來源：公開交流 /social?schoolId=pu');
    expect(reply.answer).toContain('國立清華大學公開課程「資料庫」');
    expect(reply.answer).toContain('尚未取得可核對結果');
    expect(reply.answer).toContain('星期三');
    expect(reply.answer).toContain('3 學分');
    expect(reply.answer).toContain('比較兩種讀書策略');
    expect(reply.stopReason).toBe('PUBLIC_COURSES_UNAVAILABLE');
    expect(model).toHaveBeenCalledOnce();
  });

  it('keeps both missing-source notices when the provider and both readers fail', async () => {
    const prepared = setup();
    prepared.publicSocial.mockRejectedValue(new V2Error(503, 'PUBLIC_SOCIAL_UNAVAILABLE'));
    const publicCourses = vi.fn().mockRejectedValue(new V2Error(503, 'PUBLIC_COURSES_UNAVAILABLE'));
    prepared.fixture.adapter.publicCourses = publicCourses;
    const model = sequenceModel(new V2Error(503, 'PROVIDER_UNAVAILABLE'));
    const reply = await ask('查公開動態，查清大資料庫課程，另外比較兩種讀書策略', model, prepared);
    expect(prepared.publicSocial).toHaveBeenCalledOnce();
    expect(publicCourses).toHaveBeenCalledExactlyOnceWith({ kind: 'search', schoolId: 'nthu', query: '資料庫' });
    expect(reply.answer).toContain('國立清華大學公開課程「資料庫」尚未取得可核對結果');
    expect(reply.answer).toContain('查公開交流動態尚未取得可核對的結果');
    expect(reply.answer).not.toContain('沒有列出貼文');
    expect(reply.answer).not.toContain('沒有課程');
    expect(reply.stopReason).toBe('PROVIDER_UNAVAILABLE');
    expect(model).toHaveBeenCalledOnce();
  });

  it.each(['查公開動態', '查學校電話'])(
    'preserves activity selection, source times and partial coverage with %s and unknown prose', async connected => {
      const prepared = setup();
      const publicCampus = vi.fn(async () => activities('ready'));
      prepared.fixture.adapter.publicCampus = publicCampus;
      const model = sequenceModel(calls(['get_campus_events', {}]), answer());
      const reply = await ask(`${connected}，查近期活動，並把第一個加入行事曆，另外比較兩種讀書策略`, model, prepared);
      expect(publicCampus).toHaveBeenCalledExactlyOnceWith('events', 5);
      expect(reply.answer).toContain(CAMPUS_EVENT_SELECTION_REQUIRED_MESSAGE);
      expect(reply.answer).toContain('攝影講座');
      expect(reply.answer).toContain('2026-11-05 20:00');
      expect(reply.answer).toContain('其餘頁面或未列出的項目尚未完整核對');
      expect(reply.answer).toContain('/events?schoolId=pu');
      expect(reply.answer).toContain(connected === '查公開動態' ? '來源：公開交流' : '資料版本：教育部');
      expect('eventTargets' in reply && reply.eventTargets).toEqual([
        expect.objectContaining({ id: 'photography-a', schoolId, source: 'school-club-events',
          startsAt: '2026-11-05T12:00:00.000Z', endsAt: '2026-11-05T13:00:00.000Z' }),
      ]);
      expect(reply.stopReason).toBe('CAMPUS_EVENT_SELECTION_REQUIRED');
      expect(model).toHaveBeenCalledTimes(2);
    },
  );

  it.each(['查公開動態', '查學校電話'])(
    'keeps unavailable activity evidence and selection guidance with %s', async connected => {
      const prepared = setup();
      prepared.fixture.adapter.publicCampus = vi.fn(async () => activities('unavailable'));
      const model = sequenceModel(calls(['get_campus_events', {}]), answer());
      const reply = await ask(`${connected}，查近期活動，並把第一個加入行事曆，另外比較兩種讀書策略`, model, prepared);
      expect(reply.answer).toContain(CAMPUS_EVENT_SELECTION_REQUIRED_MESSAGE);
      expect(reply.answer).toContain('目前無法完整核對公開活動來源，尚不能確認內容');
      expect(reply.answer).not.toContain('沒有活動');
      expect(reply.answer).not.toContain('攝影講座');
      expect('eventTargets' in reply && reply.eventTargets).toEqual([]);
      expect(reply.stopReason).toBe('CAMPUS_EVENT_SELECTION_REQUIRED');
    },
  );

  it('discards raw model claims when no other deterministic source wrapper ran', async () => {
    const prepared = setup();
    const reply = await ask('查公開動態，另外比較兩種讀書策略', sequenceModel(answer()), prepared);
    expect(reply.answer).toContain('貼文摘錄：「這是同學發表的閱讀心得。');
    expect(reply.answer).toContain('比較兩種讀書策略');
    expect(reply.answer).toContain('尚未完整核對');
    expect(reply.stopReason).toBe('TASKS_INCOMPLETE');
  });
});

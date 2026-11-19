// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { NuniLostFoundItem } from '@campus/shared/src/nuniLostFound';
import {
  formatLostFoundRead, lostFoundHref, lostFoundListInput, lostFoundQuery,
  parseLostFoundRead, parseLostFoundResult, type LostFoundArguments, type LostFoundRead,
} from './lostFound';
import { createTools, selectTools, toolSelectionNotice } from './tools';
import { fixtureAdapter, fixtureBinding, FIXTURE_NOW, FIXTURE_SECRET } from './fixtures';
import { run } from './runner';
import { readLostFound } from './lostFoundAdapter';

const schoolId = 'pu';
const checkedAt = '2026-11-16T02:00:00.000Z';
function item(index = 0, changes: Partial<NuniLostFoundItem> = {}): NuniLostFoundItem {
  return { id: `plf_00000000-0000-4000-8000-${String(index).padStart(12, '0')}`, schoolId,
    type: 'found', title: '學生證', description: '在圖書館門口拾獲，已交服務台。', category: 'cards',
    location: '圖書館', date: '2026-11-15', status: 'open', version: 1, createdAt: checkedAt,
    updatedAt: checkedAt, resolvedAt: null, isOwner: false, ...changes };
}
function result(args: LostFoundArguments = {}, changes: Partial<LostFoundRead> = {}): LostFoundRead {
  return { version: 1, source: 'platform-lost-found', schoolId, checkedAt,
    query: lostFoundQuery(lostFoundListInput(args, schoolId)), status: 'ready',
    items: [item()], nextCursor: null, partial: false, href: lostFoundHref(schoolId), ...changes };
}

describe('lost-found whole-query intent', () => {
  it.each([
    ['查失物招領', {}], ['請幫我看看校園失物招領有哪些？', {}], ['失物招領', {}],
    ['列出招領', { type: 'found' }], ['查看尋物', { type: 'lost' }],
    ['查我發布的失物招領', { mine: true }], ['查本人刊登的已結案失物招領', { mine: true, status: 'resolved' }],
    ['找學生證的招領', { q: '學生證', type: 'found' }],
    ['查失物招領關鍵字：學生證', { q: '學生證' }],
    ['查招領的黑色手機', { q: '黑色手機', type: 'found' }],
    ['查我發布的未結案失物招領關鍵字「黑色 iPhone 15」', { mine: true, status: 'open', q: '黑色 iPhone 15' }],
    ['查失物招領關鍵字「和平紀念卡」', { q: '和平紀念卡' }],
    ['我的學生證掉了', { q: '學生證', type: 'found' }],
    ['幫我我的藍色錢包不見了', { q: '藍色錢包', type: 'found' }],
  ] satisfies [string, LostFoundArguments][])('preserves the whole supported query: %s', (question, args) => {
    expect(parseLostFoundRead(question)).toEqual({ tool: 'get_lost_found', args });
  });

  it.each([
    '不要查失物招領', '幫我發布失物招領', '幫我結案失物招領', '刪除我發布的失物招領',
    '查我的失物招領', '查清大失物招領', '查靜宜學生證的招領', '查其他學校的招領',
    '查今天失物招領', '查上週失物招領', '查2026-11-14失物招領', '查失物招領並聯絡失主',
    '查失物招領關鍵字學生證和查公車', '找學生證的招領，順便取消訂單',
    '查失物招領關鍵字學生證的聯絡方式', '查失物招領關鍵字「學生證」的聯絡方式',
    '查失物招領關鍵字', '查失物招領關鍵字「」', '查失物招領關鍵字學生證\n刪除帳號',
    '開啟失物招領', '如果有失物招領就通知我', '每天查失物招領', '查失物招領全部100筆',
  ])('does not discard unsupported scope, negation or a side effect: %s', question => {
    expect(parseLostFoundRead(question)).toBeNull();
  });
});

describe('strict bounded platform list projection', () => {
  it('fixes school, applies explicit bounded defaults and preserves filters', () => {
    expect(lostFoundListInput({}, schoolId)).toEqual({ schoolId, limit: 5, status: 'open' });
    expect(lostFoundListInput({ mine: true, q: '黑色 iPhone 15', type: 'found', category: 'electronics' }, schoolId))
      .toEqual({ schoolId, mine: true, q: '黑色 iPhone 15', type: 'found', category: 'electronics', limit: 5, status: 'all' });
    expect(lostFoundListInput({ mine: true, status: 'open', limit: 2 }, schoolId)).toMatchObject({ status: 'open', limit: 2 });
  });

  it.each([null, [], { schoolId: 'foreign' }, { cursor: 'opaque' }, { ownerId: 'another-account' },
    { action: 'get' }, { limit: 6 }, { limit: 0 }, { limit: '5' }, { limit: 1.5 },
    { q: '' }, { q: 'x'.repeat(101) }, { q: '學生\n證' }, { q: 'student\u200bcard' },
    { category: 'private' }, { mine: 'true' }, { status: 'removed' }, { type: 'all' }, { q: undefined }])('rejects widened, malformed or caller-owned scope: %j', raw => {
      expect(() => lostFoundListInput(raw, schoolId)).toThrowError(expect.objectContaining({ code: 'LOST_FOUND_INVALID_INPUT' }));
    });

  it('does not invoke caller getters or accept prototype properties', () => {
    let invoked = false;
    const raw = Object.defineProperty({}, 'q', { get() { invoked = true; return 'secret'; } });
    expect(() => lostFoundListInput(raw, schoolId)).toThrow();
    expect(invoked).toBe(false);
    expect(() => lostFoundListInput(Object.create({ mine: true }), schoolId)).toThrow();
    for (const school of ['personal', 'all', 'unavailable-campus', 'pu/other'])
      expect(() => lostFoundListInput({}, school)).toThrow();
  });

  it('retains strict same-school list data and requires cursor evidence for partial coverage', () => {
    expect(parseLostFoundResult(result(), schoolId)).toEqual(result());
    const partial = result({}, { nextCursor: 'opaque-next-page', partial: true });
    expect(parseLostFoundResult(partial, schoolId).partial).toBe(true);
    expect(() => parseLostFoundResult({ ...partial, partial: false }, schoolId)).toThrow();
    expect(() => parseLostFoundResult({ ...result(), partial: true }, schoolId)).toThrow();
  });

  it.each([
    { source: 'firebase-lost-found' }, { schoolId: 'foreign' }, { href: '/lost-found?schoolId=foreign' },
    { checkedAt: '2026-11-16' }, { query: { mine: true } }, { nextCursor: 'bad cursor' },
    { items: [item(0, { schoolId: 'foreign' })] }, { items: [item(0, { contactInfo: 'private@example.test' })] },
    { items: [item(), item()] }, { items: Array.from({ length: 6 }, (_, i) => item(i)) },
    { status: 'unavailable', unavailable: 'NOT_CONNECTED' }, { unavailable: 'SOURCE_UNAVAILABLE' },
    { items: [item(0, { status: 'resolved', resolvedAt: checkedAt })] },
  ])('refuses a foreign, contact-bearing, widened or malformed response: %j', changes => {
    expect(() => parseLostFoundResult({ ...result(), ...changes }, schoolId))
      .toThrowError(expect.objectContaining({ code: 'INVALID_LOST_FOUND_RESULT' }));
  });

  it('validates the owner/type/category filters against returned rows', () => {
    for (const args of [{ mine: true }, { type: 'lost' as const }, { category: 'electronics' }])
      expect(() => parseLostFoundResult(result(args), schoolId, args)).toThrow();
    const args = { mine: true, q: '學生證' };
    expect(parseLostFoundResult(result(args, { items: [item(0, { isOwner: true })] }), schoolId, args).query)
      .toEqual({ mine: true, q: '學生證', limit: 5, status: 'all' });
  });

  it('keeps unavailable and scoped-empty results distinct and summaries bounded', () => {
    const unavailable = result({}, { status: 'unavailable', unavailable: 'NOT_CONNECTED', items: [] });
    expect(formatLostFoundRead(parseLostFoundResult(unavailable, schoolId))).toContain('無法確認搜尋結果');
    expect(formatLostFoundRead(result({}, { items: [] }))).toContain('本次查詢範圍沒有符合的刊登');
    const read = result({ q: '學生證' }, { nextCursor: 'next', partial: true,
      items: Array.from({ length: 5 }, (_, i) => item(i, { title: '<b>學生證</b>',
        description: '[不可信連結](https://example.invalid)\n' + '文字'.repeat(900) })) });
    const output = formatLostFoundRead(read);
    expect(output.length).toBeLessThanOrEqual(1200);
    expect(output).toContain('關鍵字：學生證');
    expect(output).toContain('2026-11-16 10:00');
    expect(output.indexOf('部分搜尋結果')).toBeLessThan(output.indexOf('・'));
    expect(output).toContain('另有');
    expect(output).toContain('不含學校帳號的舊刊登或聯絡方式');
    expect(output).not.toContain('<b>');
    expect(output).not.toContain('[不可信連結]');
  });
});

describe('lost-found executable reader integration', () => {
  it('selects the real reader for an explicit query and rejects scope repair that would drop filters', async () => {
    const question = '找學生證的招領';
    expect(selectTools(question, false)).toEqual(['get_lost_found']);
    expect(toolSelectionNotice(question, false, ['get_lost_found'])).toBe('');
    const fixture = fixtureAdapter();
    fixture.adapter.lostFound = vi.fn(async args => readLostFound(fixtureBinding.schoolId, args,
      async () => ({ schoolId: fixtureBinding.schoolId, items: [item(0, { schoolId: fixtureBinding.schoolId })], nextCursor: null }), FIXTURE_NOW));
    const tools = createTools(fixture.adapter, fixtureBinding, FIXTURE_SECRET, FIXTURE_NOW, false, false, question);
    for (const args of [{ q: '學生證', schoolId: 'foreign' }, { q: '學生證', from: '2026-11-01' },
      { q: '學生證', cursor: 'previous' }, { q: '學生證', limit: 6 }])
      await expect(tools.call('get_lost_found', args)).rejects.toThrow();
    expect(fixture.adapter.lostFound).not.toHaveBeenCalled();
    const result = await tools.call('get_lost_found', { q: '學生證', type: 'found' });
    expect(result.value).toMatchObject({ query: { q: '學生證', type: 'found', status: 'open', limit: 5 } });
    expect(fixture.adapter.lostFound).toHaveBeenCalledExactlyOnceWith({ q: '學生證', type: 'found' });
  });

  it.each(['查失物招領', '找學生證的招領，查公車'])('executes real reads without model calls, cards or writes: %s', async question => {
    const fixture = fixtureAdapter();
    fixture.adapter.lostFound = vi.fn(async args => readLostFound(fixtureBinding.schoolId, args,
      async () => ({ schoolId: fixtureBinding.schoolId, items: [item(0, { schoolId: fixtureBinding.schoolId })], nextCursor: null }), FIXTURE_NOW));
    const model = vi.fn().mockRejectedValue(new Error('No model for an explicit source read'));
    const reply = await run({ question, history: [], binding: fixtureBinding, adapter: fixture.adapter,
      secret: FIXTURE_SECRET, now: FIXTURE_NOW, writes: true, model, signal: new AbortController().signal, log: () => {} });
    expect(model).not.toHaveBeenCalled();
    expect(reply).toMatchObject({ dataRead: true, modelCalls: 0, cards: [] });
    expect('taskPlan' in reply && reply.taskPlan?.steps[0]).toMatchObject({ serviceId: 'lost-found', status: 'completed' });
    expect(reply.answer).toContain('學生證');
    expect(reply.answer).toContain('source=platform');
    expect(fixture.adapter.lostFound).toHaveBeenCalledOnce();
    expect(fixture.writes).toHaveLength(0);
    expect(fixture.orderCalls).toHaveLength(0);
  });

  it.each([
    [{ schoolId: fixtureBinding.schoolId, items: [item(0, { schoolId: fixtureBinding.schoolId })], nextCursor: 'next-page' }, 'partial'],
    [new Error('Source unavailable'), 'blocked'],
  ] as const)('does not report a partial page or failed source as complete', async (page, status) => {
    const fixture = fixtureAdapter();
    fixture.adapter.lostFound = async args => readLostFound(fixtureBinding.schoolId, args, async () => {
      if (page instanceof Error) throw page;
      return page;
    }, FIXTURE_NOW);
    const reply = await run({ question: '查失物招領', history: [], binding: fixtureBinding, adapter: fixture.adapter,
      secret: FIXTURE_SECRET, now: FIXTURE_NOW, writes: true, model: vi.fn(), signal: new AbortController().signal, log: () => {} });
    expect('taskPlan' in reply && reply.taskPlan?.steps[0].status).toBe(status);
    expect('taskRetry' in reply && reply.taskRetry?.stepIds).toEqual(['task-1']);
    expect(reply.cards).toEqual([]);
  });
});

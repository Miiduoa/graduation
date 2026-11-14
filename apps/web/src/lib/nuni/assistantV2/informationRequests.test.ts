// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { run } from './runner';
import { selectTools } from './tools';
import { foodOrderIntent } from './food';
import { informationReads } from './information';
import { V2Error, type Model, type ModelResult } from './contracts';
import {
  fixtureAdapter, fixtureBinding as binding, FIXTURE_NOW as now, FIXTURE_SECRET as secret,
} from './fixtures';

const usage = { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 };
const redirectOnly: Model = async () => ({
  message: { role: 'assistant', content: '請打開相關功能頁面查看。' }, usage,
});
const call = (name: string, args: unknown): ModelResult => ({
  message: { role: 'assistant', tool_calls: [{ id: 'call', type: 'function',
    function: { name, arguments: JSON.stringify(args) } }] }, usage,
});
const ask = (question: string, f = fixtureAdapter(), model: Model = redirectOnly) =>
  run({ question, history: [], binding, adapter: f.adapter, model, now, secret,
    writes: true, signal: new AbortController().signal, log: () => {} });

describe('information requests return verified data instead of a page shortcut', () => {
  it('reads today\'s actual class times and classrooms even when the model only suggests opening a page', async () => {
    const f = fixtureAdapter();
    const ledger = vi.spyOn(f.adapter, 'ledger');
    const courses = vi.spyOn(f.adapter, 'courses');
    const result = await ask('我今天有什麼課？教室在哪？', f);
    expect(ledger).toHaveBeenCalledTimes(1);
    expect(courses).not.toHaveBeenCalled();
    expect(result.answer).toContain('程式設計');
    expect(result.answer).toContain('09:00');
    expect(result.answer).toContain('資訊101');
    expect(result.answer).toContain('資料結構');
    expect(result.answer).not.toContain('請打開相關功能頁面');
    expect(result.cards).toHaveLength(0);
    expect(f.writes).toHaveLength(0);
  });

  it('returns the next future class instead of including classes that have already ended', async () => {
    const result = await ask('下一堂課在哪，幾點？');
    expect(result.answer).toContain('資料結構');
    expect(result.answer).toContain('13:00');
    expect(result.answer).toContain('資訊202');
    expect(result.answer).not.toContain('程式設計');
  });

  it('reads pending assignments and their deadlines even when the model invents an open-page call', async () => {
    let calls = 0;
    const f = fixtureAdapter();
    const work = vi.spyOn(f.adapter, 'work');
    const result = await ask('這週有什麼作業還沒交？', f, async () =>
      calls++ === 0 ? call('propose_open_page', { page: 'classroom' }) : redirectOnly({} as never));
    expect(work).toHaveBeenCalledTimes(1);
    expect(result.answer).toContain('樹與圖作業');
    expect(result.answer).toContain('2026-11-05 23:59');
    expect(result.answer).toContain('程式練習');
    expect(result.answer).not.toContain('已交報告');
    expect(result.cards).toHaveLength(0);
    expect(f.writes).toHaveLength(0);
  });

  it('retains retrieved assignment data when the model provider is unavailable', async () => {
    const model = vi.fn(async () => {
      throw new V2Error(503, 'PROVIDER_UNAVAILABLE');
    });
    const result = await ask('有什麼作業要交？', fixtureAdapter(), model);
    expect(result.answer).toContain('樹與圖作業');
    expect(result.answer).toContain('程式練習');
    expect(result.cards).toHaveLength(0);
    expect(result.modelCalls).toBe(0);
    expect(model).not.toHaveBeenCalled();
  });

  it.each([
    ['有哪些作業要交？', true, false, '待繳作業'],
    ['測驗何時截止？', false, true, '待繳測驗'],
    ['作業和測驗何時截止？', true, true, '待繳作業與測驗'],
  ])('retains the requested task kind for %s', async (question, assignment, quiz, heading) => {
    const f = fixtureAdapter();
    const tasks = await f.adapter.work('course-a');
    vi.spyOn(f.adapter, 'work').mockResolvedValue([...tasks, {
      id: 'quiz-open', courseId: 'course-a', kind: 'quiz', title: '資料結構測驗',
      dueAt: '2026-11-05T18:00:00+08:00', state: 'open', submitted: false,
    }]);
    const result = await ask(String(question), f);
    expect(result.answer).toContain(heading);
    expect(result.answer.includes('樹與圖作業')).toBe(assignment);
    expect(result.answer.includes('資料結構測驗')).toBe(quiz);
  });

  it('separates undated tasks from an explicitly requested deadline date', async () => {
    const f = fixtureAdapter();
    const tasks = await f.adapter.work('course-a');
    vi.spyOn(f.adapter, 'work').mockResolvedValue([...tasks, {
      id: 'undated', courseId: 'course-a', kind: 'assignment', title: '未定期限報告',
      dueAt: null, state: 'open', submitted: false,
    }]);
    const result = await ask('明天有哪些作業要交？', f);
    expect(result.answer).toContain('2026-11-05 至 2026-11-05');
    expect(result.answer).toContain('無法判定是否屬於上述截止日期範圍');
    expect(result.answer).toContain('未定期限報告｜未設定截止時間');
    expect(result.answer).not.toContain('程式練習');
  });

  it('does not claim no quizzes when a source omitted task types', async () => {
    const f = fixtureAdapter();
    vi.spyOn(f.adapter, 'work').mockResolvedValue([{
      id: 'unknown-kind', courseId: 'course-a', title: '未分類項目',
      dueAt: '2026-11-05T18:00:00+08:00', state: 'open', submitted: false,
    }]);
    const result = await ask('有哪些測驗要交？', f);
    expect(result.answer).toContain('未標示作業或測驗類型');
    expect(result.answer).not.toMatch(/沒有.*待繳|沒有測驗/);
  });

  it('distinguishes a failed or partial source from having no work', async () => {
    const f = fixtureAdapter();
    vi.spyOn(f.adapter, 'work').mockRejectedValue(new Error('source unavailable'));
    const result = await ask('有哪些未交作業？', f);
    expect(result.answer).toMatch(/部分課程|未能讀取|尚未讀到/);
    expect(result.answer).not.toMatch(/沒有待繳|全部完成|沒有作業/);
  });

  it('describes an empty synchronized schedule without claiming the user is free', async () => {
    const f = fixtureAdapter();
    vi.spyOn(f.adapter, 'ledger').mockResolvedValue({ ...f.snapshot(), records: [] });
    const result = await ask('今天課表', f);
    expect(result.answer).toMatch(/已同步.*沒有|尚無.*課程紀錄/);
    expect(result.answer).not.toMatch(/今天沒課|今天有空|整天有空/);
  });

  it('checks order progress and pickup information without preparing another order', async () => {
    const f = fixtureAdapter();
    const orders = vi.spyOn(f.adapter, 'orders');
    const detail = vi.spyOn(f.adapter, 'order');
    const menu = vi.spyOn(f.adapter.food!, 'menu');
    const result = await ask('我的餐好了嗎？可以取餐了嗎？', f);
    expect(foodOrderIntent('我的餐好了嗎？')).toBe(false);
    expect(orders).toHaveBeenCalledTimes(1);
    expect(detail).toHaveBeenCalledWith('fixture-realm', 'order-a');
    expect(result.answer).toContain('蔬菜便當');
    expect(result.answer).toContain('可取餐');
    expect(result.answer).toContain('SYN-12');
    expect(menu).not.toHaveBeenCalled();
    expect(result.cards).toHaveLength(0);
    expect(f.orderCalls).toHaveLength(0);
  });

  it('does not bypass a revoked session while preloading information', async () => {
    const f = fixtureAdapter();
    vi.spyOn(f.adapter, 'ledger').mockRejectedValue(new V2Error(401, 'UNAUTHENTICATED'));
    const model = vi.fn(redirectOnly);
    await expect(ask('今天課表', f, model)).rejects.toMatchObject({ status: 401 });
    expect(model).not.toHaveBeenCalled();
  });

  it('preserves an explicit request to open the timetable without reading personal data', async () => {
    const f = fixtureAdapter();
    const ledger = vi.spyOn(f.adapter, 'ledger');
    let calls = 0;
    const result = await ask('打開課表頁面', f, async () =>
      calls++ === 0 ? call('propose_open_page', { page: 'timetable' }) : redirectOnly({} as never));
    expect(selectTools('打開課表頁面', false)).toContain('propose_open_page');
    expect(ledger).not.toHaveBeenCalled();
    expect(result.cards).toHaveLength(1);
    expect(result.cards[0].tool).toBe('propose_open_page');
  });

  it('keeps study arrangements on the existing confirmation flow', async () => {
    const f = fixtureAdapter();
    const result = await ask('幫我安排今天下午寫作業', f);
    expect(result.cards.some((card) => card.tool === 'propose_personal_event')).toBe(true);
    expect(result.cards.some((card) => card.tool === 'propose_open_page')).toBe(false);
    expect(f.writes).toHaveLength(0);
  });

  it.each([
    '下週五課表', '今天和明天有哪些課？', '資料結構今天幾點上課？', '樹與圖作業什麼時候交？',
    '查昨天穀穀的訂單進度', '查穀穀的訂單進度', '查昨天的訂單', '查今天的訂單',
    '查訂單 123456 的進度', '查訂單 abc-123 的進度', '查已付款訂單', '查全部歷史訂單',
    '2026-02-30課表', '2026-13-01課表', '2026-2-3課表',
    '明早課表', '今晚課表', '今天下午課表', '這週五晚上的課表',
    '明天 2026-11-07 的課表', '2026-11-04 到 2026-11-06 的課表',
    '明天現在上什麼課', '明天目前上什麼課', '這週現在上什麼課', '明天之前有哪些作業要交', '這學期課表',
    '下一堂課和今天課表', '目前課表', '現在課表',
  ])
    ('leaves specific or multi-date scopes to tools instead of answering the wrong range: %s', (question) => {
      expect(informationReads(question, now)).toHaveLength(0);
    });

  it.each(['查昨天穀穀的訂單進度', '2026-02-30課表', '明早課表', '今晚課表'])
    ('does not replace the model response with an unfiltered fallback for %s', async (question) => {
      const f = fixtureAdapter();
      const orders = vi.spyOn(f.adapter, 'orders');
      const result = await ask(question, f, async () => ({
        message: { role: 'assistant', content: '這個查詢需要保留你指定的條件。' }, usage,
      }));
      expect(result.answer).toContain('這個查詢需要保留你指定的條件。');
      expect(result.steps).not.toContainEqual(expect.objectContaining({ name: 'list_food_orders' }));
      expect(result.steps).not.toContainEqual(expect.objectContaining({ name: 'get_schedule' }));
      expect(orders).not.toHaveBeenCalled();
    });

  it.each(['我的訂單進度', '查詢我的訂單狀態', '最近的訂單', '我的餐好了嗎？可以取餐了嗎？'])
    ('still supports generic order progress without narrowing conditions: %s', (question) => {
      expect(informationReads(question, now)).toEqual([{ kind: 'orders', name: 'list_food_orders', args: {} }]);
    });

  it('preserves one valid explicit day or one whole-week scope exactly', () => {
    expect(informationReads('2026-11-05 課表', now)[0].args).toEqual({ from: '2026-11-05', to: '2026-11-05' });
    expect(informationReads('明天課表', now)[0].args).toEqual({ from: '2026-11-05', to: '2026-11-05' });
    expect(informationReads('下週課表', now)[0].args).toEqual({ from: '2026-11-09', to: '2026-11-15' });
  });

  it.each(['今天課表', '有哪些作業要交？', '我的訂單進度'])
    ('returns directly from scoped readers without contacting the model: %s', async (question) => {
      const model = vi.fn(redirectOnly);
      const result = await ask(question, fixtureAdapter(), model);
      expect(result.steps.some((step) => step.status === 'ok')).toBe(true);
      expect(result.modelCalls).toBe(0);
      expect(model).not.toHaveBeenCalled();
    });
});

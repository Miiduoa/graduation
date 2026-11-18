// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { getAssistantService } from '@campus/shared/src/assistantServices';
import {
  getOfficialCampusMapUrl,
  PROVIDENCE_LIBRARY_FLOOR_GUIDE_URL,
} from '@campus/shared/src/campusMapLookup';
import { partialAnswer, run } from './runner';
import {
  fakeModel, fixtureAdapter, fixtureBinding as binding,
  FIXTURE_NOW as now, FIXTURE_SECRET as secret,
} from './fixtures';

const usage = { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 };
const modelAnswer = '這是一段文字說明。';

async function answer(question: string) {
  const f = fixtureAdapter();
  const transit = vi.spyOn(f.adapter, 'transit');
  const ledger = vi.spyOn(f.adapter, 'ledger');
  const result = await run({
    question, history: [], binding, adapter: f.adapter, secret, now,
    writes: false, signal: new AbortController().signal, log: () => {},
    model: async () => ({ message: { role: 'assistant', content: modelAnswer }, usage }),
  });
  return { result, transit, ledger, writes: f.writes };
}

describe('library service and physical directions preloads', () => {
  it.each([
    '圖書館有哪些服務？',
    '幫我查圖書館館藏',
    '圖書館什麼時候開館',
    '圖書館借書流程怎麼走？',
    '圖書館網站怎麼走？',
    '開啟圖書館',
  ])('preloads only the library entry for a service question: %s', async (question) => {
    const { result, transit, ledger, writes } = await answer(question);
    expect(result.steps.map((step) => step.name)).toEqual(['get_campus_info']);
    expect(result.answer).toContain('/library?schoolId=fixture-school');
    expect(result.answer).not.toMatch(/\/map|\/bus|校園地圖/);
    expect(result.answer).not.toContain(modelAnswer);
    expect(transit).not.toHaveBeenCalled();
    expect(ledger).not.toHaveBeenCalled();
    expect(writes).toHaveLength(0);
  });

  it.each([
    '圖書館怎麼走，公車',
    '去圖書館怎麼走，順便看公車',
    '圖書館怎麼走',
    '帶我去圖書館',
    '圖書館在哪裡？',
  ])('keeps map and transit reads for an explicit physical route: %s', async (question) => {
    const { result, transit, writes } = await answer(question);
    expect(result.steps.map((step) => step.name)).toEqual(['get_campus_info', 'get_transit']);
    expect(result.answer).toContain('/map?schoolId=fixture-school');
    expect(result.answer).toContain('校園地圖');
    expect(result.answer).not.toContain(modelAnswer);
    expect(transit).toHaveBeenCalledTimes(1);
    expect(writes).toHaveLength(0);
  });

  it.each([
    '請翻譯「圖書館怎麼走」',
    '不要查圖書館，也不用告訴我怎麼走',
    '我昨天去圖書館怎麼走的？',
    '假設我說圖書館怎麼走，這句話是什麼意思？',
  ])('does not force route reads for quoted, negated or historical text: %s', async (question) => {
    const { result, transit } = await answer(question);
    expect(result.steps).toHaveLength(0);
    expect(transit).not.toHaveBeenCalled();
    expect(result.answer).toBe(modelAnswer);
  });

  it('retains the existing library route fixture when the model also asks for library information', async () => {
    const result = await run({
      question: '去圖書館怎麼走，順便看公車', history: [], binding,
      adapter: fixtureAdapter().adapter, secret, now, model: fakeModel(8),
      writes: false, signal: new AbortController().signal, log: () => {},
    });
    expect(result.steps.map((step) => step.name)).toEqual(expect.arrayContaining(['get_campus_info', 'get_transit']));
    expect(result.answer).toContain('/map?schoolId=fixture-school');
    expect(result.answer).toContain('/library?schoolId=fixture-school');
    expect(result.answer).toContain('校園地圖');
  });
});

describe('canonical service fallback links', () => {
  it.each([false, true])('preserves the library and school with the proper official-source description (wrapped=%s)', (wrapped) => {
    const value = { href: '/library?schoolId=pu', officialSource: PROVIDENCE_LIBRARY_FLOOR_GUIDE_URL };
    const result = partialAnswer([{ tool: 'get_campus_info', result: wrapped ? { data: value, note: 'ignored extra fields' } : value }], [], '圖書館有哪些服務？', now);
    expect(result).toContain('/library?schoolId=pu');
    expect(result).toContain('館藏查詢與圖書館服務');
    expect(result).toContain('校方樓層導覽');
    expect(result).toContain(PROVIDENCE_LIBRARY_FLOOR_GUIDE_URL);
    expect(result).not.toMatch(/\/map|校園位置|官方地圖/);
  });

  it('preserves an official map only when it belongs to the scoped school', () => {
    const result = partialAnswer([{ tool: 'get_campus_info', result: {
      href: '/map?schoolId=nthu', officialSource: getOfficialCampusMapUrl('nthu'),
    } }], [], '圖書館怎麼走', now);
    expect(result).toContain('/map?schoolId=nthu');
    expect(result).toContain('官方地圖：' + getOfficialCampusMapUrl('nthu'));

    for (const officialSource of ['https://untrusted.example/map', getOfficialCampusMapUrl('pu')]) {
      const rejected = partialAnswer([{ tool: 'get_campus_info', result: {
        href: '/map?schoolId=nthu', officialSource,
      } }], [], '圖書館怎麼走', now);
      expect(rejected).toContain('/map?schoolId=nthu');
      expect(rejected).not.toContain(officialSource);
    }
  });

  it('rejects noncanonical, foreign and unexpected campus-info destinations', () => {
    for (const href of [
      'https://untrusted.example/library', '//untrusted.example/library',
      '/library?schoolId=pu&redirect=https://untrusted.example',
      '/library?schoolId=pu&schoolId=nthu', '/library?schoolId=pu#redirect',
      '/library?schoolId=pu%26next%3Dadmin', '/library/../admin?schoolId=pu',
      '/admin?schoolId=pu', '/library?schoolId=', '/library?campus=nthu',
      '/library?schoolId=%70u', '/library?schoolId=pu\n', 'javascript:alert(1)',
    ]) {
      const result = partialAnswer([{ tool: 'get_campus_info', result: {
        href, officialSource: 'https://untrusted.example/official',
      } }], [], '圖書館有哪些服務？', now);
      expect(result, href).not.toContain(href);
      expect(result, href).not.toMatch(/https?:|\/library|\/admin|\/map/);
    }
  });

  it('uses canonical labels and validates the declared ID before showing a catalog link', () => {
    const result = partialAnswer([{ tool: 'list_campus_services', result: { schoolId: 'pu', services: [
      { id: 'library', href: '/library?schoolId=pu', label: 'untrusted-label', summary: 'untrusted-summary' },
      { id: 'orders', href: '/food?schoolId=pu' },
      { id: 'assistant-permissions', href: '/settings?section=assistant&schoolId=pu' },
      { id: 'library', href: '/map?schoolId=pu' },
      { id: 'map', href: '/map?schoolId=nthu' },
      { id: 'map', href: '//untrusted.example/map' },
      { id: 'unknown-service', href: '/admin?schoolId=pu' },
    ] } }], [], '有哪些服務', now);
    expect(result).toContain(getAssistantService('library')!.summary);
    expect(result).toContain('/library?schoolId=pu');
    expect(result).toContain('/food?schoolId=pu');
    expect(result).toContain('/settings?section=assistant&schoolId=pu');
    expect(result).not.toMatch(/untrusted|\/map|\/admin|\/orders/);
  });

  it.each(['list_food_orders', 'get_food_order'])('keeps platform order fallbacks in FoodWorkspace: %s', (tool) => {
    const result = partialAnswer([{ tool, result: { orders: [] } }], [], '查看我的訂單', now);
    expect(result).toContain('/food');
    expect(result).not.toContain('/orders');
  });
});

// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { ASSISTANT_SERVICES } from '@campus/shared/src/assistantServices';
import type { PersonalImportRecord } from '@campus/shared/src/imports/types';
import { pageHref, signCard, confirm } from './actions';
import { createTools, schemas, selectTools, validateTool } from './tools';
import { run, toolSummary } from './runner';
import { fixtureAdapter, fixtureBinding as binding, FIXTURE_NOW as now, FIXTURE_SECRET as secret } from './fixtures';
import type { Model } from './contracts';

const grade: PersonalImportRecord = {
  id: 'grade-a', kind: 'grades', title: '資料庫管理', schoolId: binding.schoolId,
  academicYear: '115', semester: '1', credits: 3, grade: '87', courseCode: 'IM201',
  batchId: 'import-a', importedAt: '2026-11-01T10:00:00.000Z',
  source: { type: 'paste', line: 1, rawText: 'never-share-this-source' },
};

describe('cross-feature agent tools', () => {
  it('advertises every registered page and preserves fixed query parameters', () => {
    const spec = schemas(['propose_open_page'])[0].function.parameters.properties;
    expect(spec.page.enum).toEqual(ASSISTANT_SERVICES.map((service) => service.id));
    expect(pageHref({ page: 'assistant-permissions' }, 'nthu')).toBe('/settings?section=assistant&schoolId=nthu');
    expect(pageHref({ page: 'messages' }, 'pu')).toBe('/dms?schoolId=pu');
    expect(pageHref({ page: 'notifications' }, 'pu')).toBe('/messages?schoolId=pu');
    expect(() => pageHref({ page: 'https://example.invalid' }, 'pu')).toThrow();
  });

  it('lists service handoffs with no private adapter calls or write promises', async () => {
    const f = fixtureAdapter();
    const ledger = vi.spyOn(f.adapter, 'ledger');
    const courses = vi.spyOn(f.adapter, 'courses');
    const tools = createTools(f.adapter, binding, secret, now, false);
    const result = await tools.call('list_campus_services', { serviceId: 'admin' });
    expect(result.value).toMatchObject({ services: [{ id: 'admin', access: 'admin', href: '/admin?schoolId=fixture-school' }] });
    expect(ledger).not.toHaveBeenCalled();
    expect(courses).not.toHaveBeenCalled();
    expect(tools.cards).toHaveLength(0);
    expect(f.writes).toHaveLength(0);
  });

  it('routes a signed service handoff only within its account and school binding', async () => {
    const f = fixtureAdapter();
    const card = signCard(binding, 'propose_open_page', { page: 'credits' }, 0, secret, now);
    await expect(confirm({ ...binding, account: 'other' }, { token: card.token, args: card.args }, secret, now, f.adapter, false)).rejects.toThrow();
    await expect(confirm(binding, { token: card.token, args: card.args }, secret, now, f.adapter, false))
      .resolves.toMatchObject({ href: '/credit-planner?schoolId=fixture-school' });
    expect(f.writes).toHaveLength(0);
  });

  it('opens an observed platform order in the correct food workspace and realm', async () => {
    const f = fixtureAdapter();
    const tools = createTools(f.adapter, binding, secret, now, false);
    await tools.call('list_food_orders', { tenantId: 'fixture-realm' });
    await tools.call('propose_open_page', { page: 'orders', entityId: 'order-a' });
    const card = tools.cards[0];
    expect(card.args).toEqual({ page: 'orders', entityId: 'order-a', tenantId: 'fixture-realm' });
    expect(card.destination).toBe('/food?schoolId=fixture-school&tenant=fixture-realm&order=order-a');
    await expect(confirm(binding, { token: card.token, args: card.args }, secret, now, f.adapter, false))
      .resolves.toMatchObject({ href: card.destination });
    await expect(confirm(binding, { token: card.token, args: { ...card.args, tenantId: 'other' } }, secret, now, f.adapter, false))
      .rejects.toThrow();
    expect(f.writes).toHaveLength(0);
  });

  it('rejects forged, unseen and cross-realm ambiguous order destinations', async () => {
    const f = fixtureAdapter();
    f.adapter.realms = async () => ['realm-a', 'realm-b'].map((tenantId) => ({ tenantId, schoolId: binding.schoolId }));
    const tools = createTools(f.adapter, binding, secret, now, false);
    expect(() => validateTool('propose_open_page', { page: 'orders', entityId: 'order-a', tenantId: 'realm-a' })).toThrow();
    expect(() => pageHref({ page: 'orders', entityId: 'order-a' }, binding.schoolId)).toThrow();
    await expect(tools.call('propose_open_page', { page: 'orders', entityId: 'order-a' }))
      .rejects.toMatchObject({ status: 403 });
    await tools.call('list_food_orders', { tenantId: 'realm-a' });
    await tools.call('list_food_orders', { tenantId: 'realm-b' });
    await expect(tools.call('propose_open_page', { page: 'orders', entityId: 'order-a' }))
      .rejects.toMatchObject({ status: 403 });
    expect(tools.cards).toHaveLength(0);
  });

  it('reads only the bound academic ledger, retains unknown grades and masks provider output', async () => {
    const f = fixtureAdapter();
    f.adapter.ledger = async () => ({ schoolId: binding.schoolId, revision: 1, updatedAt: null, records: [grade] });
    const result = await createTools(f.adapter, binding, secret, now, false).call('get_imported_academics', {});
    expect(result.value).toMatchObject({ source: 'personal-import', official: false, listedCredits: 3, records: [{ grade: '87' }] });
    expect(JSON.stringify(result)).not.toContain('never-share-this-source');
    const providerSummary = toolSummary(result.value, 5000);
    expect(providerSummary).toContain('[已遮罩]');
    expect(providerSummary).not.toContain('"grade":"87"');
    f.adapter.ledger = async () => ({ schoolId: 'other', revision: 1, updatedAt: null, records: [grade] });
    await expect(createTools(f.adapter, binding, secret, now, false).call('get_imported_academics', {}))
      .rejects.toMatchObject({ status: 403 });
  });

  it('selects imported academics only when the question asks for saved records', () => {
    expect(selectTools('我的成績', false)).not.toContain('get_imported_academics');
    expect(selectTools('我匯入的成績', false)).toContain('get_imported_academics');
  });

  it('enforces schema bounds and selects the new tools for the appropriate domain', () => {
    expect(selectTools('我想核對匯入成績與學分紀錄', false)).toContain('get_imported_academics');
    expect(selectTools('有哪些功能可以使用', false)).toContain('list_campus_services');
    for (const args of [{ schoolId: 'other' }, { limit: 100 }, { offset: -1 }, { academicYear: '今年' }])
      expect(() => validateTool('get_imported_academics', args)).toThrow();
  });

  it('returns the library service rather than a map for a library information handoff', async () => {
    const result = await createTools(fixtureAdapter().adapter, binding, secret, now, false)
      .call('get_campus_info', { kind: 'library' });
    expect(result.value).toMatchObject({ href: '/library?schoolId=fixture-school' });
  });

  it('renders verified grades directly after a model-selected read and does not accept a guessed graduation result', async () => {
    const f = fixtureAdapter();
    f.adapter.ledger = async () => ({ schoolId: binding.schoolId, revision: 1, updatedAt: null, records: [grade] });
    let calls = 0;
    const model: Model = async (input) => {
      if (calls++) {
        expect(JSON.stringify(input.messages)).not.toContain('"grade":"87"');
        return { message: { role: 'assistant', content: '成績 99，已滿足畢業資格。' },
          usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } };
      }
      return { message: { role: 'assistant', tool_calls: [{ id: 'grade-read', type: 'function',
        function: { name: 'get_imported_academics', arguments: '{}' } }] },
        usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } };
    };
    const result = await run({ question: '核對我匯入的成績紀錄', history: [], binding,
      adapter: f.adapter, model, secret, writes: false, signal: new AbortController().signal, now, log: () => {} });
    expect(result.answer).toContain('成績：87');
    expect(result.answer).not.toContain('成績 99');
    expect(result.answer).not.toContain('已滿足畢業資格');
    expect(result.steps).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'get_imported_academics', status: 'ok' })]));
  });
});

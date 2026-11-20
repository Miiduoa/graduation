// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { fixtureAdapter, fixtureBinding as binding, FIXTURE_NOW as now, FIXTURE_SECRET as secret } from './fixtures';
import { createTools } from './tools';
import { run } from './runner';
afterEach(() => vi.unstubAllEnvs());
it('rejects unknown sequences on a restarted issuer and keeps local cards working without Fly', async () => {
  vi.stubEnv('FLY_MACHINE_ID', 'machine-A');
  const a = await import('./actions');
  const oldCard = a.signCard(binding, 'propose_open_page', { page: 'calendar' }, 1, secret, now);
  const old = { token: oldCard.token, args: oldCard.args };
  vi.resetModules();
  const restarted = await import('./actions');
  expect(() => restarted.verifyCard(binding, old, secret, now)).toThrow(expect.objectContaining({ code: 'CONFIRMATION_REVOKED' }));
  vi.stubEnv('FLY_MACHINE_ID', '');
  const localCard = restarted.signCard(binding, 'propose_open_page', { page: 'calendar' }, 1, secret, now);
  const local = { token: localCard.token, args: localCard.args };
  expect(restarted.cardIssuer(local, secret)).toBeUndefined();
  expect(restarted.verifyCard(binding, local, secret, now).tool).toBe('propose_open_page');
  restarted.beginProposal(binding, now);
  expect(() => restarted.verifyCard(binding, local, secret, now)).toThrow(expect.objectContaining({ code: 'CONFIRMATION_REVOKED' }));
});
it('filters historical submitted and overdue work by the requested interval', async () => {
  const tools = createTools(fixtureAdapter().adapter, binding, secret, now, true);
  const current = (await tools.call('get_due_work', {})).value;
  expect(current).toMatchObject({ overdue: [], submitted: [expect.objectContaining({ id: 'task-done' })] });
  const past = (await tools.call('get_due_work', { from: '2026-11-01', to: '2026-11-03' })).value;
  expect(past).toMatchObject({ submitted: [], overdue: [expect.objectContaining({ id: 'task-late' })] });
});
it('asks about work without preloading schedule, events or realms', async () => {
  const f = fixtureAdapter();
  const ledger = vi.spyOn(f.adapter, 'ledger');
  const realms = vi.spyOn(f.adapter, 'realms');
  await run({ question: '這週有哪些作業要交？', history: [], binding, adapter: f.adapter, secret, now, writes: true, signal: new AbortController().signal,
    model: async () => ({ message: { role: 'assistant', content: '請查詢待繳作業。' }, usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } }), log: () => {} });
  expect(ledger).not.toHaveBeenCalled();
  expect(realms).not.toHaveBeenCalled();
});

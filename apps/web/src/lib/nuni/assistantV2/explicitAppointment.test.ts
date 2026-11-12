// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { confirm } from './actions';
import { run } from './runner';
import { V2Error, type Model } from './contracts';
import { fixtureAdapter, fixtureBinding as binding, FIXTURE_NOW as now, FIXTURE_SECRET as secret } from './fixtures';

const noModel: Model = async () => { throw new Error('This exact appointment does not need generation'); };
const ask = (question: string, f = fixtureAdapter(), writes = true) => run({
  question, history: [], binding, adapter: f.adapter, model: noModel, now, secret,
  writes, signal: new AbortController().signal, log: () => {},
});

describe('explicit personal appointments use the existing confirmation flow', () => {
  it('prepares the exact title/date/range and writes once only after confirmation', async () => {
    const f = fixtureAdapter();
    const result = await ask('幫我明天 19:00 到 20:00 安排英文讀書', f);
    expect(result.modelCalls).toBe(0);
    expect(result.cards).toHaveLength(1);
    expect(result.cards[0]).toMatchObject({ tool: 'propose_personal_event', args: {
      title: '英文讀書', date: '2026-11-05', allDay: false, startTime: '19:00', endTime: '20:00',
    } });
    expect(result.answer).toContain('按下確認後');
    expect(f.writes).toHaveLength(0);
    const card = result.cards[0];
    const raw = { token: card.token, args: card.args };
    const first = await confirm(binding, raw, secret, now + 1000, f.adapter, true);
    const replay = await confirm(binding, raw, secret, now + 2000, f.adapter, true);
    expect(first).toMatchObject({ status: 'verified' });
    expect(replay).toMatchObject({ status: 'verified' });
    expect(f.writes).toHaveLength(1);
    expect(f.snapshot().records).toContainEqual(expect.objectContaining({ title: '英文讀書', date: '2026-11-05', startTime: '19:00', endTime: '20:00' }));
  });

  it('does not turn a blocked time into a different event or write', async () => {
    const f = fixtureAdapter();
    const result = await ask('幫我今天 13:00 到 14:00 安排英文讀書', f);
    expect(result.answer).toContain('重疊');
    expect(result.cards).toHaveLength(0);
    expect(f.writes).toHaveLength(0);
  });

  it('preserves the supplied title instead of converting it into a generic homework title', async () => {
    const result = await ask('幫我明天 19:00 到 20:00 安排寫英文');
    expect(result.cards[0].args.title).toBe('寫英文');
  });

  it('keeps writes disabled without creating a false success receipt', async () => {
    const f = fixtureAdapter();
    const result = await ask('幫我明天 19:00 到 20:00 安排英文讀書', f, false);
    expect(result.answer).toContain('尚未加入行事曆');
    expect(result.cards).toHaveLength(0);
    expect(f.writes).toHaveLength(0);
  });

  it('rejects past or invalid ranges before reading any ledger', async () => {
    const f = fixtureAdapter();
    const ledger = vi.spyOn(f.adapter, 'ledger');
    for (const question of [
      '幫我今天 09:00 到 10:00 安排英文讀書',
      '幫我明天 20:00 到 19:00 安排英文讀書',
    ]) {
      const result = await ask(question, f);
      expect(result.cards).toHaveLength(0);
    }
    expect(ledger).not.toHaveBeenCalled();
    expect(f.writes).toHaveLength(0);
  });

  it('preserves authentication failures from the original proposal reader', async () => {
    const f = fixtureAdapter();
    vi.spyOn(f.adapter, 'ledger').mockRejectedValue(new V2Error(401, 'UNAUTHENTICATED'));
    await expect(ask('幫我明天 19:00 到 20:00 安排英文讀書', f)).rejects.toMatchObject({ status: 401 });
    expect(f.writes).toHaveLength(0);
  });
});

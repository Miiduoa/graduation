// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { isAssistantTaskRetryQuestion, parseAssistantTaskRetry } from '@campus/shared/src/assistantTaskRetry';

const step = { id: 'task-1', serviceId: 'bus', label: '查公車', dependsOn: [], status: 'blocked', summary: '尚未讀取' };
const plan = { version: 1, steps: [step] };
const retry = () => ({ version: 1, token: 'signedbody.' + 's'.repeat(43), stepIds: ['task-1'], expiresAt: 1793760300000 });

describe('read-only task continuation display contract', () => {
  it('validates and copies the exact failed-step scope', () => {
    const raw = retry(), parsed = parseAssistantTaskRetry(raw, plan);
    expect(parsed).toEqual(raw);
    raw.stepIds.push('another-task');
    expect(parsed?.stepIds).toEqual(['task-1']);
  });
  it.each([
    { token: 'not-signed' }, { token: 'x'.repeat(8193) }, { expiresAt: NaN }, { expiresAt: 0 },
    { expiresAt: 1.5 }, { expiresAt: 8640000000000001 }, { version: 2 }, { stepIds: [] },
    { stepIds: ['task-1', 'task-1'] }, { stepIds: ['bad/id'] }, { extra: true },
    { stepIds: Array.from({ length: 17 }, (_, index) => 'task-' + index) },
  ])('rejects malformed credentials %j', change => {
    expect(parseAssistantTaskRetry({ ...retry(), ...change })).toBeNull();
  });
  it.each(['completed', 'ready', 'handoff'])('refuses a %s step', status => {
    expect(parseAssistantTaskRetry(retry(), { version: 1, steps: [{ ...step, status }] })).toBeNull();
  });
  it('refuses cards, missing steps and an invalid dependency plan', () => {
    expect(parseAssistantTaskRetry(retry(), { version: 1, steps: [{ ...step, cardIds: ['card-1'] }] })).toBeNull();
    expect(parseAssistantTaskRetry({ ...retry(), stepIds: ['unknown'] }, plan)).toBeNull();
    expect(parseAssistantTaskRetry(retry(), { version: 1, steps: [{ ...step, dependsOn: ['missing'] }] })).toBeNull();
  });
  it('never invokes accessors or accepts sparse or augmented arrays', () => {
    const getter = vi.fn(() => 'secret');
    const raw = retry();
    Object.defineProperty(raw, 'token', { enumerable: true, get: getter });
    expect(parseAssistantTaskRetry(raw)).toBeNull();
    const ids = ['task-1'];
    Object.defineProperty(ids, '0', { enumerable: true, get: getter });
    expect(parseAssistantTaskRetry({ ...retry(), stepIds: ids })).toBeNull();
    expect(parseAssistantTaskRetry({ ...retry(), stepIds: new Array(1) })).toBeNull();
    expect(parseAssistantTaskRetry({ ...retry(), stepIds: Object.assign(['task-1'], { extra: true }) })).toBeNull();
    expect(getter).not.toHaveBeenCalled();
  });
});

describe('explicit natural-language retry selection', () => {
  it.each(['重試沒完成的', '重試沒完成', '重新查詢未完成項目', '繼續查沒完成的', '只重查失敗的步驟',
    '請幫我重試未完成的項目。', '幫我把還沒查到的再查一次', '未完成的再查一次', '  重查 未完成 項目  '])('accepts %s', question => {
    expect(isAssistantTaskRetryQuestion(question)).toBe(true);
  });
  it.each(['不要重試沒完成的', '重試沒完成的，再幫我下單', '如果重試沒完成的會怎樣', '翻譯重試沒完成的',
    '重試沒完成的並取消訂單', '已完成的再查一次', '繼續', '重試沒完成的\u200b', '重試\n沒完成的'])('does not turn %s into a retry', question => {
    expect(isAssistantTaskRetryQuestion(question)).toBe(false);
  });
});

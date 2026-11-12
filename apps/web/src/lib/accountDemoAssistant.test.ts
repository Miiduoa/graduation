import { describe, expect, it, vi } from 'vitest';
import {
  createAccountDemoPermissions,
  createAccountDemoState,
  type AccountDemoSnapshot,
} from '@campus/shared/src/accountDemo';
import {
  accountDemoAssistantIntent,
  executeAccountDemoAssistant,
  prepareAccountDemoAssistant,
  type AccountDemoAssistantProposal,
} from './accountDemoAssistant';

const scope = {
  context: 'session-context',
  accountId: 'pa_11111111-1111-4111-8111-111111111111',
  schoolId: 'pu',
};
function snapshot(): AccountDemoSnapshot {
  return {
    accountId: scope.accountId,
    revision: 3,
    profile: { displayName: '展示同學', schoolId: 'pu', schoolName: '靜宜大學', studentId: 'DEMO123456', department: '資訊管理學系' },
    permissions: createAccountDemoPermissions(true),
    state: createAccountDemoState(),
    expiresAt: '2099-12-01T00:00:00.000Z',
  };
}
function proposal(demo = snapshot()): AccountDemoAssistantProposal {
  return { id: 'proposal', action: 'createOrder', snapshot: demo };
}
describe('explicit account demonstration intents', () => {
  it.each([
    ['展示點餐', 'createOrder'], ['幫我示範預約圖書館座位', 'reserveSeat'],
    ['演示續借圖書', 'renewBook'], ['查看展示進度', 'overview'],
    ['展示幫我送出請假！', 'requestLeave'], ['demo標示可取餐', 'readyOrder'],
  ])('recognizes %s', (question, action) => {
    expect(accountDemoAssistantIntent(question)).toBe(action);
  });
  it.each(['幫我點餐', '展示別人的訂單', '展示刪除帳號', '不要展示點餐', '展示點餐並付款', '開啟學生證'])('does not reinterpret %s as a demo write', (question) => {
    expect(accountDemoAssistantIntent(question)).toBeNull();
  });
});

it('reads only the current account and produces a proposal without writing', async () => {
  const read = vi.fn(async () => ({ demo: snapshot() }));
  const answer = await prepareAccountDemoAssistant('展示點餐', scope, read);
  expect(answer?.proposal?.action).toBe('createOrder');
  expect(answer?.proposal?.snapshot.accountId).toBe(scope.accountId);
  expect(read.mock.calls).toEqual([[]]);
});
it('keeps ordinary requests out of the demonstration transport', async () => {
  const read = vi.fn();
  expect(await prepareAccountDemoAssistant('幫我點餐', scope, read)).toBeNull();
  expect(read).not.toHaveBeenCalled();
});
it('reports real saved progress and does not repeat completed operations', async () => {
  const demo = snapshot();
  demo.state.createOrder = true;
  const read = async () => ({ demo });
  expect((await prepareAccountDemoAssistant('查看展示進度', scope, read))?.answer).toContain('等待店家備餐');
  const answer = await prepareAccountDemoAssistant('展示點餐', scope, read);
  expect(answer?.answer).toContain('沒有重複送出');
  expect(answer?.proposal).toBeUndefined();
});
it.each(['foreign', 'school', 'expired', 'assistant', 'food'] as const)('rejects %s data before creating a proposal', async (change) => {
  const demo = snapshot();
  if (change === 'foreign') demo.accountId = 'pa_22222222-2222-4222-8222-222222222222';
  if (change === 'school') demo.profile.schoolId = 'nthu';
  if (change === 'expired') demo.expiresAt = '2000-01-01T00:00:00.000Z';
  if (change === 'assistant') demo.permissions.assistant = false;
  if (change === 'food') demo.permissions.food = false;
  await expect(prepareAccountDemoAssistant('展示點餐', scope, async () => ({ demo }))).rejects.toThrow();
});
it('requires the saved prerequisite before proposing a merchant update', async () => {
  await expect(prepareAccountDemoAssistant('展示標示可取餐', scope, async () => ({ demo: snapshot() }))).rejects.toThrow('前一步');
});
it('executes one CAS update and verifies the complete saved result with a second read', async () => {
  let demo = snapshot();
  const request = vi.fn(async (input?: { expectedRevision: number; action: string }) => {
    if (input) demo = { ...demo, revision: demo.revision + 1, state: { ...demo.state, createOrder: true } };
    return { demo };
  });
  const result = await executeAccountDemoAssistant(proposal(demo), scope, request);
  expect(result.state.createOrder).toBe(true);
  expect(request.mock.calls).toEqual([[], [{ expectedRevision: 3, action: 'createOrder' }], []]);
});
it('does not write after permission or revision changed', async () => {
  const demo = snapshot();
  demo.revision++;
  const request = vi.fn(async () => ({ demo }));
  await expect(executeAccountDemoAssistant(proposal(), scope, request)).rejects.toThrow('資料已變更');
  expect(request.mock.calls).toEqual([[]]);
});
it('checks changed session state again after reading and before writing', async () => {
  let active = true;
  const request = vi.fn(async () => { active = false; return { demo: snapshot() }; });
  await expect(executeAccountDemoAssistant(proposal(), scope, request, () => active)).rejects.toThrow('登入或校園已變更');
  expect(request.mock.calls).toEqual([[]]);
});
it.each(['unchanged-state', 'permissions-changed', 'unconfirmed-read'] as const)('refuses success for %s', async (failure) => {
  const before = snapshot();
  const after = { ...before, revision: before.revision + 1, state: { ...before.state, createOrder: true } };
  let read = 0;
  const request = vi.fn(async (input?: { expectedRevision: number; action: string }) => {
    if (!input) return { demo: read++ === 0 ? before : failure === 'unconfirmed-read' ? { ...after, revision: after.revision + 1 } : after };
    return { demo: failure === 'unchanged-state' ? { ...after, state: before.state }
      : failure === 'permissions-changed' ? { ...after, permissions: { ...after.permissions, food: false } } : after };
  });
  await expect(executeAccountDemoAssistant(proposal(before), scope, request)).rejects.toThrow('尚未核對');
});

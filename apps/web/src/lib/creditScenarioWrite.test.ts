import { expect, it, vi } from 'vitest';
import { emptyCreditPlan } from './creditPlanner';
import { replaceLocalScenarioPlan } from './creditScenarioWrite';
it('rejects stale scope before reading or writing', () => {
  const storage = { getItem: vi.fn(), setItem: vi.fn() };
  expect(() => replaceLocalScenarioPlan(storage, 'a', emptyCreditPlan(), emptyCreditPlan(), () => false)).toThrow(/失效/);
  expect(storage.getItem).not.toHaveBeenCalled(); expect(storage.setItem).not.toHaveBeenCalled();
});
it('refuses corrupt or different local baselines', () => {
  for (const raw of ['{bad', JSON.stringify({ ...emptyCreditPlan(), target: '123' })]) {
    const storage = { getItem: vi.fn(() => raw), setItem: vi.fn() };
    expect(() => replaceLocalScenarioPlan(storage, 'a', emptyCreditPlan(), emptyCreditPlan(), () => true)).toThrow(/其他分頁/);
    expect(storage.setItem).not.toHaveBeenCalled();
  }
});
it('rechecks identity after storage read and propagates actual write errors', () => {
  let current = true;
  const storage = { getItem: vi.fn(() => { current = false; return null; }), setItem: vi.fn() };
  expect(() => replaceLocalScenarioPlan(storage, 'a', emptyCreditPlan(), emptyCreditPlan(), () => current)).toThrow(/帳號或輸入/);
  expect(storage.setItem).not.toHaveBeenCalled();
  storage.getItem.mockImplementation(() => null); storage.setItem.mockImplementation(() => { throw new Error('quota'); });
  expect(() => replaceLocalScenarioPlan(storage, 'a', emptyCreditPlan(), emptyCreditPlan(), () => true)).toThrow('quota');
});

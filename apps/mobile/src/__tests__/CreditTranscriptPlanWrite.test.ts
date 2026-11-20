import AsyncStorage from '@react-native-async-storage/async-storage';
import { emptyCreditPlan } from '@campus/shared/src/creditPlanner';
import { replaceReviewedCreditPlan, writeMobileCreditPlan } from '../features/academics/creditPlanRepository';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true, default: { getItem: jest.fn(), setItem: jest.fn() },
}));
const read = jest.mocked(AsyncStorage.getItem);
const write = jest.mocked(AsyncStorage.setItem);
const key = 'review-user-a-school-pu';
const initial = () => ({ ...emptyCreditPlan(), recognized: '10' });
const next = () => ({ ...emptyCreditPlan(), recognized: '60' });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
beforeEach(() => { jest.clearAllMocks(); read.mockReset().mockResolvedValue(JSON.stringify(initial())); write.mockReset().mockResolvedValue(undefined); });

test('writes once to the requested scope only after matching the preview baseline', async () => {
  await replaceReviewedCreditPlan(key, initial(), next(), () => true);
  expect(read).toHaveBeenCalledWith(key);
  expect(write).toHaveBeenCalledTimes(1);
  expect(write).toHaveBeenCalledWith(key, JSON.stringify(next()));
});

test('refuses to overwrite another screen update, missing storage or corruption', async () => {
  for (const raw of [JSON.stringify({ ...initial(), target: '150' }), null, '{broken']) {
    read.mockResolvedValueOnce(raw);
    await expect(replaceReviewedCreditPlan(key, initial(), next(), () => true)).rejects.toThrow(/原規劃已變更/);
  }
  expect(write).not.toHaveBeenCalled();
});

test('can initialize a truly new plan but does not conflate invalid data with empty', async () => {
  read.mockResolvedValueOnce(null);
  await replaceReviewedCreditPlan(key, emptyCreditPlan(), next(), () => true);
  expect(write).toHaveBeenCalledTimes(1);
});

test('rejects a stale session both before reading and after an asynchronous read', async () => {
  await expect(replaceReviewedCreditPlan(key, initial(), next(), () => false)).rejects.toThrow(/失效/);
  expect(read).not.toHaveBeenCalled();
  const pending = deferred<string | null>();
  let active = true;
  read.mockReturnValueOnce(pending.promise);
  const operation = replaceReviewedCreditPlan(key, initial(), next(), () => active);
  await Promise.resolve(); await Promise.resolve();
  active = false; pending.resolve(JSON.stringify(initial()));
  await expect(operation).rejects.toThrow(/失效/);
  expect(write).not.toHaveBeenCalled();
});

test('waits for an already accepted save, then rejects its now stale preview', async () => {
  const pending = deferred<void>();
  write.mockReturnValueOnce(pending.promise);
  const updated = { ...initial(), target: '200' };
  const olderSave = writeMobileCreditPlan(key, updated);
  read.mockResolvedValueOnce(JSON.stringify(updated));
  const replacement = replaceReviewedCreditPlan(key, initial(), next(), () => true);
  pending.resolve(undefined);
  await olderSave;
  await expect(replacement).rejects.toThrow(/原規劃已變更/);
  expect(write).toHaveBeenCalledTimes(1);
  expect(write).toHaveBeenCalledWith(key, JSON.stringify(updated));
});

test('propagates storage errors and permits a later deliberate retry', async () => {
  write.mockRejectedValueOnce(new Error('disk full'));
  await expect(replaceReviewedCreditPlan(key, initial(), next(), () => true)).rejects.toThrow('disk full');
  await replaceReviewedCreditPlan(key, initial(), next(), () => true);
  expect(write).toHaveBeenCalledTimes(2);
});

test('two confirmations cannot both apply to the same earlier version', async () => {
  let raw = JSON.stringify(initial());
  read.mockImplementation(async () => raw);
  write.mockImplementation(async (_key, value) => { raw = value; });
  const first = replaceReviewedCreditPlan(key, initial(), next(), () => true);
  const second = replaceReviewedCreditPlan(key, initial(), { ...next(), recognized: '90' }, () => true);
  await first;
  await expect(second).rejects.toThrow(/原規劃已變更/);
  expect(write).toHaveBeenCalledTimes(1);
  expect(JSON.parse(raw).recognized).toBe('60');
});

test('invalid proposals are rejected before touching storage', async () => {
  await expect(replaceReviewedCreditPlan(key, initial(), { ...next(), recognized: '-1' }, () => true)).rejects.toThrow(/格式/);
  expect(read).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled();
});

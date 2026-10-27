import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  mobileCreditPlanKey, parsePortableCreditPlan, portableCreditPlanJson,
  readMobileCreditPlan, writeMobileCreditPlan, creditPlanUtf8Bytes,
} from '../features/academics/creditPlanRepository';
import { creditPlanSummary, emptyCreditPlan, type CreditPlan } from '@campus/shared/src/creditPlanner';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true, default: { getItem: jest.fn(), setItem: jest.fn() },
}));
const read = AsyncStorage.getItem as jest.MockedFunction<typeof AsyncStorage.getItem>;
const write = AsyncStorage.setItem as jest.MockedFunction<typeof AsyncStorage.setItem>;
function sample(): CreditPlan {
  return { ...emptyCreditPlan(), recognized: '60', target: '128', extra: '5', terms: 3,
    courses: [
      { id: 'a', name: '資料庫', credits: 3, term: 1, category: 'required', status: 'considering' },
      { id: 'b', name: '資料探勘', credits: 2.5, term: 2, category: 'elective', status: 'registered' },
    ],
    categoryGoals: { ...emptyCreditPlan().categoryGoals, required: { recognized: '20', target: '35' } },
    milestones: [{ id: 'check', label: '英文能力門檻', done: false }],
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
beforeEach(() => {
  jest.clearAllMocks();
  read.mockReset().mockResolvedValue(null);
  write.mockReset().mockResolvedValue(undefined);
});

test('uses a unique key per account and school, without reading a global draft', async () => {
  const key = mobileCreditPlanKey('a', 'pu');
  expect(key).not.toBe(mobileCreditPlanKey('b', 'pu'));
  expect(key).not.toBe(mobileCreditPlanKey('a', 'nchu'));
  expect(key).not.toBe(mobileCreditPlanKey(null, 'pu'));
  expect(await readMobileCreditPlan(key)).toEqual(emptyCreditPlan());
  expect(read).toHaveBeenCalledTimes(1);
  expect(read).toHaveBeenCalledWith(key);
  expect(write).not.toHaveBeenCalled();
});

test('retains Web/mobile JSON format and identical target math', async () => {
  const plan = sample();
  const json = portableCreditPlanJson(plan);
  expect(parsePortableCreditPlan(json)).toEqual(plan);
  expect(parsePortableCreditPlan('\ufeff' + json)).toEqual(plan);
  const result = creditPlanSummary(plan);
  expect(result.courseCredits).toBe(5.5);
  expect(result.remaining).toBe(57.5);
  expect(result.categoryGaps.find((row) => row.key === 'required')?.remaining).toBe(12);
  await writeMobileCreditPlan('roundtrip', plan);
  expect(write).toHaveBeenCalledWith('roundtrip', JSON.stringify(plan));
  read.mockResolvedValueOnce(json);
  expect(await readMobileCreditPlan('roundtrip')).toEqual(plan);
});

test('corrupt data and malformed backups never cause an empty replacement write', async () => {
  read.mockResolvedValueOnce('{bad');
  await expect(readMobileCreditPlan('corrupt')).rejects.toThrow(/無法驗證/);
  await expect(writeMobileCreditPlan('corrupt', { ...sample(), target: 'invalid' })).rejects.toThrow(/格式錯誤/);
  expect(write).not.toHaveBeenCalled();
  expect(() => parsePortableCreditPlan('{bad')).toThrow(/備份格式/);
  expect(() => parsePortableCreditPlan(JSON.stringify({ ...sample(), version: 3 }))).toThrow(/備份格式/);
  expect(() => parsePortableCreditPlan(JSON.stringify({ ...sample(), courses: [sample().courses[0], sample().courses[0]] }))).toThrow(/備份格式/);
});

test('a remount read waits for the accepted write on the same account/campus', async () => {
  const gate = deferred<void>();
  let persisted: string | null = null;
  write.mockImplementationOnce(async (_key, raw) => { await gate.promise; persisted = raw; });
  read.mockImplementation(async () => persisted);
  const saving = writeMobileCreditPlan('same-scope', sample());
  const reloading = readMobileCreditPlan('same-scope');
  await Promise.resolve();
  expect(read).not.toHaveBeenCalled();
  gate.resolve(undefined);
  await saving;
  expect(await reloading).toEqual(sample());
});

test('an unrelated campus is not blocked by another pending write', async () => {
  const gate = deferred<void>();
  write.mockImplementationOnce(async () => gate.promise);
  const saving = writeMobileCreditPlan('busy-campus', sample());
  expect(await readMobileCreditPlan('other-campus')).toEqual(emptyCreditPlan());
  gate.resolve(undefined);
  await saving;
});

test('rapid writes keep order and capture the values at the time of submission', async () => {
  const gate = deferred<void>();
  const first = sample();
  write.mockImplementationOnce(async () => gate.promise);
  const a = writeMobileCreditPlan('ordered', first);
  first.target = '999';
  const b = writeMobileCreditPlan('ordered', { ...sample(), target: '140' });
  await Promise.resolve();
  expect(write).toHaveBeenCalledTimes(1);
  expect(JSON.parse(write.mock.calls[0][1]).target).toBe('128');
  gate.resolve(undefined);
  await Promise.all([a, b]);
  expect(JSON.parse(write.mock.calls[1][1]).target).toBe('140');
});

test('failed storage operations propagate and do not poison the scope queue', async () => {
  write.mockRejectedValueOnce(new Error('disk full'));
  await expect(writeMobileCreditPlan('retry', sample())).rejects.toThrow('disk full');
  await expect(writeMobileCreditPlan('retry', sample())).resolves.toBeUndefined();
  read.mockRejectedValueOnce(new Error('read failed'));
  await expect(readMobileCreditPlan('retry')).rejects.toThrow('read failed');
  await expect(readMobileCreditPlan('retry')).resolves.toEqual(emptyCreditPlan());
});

test('UTF-8 limits apply to Chinese and emoji content, not just character count', () => {
  expect(creditPlanUtf8Bytes('ABC')).toBe(3);
  expect(creditPlanUtf8Bytes('學分')).toBe(6);
  expect(creditPlanUtf8Bytes('😀')).toBe(4);
  const oversized = JSON.stringify({ ...sample(), note: '學'.repeat(31_000) });
  expect(oversized.length).toBeLessThan(90_000);
  expect(() => parsePortableCreditPlan(oversized)).toThrow(/90 KB/);
  expect(() => portableCreditPlanJson(JSON.parse(oversized) as CreditPlan)).toThrow(/90 KB/);
});

test('a maximum-size valid Chinese plan remains portable', () => {
  const plan = { ...sample(), courses: Array.from({ length: 120 }, (_, i) => ({
    id: String(i), name: '學'.repeat(80), credits: 3, term: 1,
    category: 'required' as const, status: 'considering' as const,
  })) };
  const json = portableCreditPlanJson(plan);
  expect(creditPlanUtf8Bytes(json)).toBeLessThanOrEqual(90_000);
  expect(parsePortableCreditPlan(json)).toEqual(plan);
});

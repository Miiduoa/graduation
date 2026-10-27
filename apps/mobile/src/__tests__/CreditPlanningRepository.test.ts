import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  mobileCreditPlanKey,
  parsePortableCreditPlan,
  portableCreditPlanJson,
  readMobileCreditPlan,
  writeMobileCreditPlan,
} from '../features/academics/creditPlanRepository';
import {
  creditPlanSummary,
  emptyCreditPlan,
  type CreditPlan,
} from '@campus/shared/src/creditPlanner';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(), setItem: jest.fn() },
}));

const read = AsyncStorage.getItem as jest.MockedFunction<typeof AsyncStorage.getItem>;
const write = AsyncStorage.setItem as jest.MockedFunction<typeof AsyncStorage.setItem>;

function sample(): CreditPlan {
  return {
    ...emptyCreditPlan(),
    recognized: '60',
    target: '128',
    extra: '5',
    terms: 3,
    courses: [
      { id: 'course-a', name: '資料庫', credits: 3, term: 1, category: 'required', status: 'considering' },
      { id: 'course-b', name: '資料探勘', credits: 2.5, term: 2, category: 'elective', status: 'registered' },
    ],
    categoryGoals: {
      ...emptyCreditPlan().categoryGoals,
      required: { recognized: '20', target: '35' },
    },
    milestones: [{ id: 'check', label: '英文能力門檻', done: false }],
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  read.mockResolvedValue(null);
  write.mockResolvedValue();
});

test('uses a unique local key per account and school and never reads global drafts', async () => {
  const key = mobileCreditPlanKey('user-a', 'pu');
  expect(key).not.toBe(mobileCreditPlanKey('user-b', 'pu'));
  expect(key).not.toBe(mobileCreditPlanKey('user-a', 'nchu'));
  expect(key).not.toBe(mobileCreditPlanKey(null, 'pu'));
  expect(await readMobileCreditPlan(key)).toEqual(emptyCreditPlan());
  expect(read).toHaveBeenCalledTimes(1);
  expect(read).toHaveBeenCalledWith(key);
  expect(write).not.toHaveBeenCalled();
});

test('Web and mobile use exactly the same data model, target math and portable JSON format', async () => {
  const plan = sample();
  const text = portableCreditPlanJson(plan);
  expect(parsePortableCreditPlan(text)).toEqual(plan);
  expect(parsePortableCreditPlan('\ufeff' + text)).toEqual(plan);
  const summary = creditPlanSummary(plan);
  expect(summary.recognized).toBe(60);
  expect(summary.courseCredits).toBe(5.5);
  expect(summary.planned).toBe(10.5);
  expect(summary.remaining).toBe(57.5);
  expect(summary.perTerm[0].credits).toBe(3);
  expect(summary.categoryGaps.find((row) => row.key === 'required')?.remaining).toBe(12);

  const key = mobileCreditPlanKey('user-a', 'pu');
  await writeMobileCreditPlan(key, plan);
  expect(write).toHaveBeenCalledWith(key, JSON.stringify(plan));
  read.mockResolvedValueOnce(JSON.stringify(plan));
  expect(await readMobileCreditPlan(key)).toEqual(plan);
});

test('invalid or corrupt backups never overwrite existing mobile plans', async () => {
  const key = mobileCreditPlanKey('user-a', 'pu');
  read.mockResolvedValueOnce('{bad');
  await expect(readMobileCreditPlan(key)).rejects.toThrow(/無法驗證/);
  await expect(writeMobileCreditPlan(key, { ...sample(), target: 'not-a-number' })).rejects.toThrow(/格式錯誤/);
  expect(write).not.toHaveBeenCalled();
  expect(() => parsePortableCreditPlan('{bad')).toThrow(/備份格式/);
  expect(() => parsePortableCreditPlan(JSON.stringify({ ...sample(), version: 3 }))).toThrow(/備份格式/);
  expect(() => parsePortableCreditPlan(JSON.stringify({
    ...sample(),
    courses: [
      ...sample().courses,
      { id: 'course-a', name: '重複 ID', credits: 3, category: 'required', status: 'considering', term: 1 },
    ],
  }))).toThrow(/備份格式/);
});

test('storage errors propagate so UI cannot show a fake success', async () => {
  const key = mobileCreditPlanKey('user-a', 'pu');
  write.mockRejectedValueOnce(new Error('disk full'));
  await expect(writeMobileCreditPlan(key, sample())).rejects.toThrow('disk full');
  read.mockRejectedValueOnce(new Error('storage failed'));
  await expect(readMobileCreditPlan(key)).rejects.toThrow('storage failed');
});

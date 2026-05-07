jest.mock('../../firebase', () => ({
  getFirebaseApp: jest.fn(() => ({})),
  hasUsableFirebaseConfig: jest.fn(() => false),
}));

import { runAISelfDialogEvaluation } from '../../services/aiSelfDialog';

describe('AI self-dialog evaluation', () => {
  beforeEach(() => {
    process.env.EXPO_PUBLIC_AI_PROVIDER = 'offline';
    process.env.EXPO_PUBLIC_AI_TEST_FAST = '1';
  });

  it('keeps the offline assistant stable across generated student prompts', async () => {
    const rounds = Number(process.env.AI_SELF_TEST_ROUNDS ?? 500);
    jest.setTimeout(Math.max(30000, rounds * 20));

    const report = await runAISelfDialogEvaluation({
      rounds,
      batchSize: 100,
      seed: 411211325,
      maxFailures: 10,
    });

    expect(report.failures).toEqual([]);
    expect(report.passed).toBe(rounds);
  });
});

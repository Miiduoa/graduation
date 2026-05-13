import { normalizeGamificationState } from '../../services/gamificationEngine';

describe('gamification weekly rollover', () => {
  it('clears stale wc_* challenge keys when epoch changes', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-05-13T12:00:00Z'));
    const epochNow = Math.floor(Date.now() / 604800000);
    const staleEpoch = epochNow - 1;
    const staleId = `wc_study_${staleEpoch}`;
    const state = {
      totalXP: 0,
      streak: { current: 0, longest: 0, lastCheckIn: '', history: [] },
      unlockedAchievements: {} as Record<string, number>,
      achievementProgress: {} as Record<string, number>,
      challengeState: { [staleId]: 4 } as Record<string, number>,
      xpLog: [] as { action: string; xp: number; timestamp: number }[],
      weeklyChallengeEpoch: staleEpoch,
      weeklyChallengeBonusXpGiven: 77,
    };

    normalizeGamificationState(state);

    expect(state.weeklyChallengeEpoch).toBe(epochNow);
    expect(state.weeklyChallengeBonusXpGiven).toBe(0);
    expect(state.challengeState[staleId]).toBeUndefined();
    jest.useRealTimers();
  });
});

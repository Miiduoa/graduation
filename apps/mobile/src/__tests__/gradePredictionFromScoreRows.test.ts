/**
 * @jest-environment node
 */
import { predictCurrent, commonTargets } from '@campus/shared';
import {
  scoreRowsToPredictorItems,
  type ScoreRowForPrediction,
} from '../services/gradePredictionFromScoreRows';

describe('scoreRowsToPredictorItems + predictCurrent', () => {
  test('均分權重且部分未批改時，樂觀/悲觀涵蓋剩餘配額', () => {
    const rows: ScoreRowForPrediction[] = [
      {
        id: 'a',
        title: '作業一',
        score: 80,
        totalScore: 100,
        weight: null,
        status: 'graded',
      },
      {
        id: 'b',
        title: '期末',
        score: null,
        totalScore: 100,
        weight: null,
        status: 'missing',
      },
    ];
    const items = scoreRowsToPredictorItems(rows);
    const snap = predictCurrent(items);
    expect(snap.earnedSoFar).toBeCloseTo(40, 5);
    expect(snap.weightRemaining).toBeCloseTo(50, 5);
    expect(snap.worstCase).toBeCloseTo(40, 5);
    expect(snap.bestCase).toBeCloseTo(90, 5);
  });

  test('明確權重與混雜未填權重時，剩餘配額分給未填列', () => {
    const rows: ScoreRowForPrediction[] = [
      { id: 'x', title: '期中', score: 100, totalScore: 100, weight: 40, status: 'graded' },
      { id: 'y', title: '報告', score: null, totalScore: 100, weight: null, status: 'pending' },
    ];
    const items = scoreRowsToPredictorItems(rows);
    expect(items.find((i) => i.id === 'x')!.weight).toBe(40);
    expect(items.find((i) => i.id === 'y')!.weight).toBe(60);
  });
});

describe('commonTargets 與列資料', () => {
  test('可產生常見目標門檻列', () => {
    const rows: ScoreRowForPrediction[] = [
      { id: 'h1', title: 'HW1', score: 70, totalScore: 100, weight: 50, status: 'graded' },
      { id: 'h2', title: 'HW2', score: null, totalScore: 100, weight: 50, status: 'missing' },
    ];
    const items = scoreRowsToPredictorItems(rows);
    const targets = commonTargets(items);
    expect(targets.map((t) => t.target)).toEqual([60, 70, 80, 90]);
    const t80 = targets.find((t) => t.target === 80);
    expect(t80?.result.feasibility).toBeDefined();
    expect(t80?.result.requiredAveragePercent).not.toBeNull();
  });
});

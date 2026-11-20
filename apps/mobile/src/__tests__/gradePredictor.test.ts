/**
 * @jest-environment node
 *
 * 對 packages/shared/src/lms/gradePredictor.ts 完整單元測試。
 */
import {
  predictCurrent,
  simulateWhatIf,
  requiredToReach,
  commonTargets,
  type PredictorItem,
} from '@campus/shared';

// 一份典型課程的評分項目
const items: PredictorItem[] = [
  { id: 'hw1', title: 'HW1', weight: 10, maxScore: 100, score: 90, graded: true },
  { id: 'hw2', title: 'HW2', weight: 10, maxScore: 100, score: 80, graded: true },
  { id: 'midterm', title: '期中考', weight: 30, maxScore: 100, score: 75, graded: true },
  { id: 'final', title: '期末考', weight: 30, maxScore: 100, score: null, graded: false },
  { id: 'project', title: '期末專題', weight: 20, maxScore: 100, score: null, graded: false },
];

describe('predictCurrent', () => {
  it('回傳已批改項目的加權累積', () => {
    const r = predictCurrent(items);
    // 0.1*90 + 0.1*80 + 0.3*75 = 9 + 8 + 22.5 = 39.5
    expect(r.earnedSoFar).toBeCloseTo(39.5, 1);
    expect(r.weightUsed).toBeCloseTo(50, 1);
    expect(r.weightRemaining).toBeCloseTo(50, 1);
  });

  it('bestCase = earnedSoFar + 剩餘 weight 全拿滿', () => {
    const r = predictCurrent(items);
    expect(r.bestCase).toBeCloseTo(89.5, 1);
  });

  it('worstCase = earnedSoFar', () => {
    const r = predictCurrent(items);
    expect(r.worstCase).toBeCloseTo(39.5, 1);
  });

  it('likelyCase 用已批改項目平均推估剩餘', () => {
    const r = predictCurrent(items);
    // 平均 = (90+80+75)/3 = 81.67
    // 剩餘 50% 用 81.67 推估 → 39.5 + 50 * 0.8167 = 80.33
    expect(r.likelyCase).toBeCloseTo(80.3, 0);
    expect(r.averageGradedPercent).toBeCloseTo(81.7, 0);
  });

  it('letterGrade 對應正確等級', () => {
    const r = predictCurrent(items);
    expect(r.letterGrade).toMatch(/^A-|B\+$/); // 80~85 範圍
  });

  it('weights 加總 ≠ 100 時自動正規化', () => {
    const itemsBadWeights: PredictorItem[] = [
      { id: 'a', title: 'A', weight: 50, score: 90, graded: true },
      { id: 'b', title: 'B', weight: 50, score: 80, graded: true },
      { id: 'c', title: 'C', weight: 100, score: null, graded: false },
      // 加總 = 200，預期 normalize 成 25/25/50
    ];
    const r = predictCurrent(itemsBadWeights);
    expect(r.totalWeight).toBeCloseTo(100, 1);
    // earned = 25 * 0.9 + 25 * 0.8 = 22.5 + 20 = 42.5
    expect(r.earnedSoFar).toBeCloseTo(42.5, 1);
  });

  it('excused 項目排除在計算外', () => {
    const withExcused: PredictorItem[] = [
      { id: 'a', title: 'A', weight: 50, score: 90, graded: true },
      { id: 'b', title: 'B', weight: 50, score: null, graded: false, excused: true },
    ];
    const r = predictCurrent(withExcused);
    expect(r.weightUsed).toBeCloseTo(100, 1);
    expect(r.likelyCase).toBeCloseTo(90, 1);
  });

  it('全部未批改時 likelyCase 為 null', () => {
    const allPending: PredictorItem[] = [
      { id: 'a', title: 'A', weight: 50, score: null, graded: false },
      { id: 'b', title: 'B', weight: 50, score: null, graded: false },
    ];
    const r = predictCurrent(allPending);
    expect(r.likelyCase).toBeNull();
    expect(r.averageGradedPercent).toBeNull();
  });

  it('score 超過 maxScore 會 clamp 到 100%', () => {
    const r = predictCurrent([
      { id: 'a', title: 'A', weight: 100, score: 120, maxScore: 100, graded: true },
    ]);
    expect(r.likelyCase).toBeCloseTo(100, 1);
  });
});

describe('simulateWhatIf', () => {
  it('假設期末考拿 80 → 計算 delta', () => {
    const r = simulateWhatIf(items, [{ itemId: 'final', assumedScore: 80 }]);
    // 原本 earnedSoFar = 39.5, weightUsed = 50, 平均 81.7
    // 假設後：earnedSoFar = 39.5 + 30*0.8 = 39.5 + 24 = 63.5, weightUsed = 80
    expect(r.earnedSoFar).toBeCloseTo(63.5, 1);
    expect(r.weightUsed).toBeCloseTo(80, 1);
    // likelyCase 需含剩 20% (project) 拿平均 (90+80+75+80)/4=81.25 → 63.5+20*0.8125=79.75
    expect(r.likelyCase).toBeCloseTo(79.8, 0);
    expect(r.delta).not.toBeNull();
  });

  it('多項 override 同時生效', () => {
    const r = simulateWhatIf(items, [
      { itemId: 'final', assumedScore: 100 },
      { itemId: 'project', assumedScore: 100 },
    ]);
    expect(r.likelyCase).toBeCloseTo(89.5, 1);
    expect(r.bestCase).toBeCloseTo(89.5, 1);
  });

  it('override 已批改項目仍生效', () => {
    const r = simulateWhatIf(items, [{ itemId: 'midterm', assumedScore: 100 }]);
    // earnedSoFar = 9 + 8 + 30 = 47
    expect(r.earnedSoFar).toBeCloseTo(47, 1);
  });

  it('沒提供 override 等同 predictCurrent', () => {
    const baseline = predictCurrent(items);
    const r = simulateWhatIf(items, []);
    expect(r.earnedSoFar).toBe(baseline.earnedSoFar);
    expect(r.likelyCase).toBe(baseline.likelyCase);
    expect(r.delta).toBe(0);
  });
});

describe('requiredToReach', () => {
  it('目標 85，未來項 final + project → 平均要拿幾分', () => {
    const r = requiredToReach(items, {
      targetPercent: 85,
      futureItemIds: ['final', 'project'],
    });
    // earned = 39.5, futureWeight = 50, needed = 85-39.5 = 45.5
    // requiredAvg = 45.5/50 * 100 = 91
    expect(r.requiredAveragePercent).toBeCloseTo(91, 0);
    expect(r.feasibility).toBe('hard');
  });

  it('目標 70 → 較輕鬆', () => {
    const r = requiredToReach(items, {
      targetPercent: 70,
      futureItemIds: ['final', 'project'],
    });
    // needed = 70 - 39.5 = 30.5, avg = 30.5/50*100 = 61
    expect(r.requiredAveragePercent).toBeCloseTo(61, 0);
    expect(r.feasibility).toBe('doable');
  });

  it('目標 100 + 無法達標時 → impossible', () => {
    const itemsLowGrade: PredictorItem[] = [
      { id: 'a', title: 'A', weight: 50, score: 30, graded: true },
      { id: 'b', title: 'B', weight: 50, score: null, graded: false },
    ];
    const r = requiredToReach(itemsLowGrade, {
      targetPercent: 100,
      futureItemIds: ['b'],
    });
    // earned = 15, future = 50, needed = 85, avg = 170 → impossible
    expect(r.feasibility).toBe('impossible');
  });

  it('現況已達標 → easy + 0 分要求', () => {
    const itemsHighGrade: PredictorItem[] = [
      { id: 'a', title: 'A', weight: 50, score: 95, graded: true },
      { id: 'b', title: 'B', weight: 50, score: null, graded: false },
    ];
    const r = requiredToReach(itemsHighGrade, {
      targetPercent: 40,
      futureItemIds: ['b'],
    });
    expect(r.feasibility).toBe('easy');
  });

  it('已沒有未來項可控 → 看現況是否已達標', () => {
    const r = requiredToReach(items, {
      targetPercent: 85,
      futureItemIds: [],
    });
    expect(r.feasibility).toBe('impossible');
  });

  it('ceiling 計算正確', () => {
    const r = requiredToReach(items, {
      targetPercent: 85,
      futureItemIds: ['final', 'project'],
    });
    expect(r.ceiling).toBeCloseTo(89.5, 1);
  });
});

describe('commonTargets', () => {
  it('回傳 60/70/80/90 四個門檻的計算', () => {
    const out = commonTargets(items);
    expect(out).toHaveLength(4);
    expect(out.map((o) => o.target)).toEqual([60, 70, 80, 90]);
    // 期望由 easy → hard
    expect(out[0].result.feasibility).toMatch(/easy|doable/);
    expect(out[3].result.feasibility).toMatch(/hard|impossible/);
  });
});

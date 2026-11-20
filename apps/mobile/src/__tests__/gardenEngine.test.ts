/**
 * @jest-environment node
 *
 * Learning Garden Engine 測試。涵蓋：
 *  - 種子 → 結果 階段
 *  - 健康衰退（缺席、缺交）
 *  - 採收條件（學期結束 + 通過）
 *  - 不及格 → 枯萎
 *  - 班級氣象
 */
import {
  computePlant,
  computeGarden,
  type CourseSignals,
} from '@campus/shared';

function course(partial: Partial<CourseSignals> = {}): CourseSignals {
  return {
    courseId: 'c1',
    courseName: '資料庫',
    attendanceRate: 0,
    assignmentsSubmitted: 0,
    assignmentsTotal: 0,
    quizzesAttempted: 0,
    quizzesTotal: 0,
    materialsRead: 0,
    materialsTotal: 0,
    discussionPosts: 0,
    currentScore: null,
    ...partial,
  };
}

describe('computePlant', () => {
  test('沒做任何事 → seed 階段', () => {
    const p = computePlant(course());
    expect(p.stage).toBe('seed');
    expect(p.growth).toBe(0);
  });

  test('全部繳交 / 出席 / 讀完 → fruiting', () => {
    const p = computePlant(
      course({
        attendanceRate: 1,
        assignmentsSubmitted: 5,
        assignmentsTotal: 5,
        quizzesAttempted: 3,
        quizzesTotal: 3,
        materialsRead: 10,
        materialsTotal: 10,
        discussionPosts: 5,
      }),
    );
    expect(p.stage).toBe('fruiting');
    expect(p.growth).toBeGreaterThan(85);
  });

  test('出席 70% 但漏交一半 → leafy + 健康下降', () => {
    const p = computePlant(
      course({
        attendanceRate: 0.7,
        assignmentsSubmitted: 2,
        assignmentsTotal: 4,
        materialsRead: 5,
        materialsTotal: 10,
      }),
    );
    expect(['sprout', 'leafy']).toContain(p.stage);
    expect(p.health).toBeLessThan(100);
  });

  test('學期結束 + fruiting + 通過 → 可採收', () => {
    const p = computePlant(
      course({
        attendanceRate: 1,
        assignmentsSubmitted: 5,
        assignmentsTotal: 5,
        quizzesAttempted: 3,
        quizzesTotal: 3,
        materialsRead: 10,
        materialsTotal: 10,
        discussionPosts: 5,
        currentScore: 85,
        termEnded: true,
      }),
    );
    expect(p.harvestable).toBe(true);
    expect(p.harvestPoints).toBe((85 - 50) * 2);
  });

  test('不及格 → withering 枯萎', () => {
    const p = computePlant(
      course({
        attendanceRate: 0.5,
        currentScore: 45,
        termEnded: true,
        failed: true,
      }),
    );
    expect(p.stage).toBe('withering');
    expect(p.harvestable).toBe(false);
    expect(p.needsWaterText).toContain('重新栽種');
  });

  test('學期未結束 + fruiting → 不可採收', () => {
    const p = computePlant(
      course({
        attendanceRate: 1,
        assignmentsSubmitted: 5,
        assignmentsTotal: 5,
        quizzesAttempted: 3,
        quizzesTotal: 3,
        materialsRead: 10,
        materialsTotal: 10,
        discussionPosts: 5,
        currentScore: 90,
        termEnded: false,
      }),
    );
    expect(p.harvestable).toBe(false);
  });

  test('採收門檻：health < 60 不可採收', () => {
    const p = computePlant(
      course({
        attendanceRate: 0.4, // 健康會掉很多
        assignmentsSubmitted: 5,
        assignmentsTotal: 5,
        quizzesAttempted: 3,
        quizzesTotal: 3,
        materialsRead: 10,
        materialsTotal: 10,
        currentScore: 90,
        termEnded: true,
      }),
    );
    expect(p.health).toBeLessThan(60);
    expect(p.harvestable).toBe(false);
  });

  test('budding 階段給「再交一份就會綻放」提示', () => {
    const p = computePlant(
      course({
        attendanceRate: 0.8,
        assignmentsSubmitted: 3,
        assignmentsTotal: 4,
        quizzesAttempted: 2,
        quizzesTotal: 3,
        materialsRead: 6,
        materialsTotal: 10,
        discussionPosts: 2,
      }),
    );
    if (p.stage === 'budding') {
      expect(p.needsWaterText).toContain('再交');
    }
  });
});

describe('computeGarden', () => {
  test('整座花園加總與班級氣象', () => {
    const r = computeGarden([
      course({ courseId: 'c1', attendanceRate: 1, assignmentsSubmitted: 5, assignmentsTotal: 5 }),
      course({ courseId: 'c2', courseName: '演算法', attendanceRate: 0.9 }),
      course({ courseId: 'c3', courseName: '通識', attendanceRate: 0.95 }),
    ]);
    expect(r.plants).toHaveLength(3);
    expect(r.totalGrowth).toBeGreaterThan(0);
    expect(['sunny', 'cloudy', 'rainy', 'storm']).toContain(r.classWeather);
  });

  test('全部健康都低 → storm 暴雨', () => {
    const r = computeGarden([
      course({
        courseId: 'c1',
        attendanceRate: 0.1,
        assignmentsSubmitted: 0,
        assignmentsTotal: 5,
      }),
      course({
        courseId: 'c2',
        attendanceRate: 0.1,
        assignmentsSubmitted: 0,
        assignmentsTotal: 5,
      }),
    ]);
    expect(r.classWeather).toBe('storm');
  });

  test('全部健康 → sunny', () => {
    const r = computeGarden([
      course({ courseId: 'c1', attendanceRate: 1, assignmentsSubmitted: 5, assignmentsTotal: 5, materialsRead: 5, materialsTotal: 5 }),
      course({ courseId: 'c2', attendanceRate: 1, assignmentsSubmitted: 3, assignmentsTotal: 3, materialsRead: 5, materialsTotal: 5 }),
    ]);
    expect(r.classWeather).toBe('sunny');
  });
});

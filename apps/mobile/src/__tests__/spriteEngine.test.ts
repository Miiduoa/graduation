/**
 * @jest-environment node
 *
 * Campus Sprite Engine 完整測試。涵蓋：
 *  - 平衡 / 焦學 / 缺社交 / 探索狂
 *  - hibernate（病假/期考週/寒暑假）
 *  - burnout 偵測
 *  - 進化階段（新生 / 老兵）
 *  - 季節 / 校園氣象
 */
import {
  computeSpriteState,
  detectBurnoutSignal,
  getEvolutionStage,
  type DailyActivitySignal,
  type SpriteProfile,
} from '@campus/shared';

function day(date: string, partial: Partial<DailyActivitySignal> = {}): DailyActivitySignal {
  return {
    date,
    studyMinutes: 0,
    assignmentsSubmitted: 0,
    materialsRead: 0,
    quizAttempts: 0,
    attendanceCheckins: 0,
    campusStepsEstimate: 0,
    campusVisitsCount: 0,
    mealsOrdered: 0,
    distinctVendors: 0,
    socialInteractions: 0,
    groupOrderJoined: 0,
    ...partial,
  };
}

const PROFILE: SpriteProfile = { createdAt: '2025-09-01', studyYear: 2, currentMonth: 5 };

describe('computeSpriteState', () => {
  test('完全平衡的學生 → energetic + 高 vitality', () => {
    const signals = Array.from({ length: 14 }, (_, i) =>
      day(`2026-05-${String(i + 1).padStart(2, '0')}`, {
        studyMinutes: 90,
        materialsRead: 3,
        assignmentsSubmitted: 1,
        attendanceCheckins: 1,
        campusStepsEstimate: 5000,
        campusVisitsCount: 2,
        mealsOrdered: 2,
        distinctVendors: 2,
        socialInteractions: 3,
        groupOrderJoined: 1,
      }),
    );
    const r = computeSpriteState({ signals, profile: PROFILE });
    expect(r.mood).toBe('energetic');
    expect(r.vitality).toBeGreaterThan(50);
    expect(r.needs.study).toBeGreaterThan(40);
  });

  test('只讀書沒社交 → lonely 或 focused', () => {
    const signals = Array.from({ length: 7 }, (_, i) =>
      day(`2026-05-${i + 1}`, {
        studyMinutes: 200,
        materialsRead: 5,
        attendanceCheckins: 1,
        // 沒社交沒運動沒飯
      }),
    );
    const r = computeSpriteState({ signals, profile: PROFILE });
    expect(['lonely', 'focused', 'tired']).toContain(r.mood);
  });

  test('hibernate（考試週）→ sleepy + vitality 不掉', () => {
    const signals = Array.from({ length: 7 }, (_, i) =>
      day(`2026-05-${i + 1}`, { hibernated: true }),
    );
    const r = computeSpriteState({ signals, profile: PROFILE, previousVitality: 72 });
    expect(r.mood).toBe('sleepy');
    expect(r.vitality).toBe(72);
    expect(r.daysHibernated).toBe(7);
    expect(r.careHint.kind).toBe('rest');
  });

  test('burnout 偵測：連 5 天爆肝讀書沒社交運動', () => {
    const signals = Array.from({ length: 5 }, (_, i) =>
      day(`2026-05-${i + 1}`, {
        studyMinutes: 300,
        materialsRead: 6,
        assignmentsSubmitted: 2,
        // 完全沒動沒社交沒吃
      }),
    );
    expect(detectBurnoutSignal(signals)).toBe(true);
    const r = computeSpriteState({ signals, profile: PROFILE });
    expect(r.mood).toBe('tired');
    expect(r.careHint.kind).toBe('rest');
  });

  test('沒進帳號才滿 14 天 → egg 階段', () => {
    const signals = Array.from({ length: 10 }, (_, i) =>
      day(`2026-05-${i + 1}`, { studyMinutes: 30 }),
    );
    const r = computeSpriteState({ signals, profile: { ...PROFILE, studyYear: 1 } });
    expect(r.evolutionStage).toBe('egg');
    expect(r.message).toContain('剛來');
  });

  test('進化階段邊界值', () => {
    expect(getEvolutionStage(541, 4)).toBe('guardian');
    expect(getEvolutionStage(200, 3)).toBe('companion');
    expect(getEvolutionStage(60, 1)).toBe('fledgling');
    expect(getEvolutionStage(30, 1)).toBe('sprout');
    expect(getEvolutionStage(13, 1)).toBe('egg');
  });

  test('5 月 → spring 季節 + 櫻花花環', () => {
    const signals = [day('2026-05-13', { studyMinutes: 60 })];
    const r = computeSpriteState({ signals, profile: { ...PROFILE, currentMonth: 5 } });
    expect(r.appearance.season).toBe('spring');
    expect(r.appearance.seasonalAccessory).toContain('櫻花');
  });

  test('系統指定 campusWeather 會覆寫預設', () => {
    const signals = [day('2026-05-13', { studyMinutes: 60 })];
    const r = computeSpriteState({ signals, profile: PROFILE, campusWeather: 'snowy' });
    expect(r.appearance.weatherMood).toBe('snowy');
  });

  test('careHint 建議：沒紀錄餐點 → meal', () => {
    const signals = Array.from({ length: 7 }, (_, i) =>
      day(`2026-05-${i + 1}`, {
        studyMinutes: 60,
        materialsRead: 2,
        socialInteractions: 2,
        campusStepsEstimate: 3000,
      }),
    );
    const r = computeSpriteState({ signals, profile: PROFILE });
    expect(r.careHint.kind).toBe('meal');
    expect(r.careHint.ctaTarget).toBe('cafeteria');
  });

  test('careHint：完全沒社交 → social', () => {
    const signals = Array.from({ length: 7 }, (_, i) =>
      day(`2026-05-${i + 1}`, {
        studyMinutes: 60,
        materialsRead: 2,
        mealsOrdered: 2,
        distinctVendors: 2,
        campusStepsEstimate: 3000,
        // socialInteractions = 0
      }),
    );
    const r = computeSpriteState({ signals, profile: PROFILE });
    expect(r.careHint.kind).toBe('social');
  });

  test('全空：沒任何活動天 → fallback hibernate', () => {
    const r = computeSpriteState({ signals: [], profile: PROFILE, previousVitality: 50 });
    expect(r.mood).toBe('sleepy');
    expect(r.daysActive).toBe(0);
  });
});

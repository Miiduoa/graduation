/**
 * @jest-environment node
 *
 * AI 思考 + 學習引擎完整測試。
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  observeStudentState,
  inferConcerns,
  detectTradeoffs,
  rankActions,
  explainChain,
  reflectOnDay,
  type StateSignal,
  type CandidateAction,
} from '../services/aiThinking';

import {
  recordInteraction,
  loadInteractionHistory,
  computePreferenceProfile,
  adjustScore,
  discoverPatterns,
  selfReflect,
  type InteractionEvent,
} from '../services/aiLearning';

describe('aiThinking.observeStudentState', () => {
  it('3+ 高權重 signal → 跨領域壓力 pattern', () => {
    const signals: StateSignal[] = [
      { domain: 'homework', fact: 'HW1 逾期', weight: 85 },
      { domain: 'exam', fact: '明天考試', weight: 90 },
      { domain: 'attendance', fact: '已 2 缺', weight: 75 },
    ];
    const obs = observeStudentState(signals);
    expect(obs.some((o) => o.pattern.includes('跨領域'))).toBe(true);
  });

  it('單一 domain 多 signal → 失衡 pattern', () => {
    const signals: StateSignal[] = [
      { domain: 'homework', fact: 'HW1', weight: 75 },
      { domain: 'homework', fact: 'HW2', weight: 80 },
      { domain: 'homework', fact: 'HW3', weight: 70 },
    ];
    const obs = observeStudentState(signals);
    expect(obs.some((o) => o.pattern.includes('明顯失衡'))).toBe(true);
  });

  it('全低權重 → 穩定 pattern', () => {
    const signals: StateSignal[] = [
      { domain: 'homework', fact: 'HW', weight: 30 },
      { domain: 'exam', fact: 'exam', weight: 40 },
    ];
    const obs = observeStudentState(signals);
    expect(obs.some((o) => o.pattern.includes('節奏穩定'))).toBe(true);
  });
});

describe('aiThinking.inferConcerns', () => {
  it('從跨領域 observation 推論累積壓力', () => {
    const obs = [{ pattern: '5 項高重要度 signal 集中在 3 個領域，壓力呈跨領域分布', domains: ['hw', 'exam'], severity: 'critical' as const }];
    const concerns = inferConcerns(obs);
    expect(concerns.some((c) => c.inference.includes('累積壓力'))).toBe(true);
  });
});

describe('aiThinking.detectTradeoffs', () => {
  it('burnout + 高 cost action → 建議休息', () => {
    const concerns = [{ inference: '學生可能正在累積壓力', basedOn: ['x'], confidence: 80, severity: 'high' as const }];
    const candidates: CandidateAction[] = [
      { id: 'a', description: '寫期末 paper', benefit: 80, cost: 80, urgency: 60, domain: 'homework' },
    ];
    const ts = detectTradeoffs(concerns, candidates);
    expect(ts.length).toBeGreaterThan(0);
    expect(ts[0].recommendation).toBe('B');
  });
});

describe('aiThinking.rankActions', () => {
  it('高 urgency + 高 benefit → 排第一', () => {
    const cands: CandidateAction[] = [
      { id: 'a', description: '小事', benefit: 30, cost: 10, urgency: 20, domain: 'd' },
      { id: 'b', description: '大事', benefit: 80, cost: 20, urgency: 90, domain: 'd' },
    ];
    const r = rankActions(cands);
    expect(r[0].id).toBe('b');
    expect(r[0].rationale).toContain('CP');
  });
});

describe('aiThinking.explainChain', () => {
  it('組合 observations + concerns + tradeoffs + ranking 成 narrative', () => {
    const r = explainChain({
      signals: [
        { domain: 'homework', fact: 'HW 逾期', weight: 85 },
        { domain: 'exam', fact: '明天考', weight: 90 },
        { domain: 'attendance', fact: '已缺', weight: 80 },
      ],
      candidates: [
        { id: 'a', description: '寫 HW', benefit: 70, cost: 40, urgency: 90, domain: 'homework' },
      ],
    });
    expect(r.observations.length).toBeGreaterThan(0);
    expect(r.narrative.some((n) => n.includes('觀察'))).toBe(true);
    expect(r.narrative.some((n) => n.includes('決定'))).toBe(true);
  });
});

describe('aiThinking.reflectOnDay', () => {
  it('高完成率 → great', () => {
    const r = reflectOnDay({
      totalTasks: 5, completedTasks: 5, overdueTasks: 0,
      pomodorosCompleted: 6, pomodorosPlanned: 6,
      highPriorityMissed: [],
    });
    expect(r.verdict).toBe('great');
  });

  it('多 overdue → reset verdict', () => {
    const r = reflectOnDay({
      totalTasks: 5, completedTasks: 0, overdueTasks: 4,
      pomodorosCompleted: 0, pomodorosPlanned: 0,
      highPriorityMissed: ['HW1', 'HW2'],
    });
    expect(r.verdict).toBe('reset');
  });
});

describe('aiLearning.recordInteraction + history', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('記錄並可讀出', async () => {
    await recordInteraction('u1', {
      suggestionId: 'study_plan_1',
      kind: 'study_plan',
      hour: 9,
      dayOfWeek: 1,
      reaction: 'accepted',
      deltaMs: 5000,
    });
    const h = await loadInteractionHistory('u1');
    expect(h).toHaveLength(1);
    expect(h[0].reaction).toBe('accepted');
  });
});

describe('aiLearning.computePreferenceProfile', () => {
  it('多次互動 → 計算各 kind 的 accept rate', () => {
    const events: InteractionEvent[] = [
      { suggestionId: 'a', kind: 'study_plan', hour: 9, dayOfWeek: 1, reaction: 'accepted', deltaMs: 1000, occurredAt: '2026-05-15T09:00:00Z' },
      { suggestionId: 'b', kind: 'study_plan', hour: 9, dayOfWeek: 2, reaction: 'accepted', deltaMs: 1000, occurredAt: '2026-05-16T09:00:00Z' },
      { suggestionId: 'c', kind: 'study_plan', hour: 22, dayOfWeek: 3, reaction: 'dismissed', deltaMs: 200, occurredAt: '2026-05-17T22:00:00Z' },
    ];
    const p = computePreferenceProfile(events);
    expect(p.byKind.study_plan.acceptRate).toBeGreaterThan(0.5);
    expect(p.overall.samples).toBe(3);
  });
});

describe('aiLearning.adjustScore', () => {
  it('高接受率時段 → boost confidence', () => {
    const events: InteractionEvent[] = Array.from({ length: 6 }).map((_, i) => ({
      suggestionId: `s${i}`,
      kind: 'study_plan',
      hour: 9,
      dayOfWeek: 1,
      reaction: 'accepted',
      deltaMs: 1000,
      occurredAt: `2026-05-${10 + i}T09:00:00Z`,
    }));
    const p = computePreferenceProfile(events);
    const r = adjustScore(60, 'study_plan', 9, p);
    expect(r.multiplier).toBeGreaterThan(1);
    expect(r.adjustedConfidence).toBeGreaterThan(60);
  });

  it('低接受率 → 降低 confidence', () => {
    const events: InteractionEvent[] = Array.from({ length: 6 }).map((_, i) => ({
      suggestionId: `s${i}`,
      kind: 'study_plan',
      hour: 22,
      dayOfWeek: 1,
      reaction: 'dismissed',
      deltaMs: 100,
      occurredAt: `2026-05-${10 + i}T22:00:00Z`,
    }));
    const p = computePreferenceProfile(events);
    const r = adjustScore(60, 'study_plan', 22, p);
    expect(r.multiplier).toBeLessThan(1);
    expect(r.adjustedConfidence).toBeLessThan(60);
  });
});

describe('aiLearning.discoverPatterns', () => {
  it('連續 dismiss 偵測出 rejected_kind pattern', () => {
    const events: InteractionEvent[] = Array.from({ length: 10 }).map((_, i) => ({
      suggestionId: `s${i}`,
      kind: 'companion_check',
      hour: 14,
      dayOfWeek: i % 7,
      reaction: 'dismissed',
      deltaMs: 100,
      occurredAt: `2026-05-${10 + i}T14:00:00Z`,
    }));
    const patterns = discoverPatterns(events);
    expect(patterns.some((p) => p.kind === 'rejected_kind')).toBe(true);
  });

  it('高完成率 → high_completion pattern', () => {
    const events: InteractionEvent[] = Array.from({ length: 8 }).map((_, i) => ({
      suggestionId: `s${i}`,
      kind: 'study_plan',
      hour: 9,
      dayOfWeek: 1,
      reaction: 'completed' as const,
      deltaMs: 1000,
      occurredAt: `2026-05-${10 + i}T09:00:00Z`,
    }));
    const patterns = discoverPatterns(events);
    expect(patterns.some((p) => p.kind === 'high_completion')).toBe(true);
  });
});

describe('aiLearning.selfReflect', () => {
  it('low samples → 觀察建議', () => {
    const r = selfReflect([]);
    expect(r.selfAdjustment).toContain('觀察');
  });

  it('低接受率 → 降頻建議', () => {
    const events: InteractionEvent[] = Array.from({ length: 15 }).map((_, i) => ({
      suggestionId: `s${i}`,
      kind: 'urgent_action',
      hour: 9,
      dayOfWeek: 1,
      reaction: 'dismissed',
      deltaMs: 100,
      occurredAt: `2026-05-${10 + i}T09:00:00Z`,
    }));
    const r = selfReflect(events);
    expect(r.selfAdjustment).toContain('降頻');
  });
});

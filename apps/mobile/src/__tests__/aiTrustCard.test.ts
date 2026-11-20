import { buildTrustCard, computeTrustScore } from '../services/aiTrustCard';
import type { AuditLogEntry } from '../services/aiSkillApplicator';
import type { InteractionEvent } from '../services/aiLearning';

const mkLog = (
  decision: AuditLogEntry['decision'],
  kind: string,
  guardrail: AuditLogEntry['guardrail'] = 'ok',
  occurredAt = '2026-05-10T10:00:00.000Z',
): AuditLogEntry => ({
  occurredAt,
  suggestionId: `s_${Math.random()}`,
  kind: kind as AuditLogEntry['kind'],
  decision,
  guardrail,
  baseConfidence: 70,
  adjustedConfidence: 70,
  appliedSkills: [],
  explanation: '',
});

const mkHist = (
  reaction: InteractionEvent['reaction'],
  occurredAt = '2026-05-10T10:00:00.000Z',
): InteractionEvent => ({
  occurredAt,
  suggestionId: 's',
  kind: 'study_plan',
  hour: 10,
  dayOfWeek: 1,
  reaction,
  deltaMs: 0,
});

describe('computeTrustScore', () => {
  test('健康採納率 (60%) + 高 restraint + 都先問 → 高分', () => {
    const score = computeTrustScore({
      acceptRate: 0.6,
      blocked: 25,
      askedUser: 10,
      totalSuggested: 100,
      highImpactKindsCount: 10,
    });
    expect(score).toBeGreaterThanOrEqual(85);
  });

  test('採納率過低 → 低分', () => {
    const score = computeTrustScore({
      acceptRate: 0.05,
      blocked: 5,
      askedUser: 0,
      totalSuggested: 100,
      highImpactKindsCount: 0,
    });
    expect(score).toBeLessThan(50);
  });

  test('採納率過高（100%）扣分（缺乏批判）', () => {
    const score = computeTrustScore({
      acceptRate: 1.0,
      blocked: 25,
      askedUser: 10,
      totalSuggested: 100,
      highImpactKindsCount: 10,
    });
    // 採納率 1.0 → acceptScore = 50；restraint 100；confirm 100 → 0.4*50 + 0.35*100 + 0.25*100 = 80
    expect(score).toBeLessThan(90);
    expect(score).toBeGreaterThan(60);
  });
});

describe('buildTrustCard', () => {
  const auditLog: AuditLogEntry[] = [
    mkLog('auto_pushed', 'study_plan'),
    mkLog('auto_pushed', 'mistake_practice'),
    mkLog('asked_user', 'urgent_action'),
    mkLog('blocked', 'study_plan', 'quiet_hours'),
    mkLog('blocked', 'study_plan', 'daily_cap_reached'),
    mkLog('blocked', 'mistake_practice', 'user_rejection_pattern'),
  ];
  const history: InteractionEvent[] = [
    mkHist('accepted'),
    mkHist('accepted'),
    mkHist('dismissed'),
  ];

  test('aggregate counts 正確', () => {
    const card = buildTrustCard({
      uid: 'u',
      auditLog,
      history,
    });
    expect(card.totalSuggested).toBe(6);
    expect(card.autoPushed).toBe(2);
    expect(card.askedUser).toBe(1);
    expect(card.blocked).toBe(3);
    expect(card.accepted).toBe(2);
    expect(card.dismissed).toBe(1);
    expect(card.acceptRate).toBeCloseTo(2 / 3);
  });

  test('guardrail breakdown 正確', () => {
    const card = buildTrustCard({ uid: 'u', auditLog, history });
    expect(card.guardrailBreakdown.quiet_hours).toBe(1);
    expect(card.guardrailBreakdown.daily_cap_reached).toBe(1);
    expect(card.guardrailBreakdown.user_rejection_pattern).toBe(1);
  });

  test('highlights 描述 AI 守門', () => {
    const card = buildTrustCard({ uid: 'u', auditLog, history });
    expect(card.highlights.length).toBeGreaterThan(0);
    expect(card.highlights.some((h) => h.includes('安靜時段'))).toBe(true);
    expect(card.highlights.some((h) => h.includes('煞車'))).toBe(true);
  });

  test('shareableSummary 含分數', () => {
    const card = buildTrustCard({ uid: 'u', auditLog, history });
    expect(card.shareableSummary).toContain('信任分數');
    expect(card.shareableSummary).toContain(String(card.trustScore));
  });

  test('時間範圍過濾', () => {
    const card = buildTrustCard({
      uid: 'u',
      auditLog,
      history,
      fromMs: new Date('2027-01-01').getTime(), // 未來
      toMs: Date.now(),
    });
    expect(card.totalSuggested).toBe(0);
  });

  test('空資料不會 crash', () => {
    const card = buildTrustCard({ uid: 'u', auditLog: [], history: [] });
    expect(card.totalSuggested).toBe(0);
    expect(card.acceptRate).toBe(0);
    expect(card.trustScore).toBeGreaterThanOrEqual(0);
  });
});

/**
 * @jest-environment node
 *
 * 對 packages/shared/src/lms/feedbackDrafter.ts 完整單元測試。
 */
import {
  draftFeedback,
  bulkReminders,
  evaluateRubric,
  type Rubric,
} from '@campus/shared';

const RUBRIC: Rubric = {
  id: 'r1',
  title: 'R',
  criteria: [
    { id: 'c1', title: '論述清晰', weight: 50, levels: [
      { id: 'l4', label: '優', points: 4 },
      { id: 'l3', label: '良', points: 3 },
      { id: 'l2', label: '可', points: 2 },
      { id: 'l1', label: '差', points: 1 },
    ] },
    { id: 'c2', title: '證據充分', weight: 50, levels: [
      { id: 'l4', label: '優', points: 4 },
      { id: 'l2', label: '可', points: 2 },
    ] },
  ],
};

describe('draftFeedback', () => {
  it('沒 rubric 也能根據分數段給通用建議', () => {
    const r = draftFeedback({
      studentName: '小明',
      scorePercent: 55,
      tone: 'neutral',
      seed: 'u1',
    });
    expect(r.draft).toContain('小明');
    expect(r.sections.suggestions.length).toBeGreaterThan(0);
  });

  it('Rubric 有 weak criterion → 列入 weakCriteria', () => {
    const evaluation = evaluateRubric(RUBRIC, [
      { criterionId: 'c1', levelId: 'l1' }, // 1/4 = 25% → weak
      { criterionId: 'c2', levelId: 'l4' }, // 4/4 = 100% → 非 weak
    ]);
    const r = draftFeedback({
      studentName: '小華',
      rubric: { criteria: RUBRIC.criteria },
      evaluation,
      tone: 'neutral',
      seed: 'u2',
    });
    expect(r.weakCriteria).toContain('論述清晰');
    expect(r.weakCriteria).not.toContain('證據充分');
    expect(r.draft).toContain('論述清晰');
  });

  it('遲交 → 評語多一條時間管理提醒', () => {
    const r = draftFeedback({
      studentName: '小美',
      scorePercent: 80,
      isLate: true,
      seed: 'u3',
    });
    expect(r.sections.suggestions.some((s) => s.includes('遲'))).toBe(true);
  });

  it('不同 seed → 不同句子 (deterministic)', () => {
    const r1 = draftFeedback({ studentName: '同學', scorePercent: 70, seed: 'a' });
    const r2 = draftFeedback({ studentName: '同學', scorePercent: 70, seed: 'b' });
    // 兩個草稿至少有一段不同
    expect(r1.draft).not.toBe(r2.draft);
  });

  it('tone=strict → 句子更嚴格', () => {
    const strict = draftFeedback({ scorePercent: 80, tone: 'strict', seed: 's' });
    const encouraging = draftFeedback({ scorePercent: 80, tone: 'encouraging', seed: 's' });
    expect(strict.draft).not.toBe(encouraging.draft);
  });

  it('沒提供 studentName → 用「同學」 fallback', () => {
    const r = draftFeedback({ scorePercent: 70 });
    expect(r.draft).toContain('同學');
  });

  it('包含 workSummary → 評語會引用片段', () => {
    const r = draftFeedback({
      studentName: '小強',
      scorePercent: 75,
      workSummary: '我使用 SGD 加 momentum 完成訓練',
    });
    expect(r.draft).toMatch(/SGD|momentum/);
  });
});

describe('bulkReminders', () => {
  it('多個學生一次產出多份個人化提醒', () => {
    const r = bulkReminders({
      students: [
        { uid: 'u1', displayName: '阿明' },
        { uid: 'u2', displayName: '小華' },
        { uid: 'u3', displayName: '小美' },
      ],
      homeworkTitle: 'HW1',
      courseName: 'ML',
      dueAt: new Date(Date.now() + 12 * 3_600_000).toISOString(),
    });
    expect(r).toHaveLength(3);
    expect(r[0].title).toContain('HW1');
    expect(r[0].body).toContain('阿明');
    expect(r[1].body).toContain('小華');
  });

  it('已過期 → 標題改成「補交提醒」', () => {
    const r = bulkReminders({
      students: [{ uid: 'u1', displayName: '阿明' }],
      homeworkTitle: 'HW1',
      courseName: 'ML',
      dueAt: new Date(Date.now() - 24 * 3_600_000).toISOString(),
    });
    expect(r[0].title).toContain('補交');
    expect(r[0].body).toContain('逾期');
  });

  it('不同學生有不同問候句（避免雷同）', () => {
    const r = bulkReminders({
      students: Array.from({ length: 10 }).map((_, i) => ({ uid: `u${i}`, displayName: `學生${i}` })),
      homeworkTitle: 'HW1',
      courseName: 'ML',
      dueAt: new Date(Date.now() + 12 * 3_600_000).toISOString(),
    });
    const distinctOpeners = new Set(r.map((x) => x.body.slice(0, 4)));
    expect(distinctOpeners.size).toBeGreaterThan(1);
  });

  it('deepLink 帶課程資訊', () => {
    const r = bulkReminders({
      students: [{ uid: 'u1', displayName: '阿明' }],
      homeworkTitle: 'HW1',
      courseName: 'ML',
      dueAt: new Date().toISOString(),
    });
    expect(r[0].deepLink).toMatch(/HomeworkSubmit/);
    expect(r[0].deepLink).toContain('HW1');
  });
});

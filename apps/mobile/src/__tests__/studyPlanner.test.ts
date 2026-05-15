/**
 * @jest-environment node
 *
 * 對 packages/shared/src/lms/studyPlanner.ts 完整單元測試。
 */
import {
  planStudy,
  homeworkToPlannerTask,
  examToPlannerTask,
  type PlannerTask,
} from '@campus/shared';

const NOW = '2026-05-15T08:00:00+08:00';

function mkTask(over: Partial<PlannerTask>): PlannerTask {
  return {
    id: over.id ?? 't',
    courseId: over.courseId ?? 'c1',
    courseName: over.courseName ?? '機器學習',
    title: over.title ?? 'HW',
    kind: over.kind ?? 'homework',
    dueAt: over.dueAt ?? null,
    estimatedMinutes: over.estimatedMinutes ?? 60,
    importance: over.importance ?? 50,
    done: over.done,
    progress: over.progress,
  };
}

describe('planStudy', () => {
  it('排除已 done 的 task', () => {
    const r = planStudy(
      [
        mkTask({ id: 'a', done: true }),
        mkTask({ id: 'b' }),
      ],
      { now: NOW },
    );
    expect(r.prioritized).toHaveLength(1);
    expect(r.prioritized[0].id).toBe('b');
  });

  it('overdue 任務優先排第一', () => {
    const r = planStudy(
      [
        mkTask({ id: 'soon', dueAt: '2026-05-20T08:00:00+08:00', importance: 90 }),
        mkTask({ id: 'overdue', dueAt: '2026-05-10T08:00:00+08:00', importance: 30 }),
      ],
      { now: NOW },
    );
    expect(r.prioritized[0].id).toBe('overdue');
    expect(r.prioritized[0].urgency).toBe('overdue');
    expect(r.overdueTasks).toHaveLength(1);
  });

  it('urgent (24h 內) 優先於 soon (72h)', () => {
    const r = planStudy(
      [
        mkTask({ id: 'soon', dueAt: '2026-05-17T08:00:00+08:00', importance: 50 }),
        mkTask({ id: 'urgent', dueAt: '2026-05-15T20:00:00+08:00', importance: 50 }),
      ],
      { now: NOW },
    );
    expect(r.prioritized[0].id).toBe('urgent');
    expect(r.prioritized[0].urgency).toBe('urgent');
  });

  it('重要度高 + 同 urgency → 排前面', () => {
    const r = planStudy(
      [
        mkTask({ id: 'low', dueAt: '2026-05-17T08:00:00+08:00', importance: 30 }),
        mkTask({ id: 'high', dueAt: '2026-05-17T08:00:00+08:00', importance: 90 }),
      ],
      { now: NOW },
    );
    expect(r.prioritized[0].id).toBe('high');
  });

  it('進度 > 50% 給加分（推完它）', () => {
    const r = planStudy(
      [
        mkTask({ id: 'new', dueAt: '2026-05-20T08:00:00+08:00', importance: 60, progress: 0 }),
        mkTask({ id: 'half', dueAt: '2026-05-20T08:00:00+08:00', importance: 60, progress: 0.6 }),
      ],
      { now: NOW },
    );
    expect(r.prioritized[0].id).toBe('half');
  });

  it('沒死線的任務 deprioritize', () => {
    const r = planStudy(
      [
        mkTask({ id: 'noddl', dueAt: null, importance: 50 }),
        mkTask({ id: 'haddl', dueAt: '2026-05-22T08:00:00+08:00', importance: 50 }),
      ],
      { now: NOW },
    );
    expect(r.prioritized[0].id).toBe('haddl');
  });

  it('番茄鐘排程不超過 dailyBudget', () => {
    const r = planStudy(
      Array.from({ length: 10 }).map((_, i) =>
        mkTask({
          id: `t${i}`,
          dueAt: '2026-05-22T08:00:00+08:00',
          estimatedMinutes: 60,
          importance: 50,
        }),
      ),
      { now: NOW, dailyBudgetMinutes: 120 },
    );
    // 番茄鐘總分鐘數（含 break）不會超過 budget 太多
    const lastSlot = r.pomodoros[r.pomodoros.length - 1];
    expect(lastSlot.endMinute).toBeLessThanOrEqual(140);
  });

  it('每 4 個番茄鐘給長休 15 分鐘', () => {
    const r = planStudy(
      [mkTask({ id: 'long', dueAt: '2026-05-22T08:00:00+08:00', estimatedMinutes: 300, importance: 50 })],
      { now: NOW, dailyBudgetMinutes: 500 },
    );
    const fourth = r.pomodoros.find((p) => p.index === 4);
    expect(fourth?.breakMinutes).toBe(15);
  });

  it('totalEstimatedMinutes 用 (1 - progress) 折算', () => {
    const r = planStudy(
      [
        mkTask({ id: 'a', estimatedMinutes: 100, progress: 0.5 }),
        mkTask({ id: 'b', estimatedMinutes: 60, progress: 0 }),
      ],
      { now: NOW },
    );
    expect(r.totalEstimatedMinutes).toBe(50 + 60);
  });

  it('summary 在有 overdue 時提到「先補交」', () => {
    const r = planStudy(
      [mkTask({ id: 'o', dueAt: '2026-05-10T08:00:00+08:00' })],
      { now: NOW },
    );
    expect(r.summary).toMatch(/逾期|補交/);
  });

  it('沒任何 active task → summary 提示翻教材', () => {
    const r = planStudy(
      [mkTask({ id: 'done', done: true })],
      { now: NOW },
    );
    expect(r.summary).toMatch(/教材|複習/);
  });

  it('hoursUntilDue 計算正確', () => {
    const r = planStudy(
      [mkTask({ id: 'a', dueAt: '2026-05-15T20:00:00+08:00' })],
      { now: NOW },
    );
    expect(r.prioritized[0].hoursUntilDue).toBeCloseTo(12, 0);
  });
});

describe('homeworkToPlannerTask', () => {
  it('轉換並推估重要度', () => {
    const t = homeworkToPlannerTask({
      id: 1,
      courseId: 71378,
      courseName: 'ML',
      title: 'HW1',
      dueAt: '2026-06-01T00:00:00Z',
      totalScore: 100,
      submitted: false,
    });
    expect(t.id).toBe('hw_1');
    expect(t.kind).toBe('homework');
    expect(t.importance).toBeGreaterThan(0);
    expect(t.done).toBe(false);
  });
});

describe('examToPlannerTask', () => {
  it('isPractice=true → kind=quiz + importance 較低', () => {
    const q = examToPlannerTask({
      id: 1,
      courseId: 1,
      courseName: 'ML',
      title: '練習考',
      startAt: '2026-06-01T00:00:00Z',
      isPractice: true,
    });
    expect(q.kind).toBe('quiz');
    expect(q.importance).toBeLessThan(60);
  });

  it('正式考 → kind=exam + importance 較高', () => {
    const e = examToPlannerTask({
      id: 2,
      courseId: 1,
      courseName: 'ML',
      title: '期中考',
      startAt: '2026-06-01T00:00:00Z',
      isPractice: false,
    });
    expect(e.kind).toBe('exam');
    expect(e.importance).toBeGreaterThanOrEqual(80);
  });
});

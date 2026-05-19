/**
 * @jest-environment node
 *
 * AI Orchestrator 完整單元測試。
 */
import {
  aiPreReviewGrade,
  aiForecastBulkReminder,
  aiSummarizeStudentInbox,
  aiCommentOnWhatIf,
  aiDepartmentHealthScore,
  aiVendorNextAction,
  orchestrate,
} from '../services/aiOrchestrator';
import type { RoleEvent } from '../services/roleEventBus';

describe('aiPreReviewGrade', () => {
  it('低分 → AI 建議鼓勵性評語', () => {
    const r = aiPreReviewGrade({
      courseId: 71378,
      homeworkId: 465001,
      studentUid: 'demo_student_kuchih',
      studentName: '顧晉瑋',
      newScore: 45,
    });
    expect(r.suggestion).toContain('鼓勵');
    expect(r.affects.some((a) => a.role === 'student')).toBe(true);
    expect(r.needsConfirm).toBe(true);
  });

  it('高分 → AI 建議簡短肯定', () => {
    const r = aiPreReviewGrade({
      courseId: 71378,
      homeworkId: 465001,
      studentUid: 'demo_student_kuchih',
      studentName: '顧晉瑋',
      newScore: 95,
    });
    expect(r.suggestion).toContain('肯定');
  });

  it('一般分數 → 給 delta 資訊', () => {
    const r = aiPreReviewGrade({
      courseId: 71378,
      homeworkId: 465001,
      studentUid: 'demo_student_kuchih',
      studentName: '顧晉瑋',
      newScore: 75,
    });
    expect(r.forecast).toBeDefined();
    expect(r.forecast?.metric).toBe('預估總成績');
  });
});

describe('aiForecastBulkReminder', () => {
  it('鼓勵 tone + 12h 內 → 預估率較高', () => {
    const r = aiForecastBulkReminder({
      homeworkTitle: 'HW1',
      hoursUntilDue: 12,
      studentCount: 20,
      tone: 'encouraging',
    });
    expect(r.forecast?.after).toBeGreaterThan(60);
  });

  it('嚴格 tone + 3h → AI 建議改 tone', () => {
    const r = aiForecastBulkReminder({
      homeworkTitle: 'HW1',
      hoursUntilDue: 3,
      studentCount: 10,
      tone: 'strict',
    });
    expect(r.suggestion).toContain('焦慮');
    expect(r.needsConfirm).toBe(true);
  });

  it('回傳影響的角色（學生 + 老師）', () => {
    const r = aiForecastBulkReminder({
      homeworkTitle: 'HW1',
      hoursUntilDue: 24,
      studentCount: 10,
      tone: 'neutral',
    });
    expect(r.affects.some((a) => a.role === 'student')).toBe(true);
    expect(r.affects.some((a) => a.role === 'teacher')).toBe(true);
  });
});

describe('aiSummarizeStudentInbox', () => {
  it('空 inbox → 摘要說沒新動態', () => {
    const r = aiSummarizeStudentInbox([]);
    expect(r.priorityCount).toBe(0);
    expect(r.recommendedAction).toBeNull();
  });

  it('有 attendance event → critical recommendation', () => {
    const events: RoleEvent<unknown>[] = [
      {
        id: 'e1',
        kind: 'attendance_session_opened',
        actorUid: 't1',
        courseId: 'c1',
        courseName: 'ML',
        occurredAt: new Date().toISOString(),
        payload: {},
      },
    ];
    const r = aiSummarizeStudentInbox(events);
    expect(r.recommendedAction).toContain('簽到');
    expect(r.priorityCount).toBeGreaterThanOrEqual(3);
  });

  it('多 events → 摘要組合', () => {
    const events: RoleEvent<unknown>[] = [
      { id: 'e1', kind: 'grade_published', actorUid: 't', courseId: 'c', courseName: 'ML', occurredAt: '2026-05-15T10:00:00Z', payload: {} },
      { id: 'e2', kind: 'feedback_drafted', actorUid: 't', courseId: 'c', courseName: 'ML', occurredAt: '2026-05-15T10:00:00Z', payload: {} },
      { id: 'e3', kind: 'bulk_reminder_sent', actorUid: 't', courseId: 'c', courseName: 'ML', occurredAt: '2026-05-15T10:00:00Z', payload: {} },
    ];
    const r = aiSummarizeStudentInbox(events);
    expect(r.summary).toContain('新成績');
    expect(r.summary).toContain('評語');
    expect(r.summary).toContain('作業提醒');
  });
});

describe('aiCommentOnWhatIf', () => {
  it('大幅提升 → AI 鼓勵衝刺', () => {
    const r = aiCommentOnWhatIf({
      itemTitle: '期末考',
      newScore: 95,
      newTotal: 100,
      oldGrade: 75,
      newGrade: 85,
    });
    expect(r).toContain('衝刺');
  });

  it('微幅變化 → AI 標出邊際效益', () => {
    const r = aiCommentOnWhatIf({
      itemTitle: 'HW1',
      newScore: 82,
      newTotal: 100,
      oldGrade: 80,
      newGrade: 80.5,
    });
    expect(r).toMatch(/影響不大|邊際/);
  });

  it('下跌 → AI 警示', () => {
    const r = aiCommentOnWhatIf({
      itemTitle: '期末考',
      newScore: 40,
      newTotal: 100,
      oldGrade: 80,
      newGrade: 70,
    });
    expect(r).toContain('⚠️');
  });
});

describe('aiDepartmentHealthScore', () => {
  it('回傳系所健康度 + risk + 建議', () => {
    const r = aiDepartmentHealthScore();
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(100);
    expect(Array.isArray(r.topRisks)).toBe(true);
    expect(r.suggestions.length).toBeGreaterThan(0);
  });
});

describe('aiVendorNextAction', () => {
  it('久候訂單 → critical', () => {
    const r = aiVendorNextAction({
      pendingOrders: 2,
      processingOrders: 1,
      readyOrders: 0,
      oldestPendingMinutes: 25,
    });
    expect(r.severity).toBe('critical');
    expect(r.action).toContain('客訴');
  });

  it('堆積太多 → high', () => {
    const r = aiVendorNextAction({
      pendingOrders: 6,
      processingOrders: 0,
      readyOrders: 0,
      oldestPendingMinutes: 5,
    });
    expect(r.severity).toBe('high');
  });

  it('空檔 → low + 預備', () => {
    // 固定 hour=12 來避開「深夜 / 下午茶 / 清晨」分支，落到通用預備
    const r = aiVendorNextAction({
      pendingOrders: 0,
      processingOrders: 0,
      readyOrders: 0,
      oldestPendingMinutes: 0,
      hour: 12,
    });
    expect(r.severity).toBe('low');
    // 通用建議含「預備」「食材」「整理」之一
    expect(r.action).toMatch(/預備|食材|整理/);
  });
});

describe('orchestrate dispatcher', () => {
  it('teacher_grade → AIDecision', () => {
    const r = orchestrate({
      type: 'teacher_grade',
      payload: {
        courseId: 71378,
        homeworkId: 465001,
        studentUid: 'u1',
        studentName: '小明',
        newScore: 75,
      },
    });
    expect('suggestion' in r).toBe(true);
  });

  it('student_what_if → comment', () => {
    const r = orchestrate({
      type: 'student_what_if',
      payload: {
        itemTitle: '期末',
        newScore: 80,
        newTotal: 100,
        oldGrade: 75,
        newGrade: 78,
      },
    });
    expect('comment' in r).toBe(true);
  });
});

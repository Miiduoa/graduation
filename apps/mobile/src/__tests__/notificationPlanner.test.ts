/**
 * @jest-environment node
 *
 * 對 packages/shared/src/lms/notificationPlanner.ts 完整單元測試。
 */
import { planNotifications, type NotificationContext } from '@campus/shared';

const NOW = '2026-05-15T10:00:00+08:00';

const baseCtx: NotificationContext = { now: NOW };

describe('planNotifications', () => {
  it('下堂課 30 分鐘內 → class_soon', () => {
    const r = planNotifications({
      ...baseCtx,
      upcomingClasses: [
        {
          courseId: 'c1',
          courseName: 'ML',
          startAt: '2026-05-15T10:25:00+08:00',
          location: 'M101',
        },
      ],
    });
    expect(r.some((n) => n.kind === 'class_soon')).toBe(true);
    expect(r.find((n) => n.kind === 'class_soon')?.severity).toBe('high');
  });

  it('教室異動 → classroom_change critical', () => {
    const r = planNotifications({
      ...baseCtx,
      upcomingClasses: [
        {
          courseId: 'c1',
          courseName: 'ML',
          startAt: '2026-05-15T14:00:00+08:00',
          location: 'M201',
          locationChanged: true,
          oldLocation: 'M101',
        },
      ],
    });
    const change = r.find((n) => n.kind === 'classroom_change');
    expect(change).toBeDefined();
    expect(change?.severity).toBe('critical');
    expect(change?.body).toContain('M101');
    expect(change?.body).toContain('M201');
  });

  it('已逾期作業 → hw_overdue critical', () => {
    const r = planNotifications({
      ...baseCtx,
      homeworks: [
        {
          id: 1,
          courseId: 'c1',
          courseName: 'ML',
          title: 'HW1',
          dueAt: '2026-05-14T00:00:00+08:00',
          submitted: false,
        },
      ],
    });
    expect(r.find((n) => n.kind === 'hw_overdue')?.severity).toBe('critical');
  });

  it('24h 內到期作業 → hw_due_soon 且排程於截止前 1 小時', () => {
    const r = planNotifications({
      ...baseCtx,
      homeworks: [
        {
          id: 1,
          courseId: 'c1',
          courseName: 'ML',
          title: 'HW1',
          dueAt: '2026-05-15T22:00:00+08:00',
          submitted: false,
        },
      ],
    });
    const item = r.find((n) => n.kind === 'hw_due_soon');
    expect(item).toBeDefined();
    expect(item?.scheduledAt).toBe(new Date('2026-05-15T21:00:00+08:00').toISOString());
  });

  it('截止前不足 1 小時 → hw_due_soon 但 scheduledAt 為 null', () => {
    const r = planNotifications({
      ...baseCtx,
      homeworks: [
        {
          id: 1,
          courseId: 'c1',
          courseName: 'ML',
          title: 'HW1',
          dueAt: '2026-05-15T10:45:00+08:00',
          submitted: false,
        },
      ],
    });
    const item = r.find((n) => n.kind === 'hw_due_soon');
    expect(item).toBeDefined();
    expect(item?.scheduledAt).toBeNull();
  });

  it('3 小時內到期 → critical', () => {
    const r = planNotifications({
      ...baseCtx,
      homeworks: [
        {
          id: 1,
          courseId: 'c1',
          courseName: 'ML',
          title: 'HW1',
          dueAt: '2026-05-15T12:00:00+08:00',
          submitted: false,
        },
      ],
    });
    const item = r.find((n) => n.kind === 'hw_due_soon');
    expect(item?.severity).toBe('critical');
    expect(item?.scheduledAt).toBe(new Date('2026-05-15T11:00:00+08:00').toISOString());
  });

  it('已繳交作業不會出現在通知中', () => {
    const r = planNotifications({
      ...baseCtx,
      homeworks: [
        {
          id: 1,
          courseId: 'c1',
          courseName: 'ML',
          title: 'HW1',
          dueAt: '2026-05-15T22:00:00+08:00',
          submitted: true,
        },
      ],
    });
    expect(r.find((n) => n.kind === 'hw_due_soon')).toBeUndefined();
  });

  it('考試 12h 內 → exam_today', () => {
    const r = planNotifications({
      ...baseCtx,
      exams: [
        {
          id: 1,
          courseId: 'c1',
          courseName: 'ML',
          title: '期中考',
          startAt: '2026-05-15T16:00:00+08:00',
          submitted: false,
        },
      ],
    });
    expect(r.find((n) => n.kind === 'exam_today')?.severity).toBe('critical');
    expect(r.find((n) => n.kind === 'exam_today')?.deepLink).toContain('assignmentId=');
  });

  it('考試 36h 內 → exam_tomorrow', () => {
    const r = planNotifications({
      ...baseCtx,
      exams: [
        {
          id: 1,
          courseId: 'c1',
          courseName: 'ML',
          title: '期末考',
          startAt: '2026-05-16T14:00:00+08:00',
          submitted: false,
        },
      ],
    });
    expect(r.find((n) => n.kind === 'exam_tomorrow')).toBeDefined();
  });

  it('老師開點名中 → attendance_active critical', () => {
    const r = planNotifications({
      ...baseCtx,
      attendanceSessions: [
        {
          id: 's1',
          courseId: 'c1',
          courseName: 'ML',
          active: true,
          startedAt: NOW,
        },
      ],
    });
    expect(r.find((n) => n.kind === 'attendance_active')?.severity).toBe('critical');
  });

  it('教材 3+ 天沒翻 → unread_material', () => {
    const r = planNotifications({
      ...baseCtx,
      unreadMaterials: [
        {
          courseId: 'c1',
          courseName: 'ML',
          lastOpenedAt: '2026-05-10T08:00:00+08:00',
          materialCount: 5,
        },
      ],
    });
    expect(r.find((n) => n.kind === 'unread_material')).toBeDefined();
  });

  it('低風險不會推 risk 通知；高風險會', () => {
    const r = planNotifications({
      ...baseCtx,
      riskAlerts: [
        { courseId: 'c1', courseName: 'ML', riskLevel: 'low', reason: '無事' },
        { courseId: 'c2', courseName: 'OS', riskLevel: 'high', reason: '缺席過多' },
      ],
    });
    const riskNotifs = r.filter((n) => n.kind === 'risk_radar');
    expect(riskNotifs).toHaveLength(1);
    expect(riskNotifs[0].body).toContain('缺席過多');
  });

  it('cooldown 機制：同 (kind, key) 4 小時內不再推', () => {
    const r = planNotifications(
      {
        ...baseCtx,
        homeworks: [
          {
            id: 1,
            courseId: 'c1',
            courseName: 'ML',
            title: 'HW1',
            dueAt: '2026-05-15T22:00:00+08:00',
            submitted: false,
          },
        ],
      },
      {
        recentlySent: [
          { kind: 'hw_due_soon', key: '1', at: '2026-05-15T08:00:00+08:00' },
        ],
        cooldownHours: 4,
      },
    );
    expect(r.find((n) => n.kind === 'hw_due_soon')).toBeUndefined();
  });

  it('排序按 severity', () => {
    const r = planNotifications({
      ...baseCtx,
      unreadMaterials: [
        { courseId: 'c1', courseName: 'ML', lastOpenedAt: '2026-05-10T00:00:00+08:00', materialCount: 1 },
      ],
      homeworks: [
        { id: 1, courseId: 'c1', courseName: 'ML', title: 'HW', dueAt: '2026-05-14T00:00:00+08:00', submitted: false },
      ],
    });
    // overdue (critical) 應該排在 unread (low) 前面
    expect(r[0].kind).toBe('hw_overdue');
  });

  it('互評到期 48h 內 → peer_review_due', () => {
    const r = planNotifications({
      ...baseCtx,
      peerReviewsDue: [
        {
          id: 'pr1',
          courseId: 'c1',
          courseName: 'ML',
          assignmentTitle: 'HW3 互評',
          dueAt: '2026-05-16T20:00:00+08:00',
        },
      ],
    });
    expect(r.find((n) => n.kind === 'peer_review_due')).toBeDefined();
  });
});

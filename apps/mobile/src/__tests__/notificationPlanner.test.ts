/**
 * @jest-environment node
 *
 * 對 packages/shared/src/lms/notificationPlanner.ts 完整單元測試。
 */
import {
  attendanceNoticeTextIsSafe,
  planAttendanceSituationNotices,
  planNotifications,
  resolveAttendanceScheduleStatus,
  type NotificationContext,
  type TodayAttendanceSituation,
} from '@campus/shared';

const NOW = '2026-05-15T10:00:00+08:00';

const baseCtx: NotificationContext = { now: NOW };

function situation(
  partial: Partial<TodayAttendanceSituation> &
    Pick<TodayAttendanceSituation, 'scheduleStatus' | 'session'>,
): TodayAttendanceSituation {
  return {
    courseId: 'c1',
    courseName: 'ML',
    viewerRole: 'student',
    classStartAt: '2026-05-15T09:00:00+08:00',
    classEndAt: '2026-05-15T12:00:00+08:00',
    ...partial,
  };
}

function assertNoAbsenceWording(texts: string[]) {
  for (const text of texts) {
    expect(attendanceNoticeTextIsSafe(text)).toBe(true);
  }
}

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

describe('點名狀態表：規則 1–6（無紀錄不等於缺席）', () => {
  it('規則1：今天沒有這門課或還沒到上課時間 → 不通知', () => {
    const before = planNotifications({
      ...baseCtx,
      todayAttendanceSituations: [
        situation({
          scheduleStatus: 'before_class',
          session: { kind: 'none' },
        }),
      ],
    });
    const noneToday = planNotifications({
      ...baseCtx,
      todayAttendanceSituations: [
        situation({
          scheduleStatus: 'no_class_today',
          classStartAt: null,
          classEndAt: null,
          session: { kind: 'none' },
        }),
      ],
    });
    expect(before.filter((n) => n.kind.startsWith('attendance_'))).toHaveLength(0);
    expect(noneToday.filter((n) => n.kind.startsWith('attendance_'))).toHaveLength(0);
  });

  it('規則2：上課中或已下課且無場次 → 老師「本堂尚未點名」、學生「不會自動登記出席結果」', () => {
    const teacher = planNotifications({
      ...baseCtx,
      todayAttendanceSituations: [
        situation({
          viewerRole: 'teacher',
          scheduleStatus: 'ok',
          session: { kind: 'none' },
        }),
      ],
    });
    const student = planNotifications({
      ...baseCtx,
      todayAttendanceSituations: [
        situation({
          viewerRole: 'student',
          scheduleStatus: 'ok',
          session: { kind: 'none' },
        }),
      ],
    });
    const teacherItem = teacher.find((n) => n.kind === 'attendance_session_missing_teacher');
    const studentItem = student.find((n) => n.kind === 'attendance_session_missing_student');
    expect(teacherItem?.title).toContain('本堂尚未點名');
    expect(teacherItem?.body).toContain('本堂尚未點名');
    expect(attendanceNoticeTextIsSafe(`${teacherItem?.title}${teacherItem?.body}`)).toBe(true);
    expect(studentItem?.body).toBe('老師本堂尚未建立點名，系統不會自動登記出席結果。');
    expect(attendanceNoticeTextIsSafe(`${studentItem?.title}${studentItem?.body}`)).toBe(true);
  });

  it('規則2／3／4 新文案全部通過 attendanceNoticeTextIsSafe', () => {
    const teacher = planAttendanceSituationNotices(
      situation({
        viewerRole: 'teacher',
        scheduleStatus: 'ok',
        session: { kind: 'none' },
      }),
      NOW,
    );
    const studentMissing = planAttendanceSituationNotices(
      situation({
        viewerRole: 'student',
        scheduleStatus: 'ok',
        session: { kind: 'none' },
      }),
      NOW,
    );
    const active = planAttendanceSituationNotices(
      situation({
        scheduleStatus: 'ok',
        session: { kind: 'active', id: 's-open', studentCheckedIn: false },
      }),
      NOW,
    );
    const noCheckin = planAttendanceSituationNotices(
      situation({
        session: {
          kind: 'ended',
          id: 's1',
          studentCheckedIn: false,
          studentMarkedAbsent: false,
          studentMarkedExcused: false,
        },
        scheduleStatus: 'ok',
      }),
      NOW,
    );
    assertNoAbsenceWording(
      [...teacher, ...studentMissing, ...active, ...noCheckin].flatMap((item) => [
        item.title,
        item.body,
      ]),
    );
  });

  it('規則2：老師本堂尚未點名有 cooldown（一堂一次）', () => {
    const key = 'c1::2026-05-15T09:00:00+08:00';
    const r = planNotifications(
      {
        ...baseCtx,
        todayAttendanceSituations: [
          situation({
            viewerRole: 'teacher',
            scheduleStatus: 'ok',
            session: { kind: 'none' },
          }),
        ],
      },
      {
        recentlySent: [
          {
            kind: 'attendance_session_missing_teacher',
            key,
            at: '2026-05-15T09:30:00+08:00',
          },
        ],
        cooldownHours: 4,
      },
    );
    expect(r.find((n) => n.kind === 'attendance_session_missing_teacher')).toBeUndefined();
  });

  it('規則3：點名場次開放中、學生尚未簽到 → 沿用「點名進行中，請簽到」', () => {
    const r = planNotifications({
      ...baseCtx,
      todayAttendanceSituations: [
        situation({
          scheduleStatus: 'unlinked',
          session: { kind: 'active', id: 's-open', studentCheckedIn: false },
        }),
      ],
    });
    const item = r.find((n) => n.kind === 'attendance_active');
    expect(item?.body).toBe('點名進行中，請簽到');
    expect(item?.severity).toBe('critical');
  });

  it('規則4：場次已結束且無簽到紀錄 →「沒有簽到紀錄」，輸出不含缺席／曠課', () => {
    const r = planNotifications({
      ...baseCtx,
      todayAttendanceSituations: [
        situation({
          scheduleStatus: 'unlinked',
          session: {
            kind: 'ended',
            id: 's-ended',
            studentCheckedIn: false,
            studentMarkedAbsent: false,
            studentMarkedExcused: false,
          },
        }),
      ],
    });
    const item = r.find((n) => n.kind === 'attendance_no_checkin_record');
    expect(item).toBeDefined();
    expect(item?.title).toContain('沒有簽到紀錄');
    expect(item?.body).toContain('若有出席請向老師確認或申請更正');
    assertNoAbsenceWording([item!.title, item!.body]);
  });

  it('規則5：資料讀取失敗或課表未連結 → 無場次時不通知、不推論', () => {
    for (const scheduleStatus of ['error', 'unlinked'] as const) {
      const r = planNotifications({
        ...baseCtx,
        todayAttendanceSituations: [
          situation({
            scheduleStatus,
            session: { kind: 'none' },
          }),
        ],
      });
      expect(r.filter((n) => n.kind.startsWith('attendance_'))).toHaveLength(0);
    }
  });

  it('規則6：老師明確標記缺席 → planner 不新增推播（沿用既有流程）', () => {
    const r = planNotifications({
      ...baseCtx,
      todayAttendanceSituations: [
        situation({
          scheduleStatus: 'ok',
          session: {
            kind: 'ended',
            id: 's-absent',
            studentCheckedIn: false,
            studentMarkedAbsent: true,
            studentMarkedExcused: false,
          },
        }),
      ],
    });
    expect(r.find((n) => n.kind === 'attendance_no_checkin_record')).toBeUndefined();
    expect(r.find((n) => n.kind === 'attendance_active')).toBeUndefined();
    expect(r.filter((n) => n.kind.startsWith('attendance_'))).toHaveLength(0);
  });

  it('resolveAttendanceScheduleStatus：純函式對應課表狀態', () => {
    expect(
      resolveAttendanceScheduleStatus({
        now: NOW,
        hasScheduleLink: false,
      }),
    ).toBe('unlinked');
    expect(
      resolveAttendanceScheduleStatus({
        now: NOW,
        hasScheduleLink: true,
        scheduleLoadError: true,
      }),
    ).toBe('error');
    expect(
      resolveAttendanceScheduleStatus({
        now: NOW,
        hasScheduleLink: true,
        classStartAt: '2026-05-15T11:00:00+08:00',
        classEndAt: '2026-05-15T13:00:00+08:00',
      }),
    ).toBe('before_class');
    expect(
      resolveAttendanceScheduleStatus({
        now: NOW,
        hasScheduleLink: true,
        classStartAt: '2026-05-15T09:00:00+08:00',
        classEndAt: '2026-05-15T12:00:00+08:00',
      }),
    ).toBe('ok');
  });

  it('planAttendanceSituationNotices：無簽到紀錄文案永不含缺席／曠課／扣分', () => {
    const items = planAttendanceSituationNotices(
      situation({
        session: {
          kind: 'ended',
          id: 's1',
          studentCheckedIn: false,
          studentMarkedAbsent: false,
          studentMarkedExcused: false,
        },
        scheduleStatus: 'ok',
      }),
      NOW,
    );
    assertNoAbsenceWording(items.flatMap((item) => [item.title, item.body]));
  });
});

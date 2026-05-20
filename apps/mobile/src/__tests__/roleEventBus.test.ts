/**
 * @jest-environment node
 *
 * 跨角色 event bus 完整單元測試。
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  subscribeRoleEvent,
  subscribeAllRoleEvents,
  emitGradePublished,
  emitBulkReminder,
  emitFeedbackDrafted,
  emitDepartmentBroadcast,
  emitHomeworkSubmitted,
  emitHelpRequested,
  emitLeaveRequested,
  emitOrderPlaced,
  emitOrderStatusChanged,
  loadRoleEventInbox,
  loadVisibleRoleEventInbox,
  clearRoleEventInbox,
} from '../services/roleEventBus';

describe('roleEventBus', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('subscribeRoleEvent + emit → listener 收到事件', async () => {
    const received: any[] = [];
    const unsub = subscribeRoleEvent('grade_published', (e) => {
      received.push(e);
    });
    await emitGradePublished({
      actorUid: 'teacher1',
      targetUids: ['student1'],
      courseId: 71378,
      courseName: 'ML',
      payload: { itemTitle: 'HW1', itemKind: 'homework', score: 90, totalScore: 100 },
    });
    expect(received).toHaveLength(1);
    expect(received[0].kind).toBe('grade_published');
    expect((received[0].payload as any).score).toBe(90);
    unsub();
  });

  it('unsubscribe 後不再收事件', async () => {
    const received: any[] = [];
    const unsub = subscribeRoleEvent('grade_published', (e) => received.push(e));
    unsub();
    await emitGradePublished({
      actorUid: 't1',
      courseId: 'c1',
      courseName: 'ML',
      payload: { itemTitle: 'A', itemKind: 'homework', score: 80, totalScore: 100 },
    });
    expect(received).toHaveLength(0);
  });

  it('subscribeAllRoleEvents 收所有 kinds', async () => {
    const received: any[] = [];
    const unsub = subscribeAllRoleEvents((e) => received.push(e));
    await emitBulkReminder({
      actorUid: 't1',
      courseId: 'c1',
      courseName: 'ML',
      payload: { homeworkTitle: 'HW1', count: 5 },
    });
    await emitFeedbackDrafted({
      actorUid: 't1',
      courseId: 'c1',
      courseName: 'ML',
      payload: { studentName: '小明', homeworkTitle: 'HW1', draftPreview: 'x' },
    });
    expect(received).toHaveLength(2);
    expect(received.map((e) => e.kind)).toEqual([
      'bulk_reminder_sent',
      'feedback_drafted',
    ]);
    unsub();
  });

  it('targetUids 學生能在 inbox 裡讀到自己的事件', async () => {
    await emitFeedbackDrafted({
      actorUid: 'teacher1',
      targetUids: ['stu_alice'],
      courseId: 71378,
      courseName: 'ML',
      payload: { studentName: 'Alice', homeworkTitle: 'HW1', draftPreview: 'good job' },
    });
    const inbox = await loadRoleEventInbox('stu_alice');
    expect(inbox).toHaveLength(1);
    expect(inbox[0].kind).toBe('feedback_drafted');
  });

  it('沒指定 targetUids → 廣播給 __all__；任何 uid 都讀得到', async () => {
    await emitGradePublished({
      actorUid: 't1',
      courseId: 'c1',
      courseName: 'ML',
      payload: { itemTitle: 'mid', itemKind: 'exam', score: 87, totalScore: 100 },
    });
    const inboxA = await loadRoleEventInbox('stu_x');
    const inboxB = await loadRoleEventInbox('stu_y');
    expect(inboxA.length).toBeGreaterThan(0);
    expect(inboxB.length).toBeGreaterThan(0);
  });

  it('clearRoleEventInbox 清空指定 uid 的 inbox', async () => {
    await emitBulkReminder({
      actorUid: 't1',
      targetUids: ['stu_clear'],
      courseId: 'c1',
      courseName: 'ML',
      payload: { homeworkTitle: 'HW1', count: 1 },
    });
    expect((await loadRoleEventInbox('stu_clear')).length).toBeGreaterThan(0);
    await clearRoleEventInbox('stu_clear');
    expect(await loadRoleEventInbox('stu_clear')).toHaveLength(0);
  });

  it('inbox 限制 100 筆', async () => {
    for (let i = 0; i < 120; i++) {
      await emitFeedbackDrafted({
        actorUid: 't1',
        targetUids: ['stu_overflow'],
        courseId: 'c1',
        courseName: 'ML',
        payload: { studentName: 's', homeworkTitle: `HW${i}`, draftPreview: 'x' },
      });
    }
    const inbox = await loadRoleEventInbox('stu_overflow');
    expect(inbox.length).toBeLessThanOrEqual(100);
  });

  it('visible inbox 會依 viewer role 擋掉不屬於學生的事件', async () => {
    await emitHomeworkSubmitted({
      actorUid: 'stu_bob',
      actorName: 'Bob',
      targetUids: ['stu_alice'],
      courseId: 'c1',
      courseName: 'ML',
      payload: {
        homeworkId: 'hw1',
        homeworkTitle: 'HW1',
        studentName: 'Bob',
        isLate: false,
        submittedAt: '2026-05-20T00:00:00Z',
      },
    });

    expect(await loadRoleEventInbox('stu_alice')).toHaveLength(1);
    expect(await loadVisibleRoleEventInbox({ uid: 'stu_alice', role: 'student' })).toHaveLength(0);
    expect(await loadVisibleRoleEventInbox({ uid: 'stu_alice', role: 'teacher' })).toHaveLength(1);
  });

  it('order_placed 廣播只給 vendor 與下單本人看，不會漏到其他學生', async () => {
    await emitOrderPlaced({
      actorUid: 'stu_order_owner',
      actorName: 'Owner',
      targetUids: undefined,
      courseId: 'merchant_cafe_a',
      courseName: '靜宜中餐部',
      payload: {
        orderId: 'o1',
        merchantId: 'merchant_cafe_a',
        merchantName: '靜宜中餐部',
        items: '便當 ×1',
        total: 80,
        studentName: 'Owner',
      },
    });

    expect(await loadVisibleRoleEventInbox({ uid: 'demo_cafeteria', role: 'vendor' })).toHaveLength(1);
    expect(await loadVisibleRoleEventInbox({ uid: 'stu_order_owner', role: 'student' })).toHaveLength(1);
    expect(await loadVisibleRoleEventInbox({ uid: 'stu_other', role: 'student' })).toHaveLength(0);
  });

  it('order_placed 下單本人不限 student role，vendor/alumni/guest 也只看自己的單', async () => {
    await emitOrderPlaced({
      actorUid: 'demo_alumni_chang',
      actorName: '張學長',
      targetUids: undefined,
      courseId: 'merchant_cafe_a',
      courseName: '靜宜中餐部',
      payload: {
        orderId: 'o_alumni',
        merchantId: 'merchant_cafe_a',
        merchantName: '靜宜中餐部',
        items: '排骨便當 ×1',
        total: 85,
        studentName: '張學長',
      },
    });

    expect(await loadVisibleRoleEventInbox({ uid: 'demo_alumni_chang', role: 'alumni' })).toHaveLength(1);
    expect(await loadVisibleRoleEventInbox({ uid: 'demo_guest', role: 'guest' })).toHaveLength(0);
  });

  it('order_status_changed 明確 target 到誰，該 demo 角色就看得到', async () => {
    await emitOrderStatusChanged({
      actorUid: 'demo_cafeteria',
      actorName: '阿英',
      targetUids: ['demo_guest'],
      courseId: 'merchant_cafe_a',
      courseName: '靜宜中餐部',
      payload: {
        orderId: 'o_guest',
        merchantName: '靜宜中餐部',
        newStatus: 'ready',
        message: '餐點好了',
      },
    });

    expect(await loadVisibleRoleEventInbox({ uid: 'demo_guest', role: 'guest' })).toHaveLength(1);
    expect(await loadVisibleRoleEventInbox({ uid: 'demo_student_kuchih', role: 'student' })).toHaveLength(0);
  });

  it('學生請假會出現在老師與系主任 visible inbox，不會出現在其他學生 inbox', async () => {
    await emitLeaveRequested({
      actorUid: 'demo_student_kuchih',
      actorName: '顧晉瑋',
      targetUids: ['demo_teacher_chang', 'demo_admin_huang'],
      courseId: 'leave',
      courseName: '請假申請',
      payload: {
        leaveId: 'leave_demo',
        studentName: '顧晉瑋',
        category: 'sick',
        fromDate: '2026-05-21',
        toDate: '2026-05-21',
        reason: '看醫生',
      },
    });

    expect(await loadVisibleRoleEventInbox({ uid: 'demo_teacher_chang', role: 'teacher' })).toHaveLength(1);
    expect(await loadVisibleRoleEventInbox({ uid: 'demo_admin_huang', role: 'department_head' })).toHaveLength(1);
    expect(await loadVisibleRoleEventInbox({ uid: 'student_other', role: 'student' })).toHaveLength(0);
  });

  it('老師請假只會送到系主任，不會送回老師自己', async () => {
    await emitLeaveRequested({
      actorUid: 'demo_teacher_chang',
      actorName: '張怡君',
      targetUids: ['demo_teacher_chang', 'demo_admin_huang'],
      courseId: 'leave',
      courseName: '請假申請',
      payload: {
        leaveId: 'leave_teacher',
        studentName: '張怡君',
        category: 'personal',
        fromDate: '2026-05-22',
        toDate: '2026-05-22',
        reason: '校外會議',
      },
    });

    expect(await loadVisibleRoleEventInbox({ uid: 'demo_teacher_chang', role: 'teacher' })).toHaveLength(0);
    expect(await loadVisibleRoleEventInbox({ uid: 'demo_admin_huang', role: 'department_head' })).toHaveLength(1);
  });

  it('作業繳交與求助只進老師 / TA visible inbox', async () => {
    await emitHomeworkSubmitted({
      actorUid: 'demo_student_kuchih',
      actorName: '顧晉瑋',
      targetUids: ['demo_teacher_chang', 'demo_ta_lin'],
      courseId: 'c1',
      courseName: '機器學習',
      payload: {
        homeworkId: 'hw1',
        homeworkTitle: 'HW1',
        studentName: '顧晉瑋',
        isLate: false,
        submittedAt: '2026-05-20T00:00:00Z',
      },
    });
    await emitHelpRequested({
      actorUid: 'demo_student_kuchih',
      actorName: '顧晉瑋',
      targetUids: ['demo_teacher_chang', 'demo_ta_lin'],
      courseId: 'c1',
      courseName: '機器學習',
      payload: {
        topic: '鏈結串列卡關',
        preview: '想請助教協助',
        urgency: 'medium',
      },
    });

    expect(await loadVisibleRoleEventInbox({ uid: 'demo_teacher_chang', role: 'teacher' })).toHaveLength(2);
    expect(await loadVisibleRoleEventInbox({ uid: 'demo_ta_lin', role: 'ta' })).toHaveLength(2);
    expect(await loadVisibleRoleEventInbox({ uid: 'demo_student_kuchih', role: 'student' })).toHaveLength(0);
  });

  it('department_broadcast audience=teachers 不會出現在學生 visible inbox', async () => {
    await emitDepartmentBroadcast({
      actorUid: 'demo_admin_huang',
      actorName: '黃主任',
      targetUids: undefined,
      courseId: 'department',
      courseName: '系所公告',
      payload: {
        title: '教師會議',
        body: '教師限定',
        audience: 'teachers',
      },
    });

    expect(await loadVisibleRoleEventInbox({ uid: 'stu_alice', role: 'student' })).toHaveLength(0);
    expect(await loadVisibleRoleEventInbox({ uid: 'demo_teacher_chang', role: 'teacher' })).toHaveLength(1);
  });
});

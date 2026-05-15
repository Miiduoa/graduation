/**
 * @jest-environment node
 *
 * 跨角色 event bus 完整單元測試。
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  subscribeRoleEvent,
  subscribeAllRoleEvents,
  emitRoleEvent,
  emitGradePublished,
  emitBulkReminder,
  emitFeedbackDrafted,
  loadRoleEventInbox,
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
});

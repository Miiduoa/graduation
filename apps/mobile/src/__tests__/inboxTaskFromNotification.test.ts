/**
 * @jest-environment node
 */
import { inboxTaskFromAssignmentNotification } from '../utils/inboxTaskFromNotification';
import type { Notification } from '../state/notifications';

describe('inboxTaskFromAssignmentNotification', () => {
  const base: Notification = {
    id: 'n1',
    type: 'assignment',
    title: '作業截止提醒',
    body: '請於週五前繳交',
    read: false,
    data: { groupId: 'g1', assignmentId: 'a1', groupName: 'DB' },
  };

  test('作業 → assignment kind', () => {
    const t = inboxTaskFromAssignmentNotification(base);
    expect(t?.kind).toBe('assignment');
    expect(t?.groupId).toBe('g1');
    expect(t?.assignmentId).toBe('a1');
  });

  test('isQuiz → quiz kind', () => {
    const t = inboxTaskFromAssignmentNotification({
      ...base,
      data: { ...base.data, isQuiz: true },
    });
    expect(t?.kind).toBe('quiz');
  });

  test('缺 assignmentId → null', () => {
    expect(
      inboxTaskFromAssignmentNotification({
        ...base,
        data: { groupId: 'g1' },
      }),
    ).toBeNull();
  });
});

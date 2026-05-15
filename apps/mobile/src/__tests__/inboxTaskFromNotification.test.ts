/**
 * @jest-environment node
 */
import {
  inboxTaskFromAssignmentNotification,
  inboxTaskFromAssignmentPushData,
} from '../utils/inboxTaskFromNotification';
import { parseGroupAssignmentDeepLink } from '../app/assignmentDeepLink';
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

describe('inboxTaskFromAssignmentPushData', () => {
  test('對齊推播 data', () => {
    const t = inboxTaskFromAssignmentPushData({
      groupId: 'g1',
      assignmentId: 'a1',
      groupName: '課程甲',
      title: 'HW1',
    });
    expect(t?.kind).toBe('assignment');
    expect(t?.groupId).toBe('g1');
    expect(t?.title).toBe('HW1');
  });
});

describe('parseGroupAssignmentDeepLink', () => {
  test('解析 campus:// 路徑', () => {
    expect(parseGroupAssignmentDeepLink('campus://group/tc-1/assignment/tc-activity-2')).toEqual({
      groupId: 'tc-1',
      assignmentId: 'tc-activity-2',
    });
  });

  test('query kind=quiz → isQuiz', () => {
    expect(
      parseGroupAssignmentDeepLink(
        'campus://group/g1/assignment/a1?kind=quiz',
      ),
    ).toEqual({
      groupId: 'g1',
      assignmentId: 'a1',
      isQuiz: true,
    });
  });
});

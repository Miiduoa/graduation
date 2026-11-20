/**
 * @jest-environment node
 */
import {
  inboxTaskFromAssignmentNotification,
  inboxTaskFromAssignmentPushData,
} from '../utils/inboxTaskFromNotification';
import {
  parseGroupAssignmentDeepLink,
  parseGroupAssignmentsListDeepLink,
  parseGroupCourseHubDeepLink,
  isInterceptedMessagingDeepLink,
} from '../app/assignmentDeepLink';
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

  test('isQuiz 字串 true 也當測驗', () => {
    const t = inboxTaskFromAssignmentNotification({
      ...base,
      data: { ...base.data, isQuiz: 'true' },
    });
    expect(t?.kind).toBe('quiz');
  });

  test('assignment_due 通知也直達作業', () => {
    const t = inboxTaskFromAssignmentNotification({
      ...base,
      type: 'assignment_due' as Notification['type'],
      data: { courseId: 'cs101', assignmentId: 'hw-1', groupName: '資料結構' },
    });
    expect(t?.kind).toBe('assignment');
    expect(t?.groupId).toBe('cs101');
    expect(t?.assignmentId).toBe('hw-1');
  });

  test('成績通知也帶到那份作業', () => {
    const t = inboxTaskFromAssignmentNotification({
      ...base,
      type: 'grade',
      title: '成績已發布',
    });
    expect(t?.kind).toBe('assignment');
    expect(t?.assignmentId).toBe('a1');
  });

  test('courseId 也直達作業', () => {
    const t = inboxTaskFromAssignmentNotification({
      ...base,
      data: { courseId: 'cs101', assignmentId: 'hw-1', groupName: '資料結構' },
    });
    expect(t?.groupId).toBe('cs101');
    expect(t?.assignmentId).toBe('hw-1');
  });

  test('缺 assignmentId 仍能進課程', () => {
    const t = inboxTaskFromAssignmentNotification({
      ...base,
      data: { groupId: 'g1' },
    });
    expect(t?.groupId).toBe('g1');
    expect(t?.assignmentId).toBeUndefined();
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

  test('只有 courseId 的 assignment_due 仍能進課程', () => {
    const t = inboxTaskFromAssignmentPushData({
      type: 'assignment_due',
      courseId: 'cs101',
      groupName: '資料結構',
    });
    expect(t?.groupId).toBe('cs101');
    expect(t?.assignmentId).toBeUndefined();
  });
});

describe('parseGroupAssignmentDeepLink', () => {
  test('解析 campus:// 路徑', () => {
    expect(parseGroupAssignmentDeepLink('campus://group/tc-1/assignment/tc-activity-2')).toEqual({
      groupId: 'tc-1',
      assignmentId: 'tc-activity-2',
    });
  });

  test('group/.../assignments → groupId（不與單筆 assignment 混淆）', () => {
    expect(parseGroupAssignmentsListDeepLink('campus://group/g1/assignments')).toEqual({
      groupId: 'g1',
    });
    expect(parseGroupAssignmentsListDeepLink('campus://group/g1/assignment/hw1')).toBeNull();
  });

  test('isInterceptedMessagingDeepLink', () => {
    expect(isInterceptedMessagingDeepLink('campus://group/g1/assignments')).toBe(true);
    expect(isInterceptedMessagingDeepLink('campus://group/g/assignment/a')).toBe(true);
    expect(isInterceptedMessagingDeepLink('campus://group/g1/hub')).toBe(true);
    expect(isInterceptedMessagingDeepLink('campus://group/g1?hub=1')).toBe(true);
    expect(isInterceptedMessagingDeepLink('campus://group/g1')).toBe(false);
    expect(isInterceptedMessagingDeepLink('campus://inbox')).toBe(false);
  });
});

describe('parseGroupCourseHubDeepLink', () => {
  test('path …/group/id/hub', () => {
    expect(parseGroupCourseHubDeepLink('campus://group/course-1/hub')).toEqual({
      groupId: 'course-1',
    });
  });

  test('query hub=1（host=group）', () => {
    expect(parseGroupCourseHubDeepLink('campus://group/mygid?hub=1')).toEqual({
      groupId: 'mygid',
    });
  });

  test('query hub=1 允許 groupId 與 ? 之間的尾隨斜線', () => {
    expect(parseGroupCourseHubDeepLink('campus://group/mygid/?hub=1')).toEqual({
      groupId: 'mygid',
    });
  });

  test('?hub=1 不得誤判含 /post/ 的連結', () => {
    expect(parseGroupCourseHubDeepLink('campus://group/g1/post/p1?hub=1')).toBeNull();
  });
});

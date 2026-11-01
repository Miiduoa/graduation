/**
 * @jest-environment node
 */
import {
  isSafeDocumentId,
  resolveNotificationDestination,
  resolveNotificationRow,
} from '../utils/notificationDestination';
import type { Notification } from '../state/notifications';

describe('isSafeDocumentId', () => {
  test.each(['a', 'ann-1', 'peer_abc'])('accepts %s', (id) => {
    expect(isSafeDocumentId(id)).toBe(true);
  });
  test.each(['', '../x', 'a/b', '.', '..', 12, null])('rejects %s', (id) => {
    expect(isSafeDocumentId(id)).toBe(false);
  });
});

describe('resolveNotificationDestination', () => {
  test('announcement / event / group_post / message with valid ids', () => {
    expect(
      resolveNotificationDestination({
        data: { type: 'announcement', announcementId: 'a1' },
      }),
    ).toMatchObject({
      ok: true,
      mode: 'nested',
      tab: 'Today',
      screen: '公告詳情',
      params: { id: 'a1' },
    });
    expect(
      resolveNotificationDestination({ data: { type: 'event', eventId: 'e1' } }),
    ).toMatchObject({
      ok: true,
      screen: '活動詳情',
      params: { id: 'e1' },
    });
    expect(
      resolveNotificationDestination({
        data: { type: 'group_post', groupId: 'g1', postId: 'p1' },
      }),
    ).toMatchObject({
      ok: true,
      tab: '訊息',
      screen: 'GroupPost',
      params: { groupId: 'g1', postId: 'p1' },
    });
    expect(
      resolveNotificationDestination({ data: { type: 'message', peerId: 'u2' } }),
    ).toMatchObject({
      ok: true,
      screen: 'Chat',
      params: { kind: 'dm', peerId: 'u2' },
    });
  });

  test('friend and group invite open FriendsManage', () => {
    for (const type of ['friend_request', 'friend_invite', 'friend_accepted', 'group_invite']) {
      expect(resolveNotificationDestination({ data: { type } })).toMatchObject({
        ok: true,
        screen: 'FriendsManage',
      });
    }
  });

  test('assignment/quiz use inboxTask (not grade)', () => {
    const dest = resolveNotificationDestination({
      id: 'n1',
      type: 'assignment',
      title: 'HW',
      data: { groupId: 'c1', assignmentId: 'a1' },
    });
    expect(dest).toMatchObject({
      ok: true,
      mode: 'inboxTask',
      task: { kind: 'assignment', groupId: 'c1', assignmentId: 'a1' },
    });
    expect(
      resolveNotificationDestination({
        id: 'q1',
        type: 'quiz',
        data: { groupId: 'c1', quizId: 'quiz-1', isQuiz: true },
      }),
    ).toMatchObject({
      ok: true,
      mode: 'inboxTask',
      task: { kind: 'quiz', groupId: 'c1' },
    });
  });

  test('real grade producer payload opens LearnStack Grades, not homework', () => {
    // backend/functions/firestoreTriggerHandlers.js sendPushToUser data
    const payload = {
      type: 'grade',
      gradeId: 'grade-doc-1',
      schoolId: 'pu',
      channel: 'grades',
    };
    expect(
      resolveNotificationDestination({ data: payload }, { schoolId: 'pu', role: 'student' }),
    ).toMatchObject({
      ok: true,
      mode: 'nested',
      tab: '學習',
      screen: 'Grades',
      params: { gradeId: 'grade-doc-1', schoolId: 'pu' },
    });
    expect(
      resolveNotificationDestination({ data: payload }, { schoolId: 'nthu', role: 'student' }),
    ).toMatchObject({ ok: false, code: 'school_mismatch' });
    expect(
      resolveNotificationDestination({ data: payload }, { role: 'student' }),
    ).toMatchObject({ ok: false, code: 'school_mismatch' });
    expect(
      resolveNotificationDestination({ data: payload }, { schoolId: 'pu' }),
    ).toMatchObject({ ok: false, code: 'role_denied' });
    expect(
      resolveNotificationDestination({ data: payload }, { schoolId: 'pu', role: 'vendor' }),
    ).toMatchObject({ ok: false, code: 'role_denied' });
    // Missing groupId must not fall through to assignment/homework
    expect(
      resolveNotificationDestination({
        type: 'grade',
        data: payload,
      }),
    ).not.toMatchObject({ mode: 'inboxTask' });
  });

  test('malformed nested ids keep failure codes without inventing routes', () => {
    expect(
      resolveNotificationDestination({
        data: { type: 'announcement', announcementId: 'bad/id' },
      }),
    ).toMatchObject({ ok: false, code: 'malformed_id' });
    expect(
      resolveNotificationDestination({
        data: { type: 'message', peerId: '../x' },
      }),
    ).toMatchObject({ ok: false, code: 'malformed_id' });
    expect(
      resolveNotificationDestination({
        data: { type: 'group_post', groupId: 'g1', postId: '' },
      }),
    ).toMatchObject({ ok: false, code: 'missing_ids' });
  });

  test('unknown type and empty payload explain without destination', () => {
    expect(resolveNotificationDestination({ data: { type: 'library_due' } })).toMatchObject({
      ok: false,
      code: 'unknown_type',
    });
    expect(resolveNotificationDestination({})).toMatchObject({
      ok: false,
      code: 'empty_payload',
    });
  });

  test('resolveNotificationRow prefers row.type over data.type', () => {
    const row: Notification = {
      id: 'n2',
      type: 'event',
      title: '社課',
      body: '',
      read: false,
      data: { type: 'message', eventId: 'ev-9', peerId: 'should-ignore' },
    };
    expect(resolveNotificationRow(row)).toMatchObject({
      ok: true,
      screen: '活動詳情',
      params: { id: 'ev-9' },
    });
  });
});

test('本機作業提醒直接開啟指定作業，不以名稱或截止時間找作業', () => {
  const data = { type: 'local_assignment_due_v2', uid: 'alice', schoolId: 'pu',
    groupId: 'course', assignmentId: 'work' };
  expect(resolveNotificationDestination({ data }, { uid: 'alice', schoolId: 'pu' })).toMatchObject({
    ok: true, mode: 'nested', tab: '學習', screen: 'HomeworkSubmit',
    params: { groupId: 'course', assignmentId: 'work', fromReminder: true },
  });
  for (const context of [{ uid: 'bob', schoolId: 'pu' }, { uid: 'alice', schoolId: 'other' }]) {
    expect(resolveNotificationDestination({ data }, context)).toMatchObject({
      ok: true, mode: 'nested', tab: '學習', screen: 'LearnHome',
    });
  }
});

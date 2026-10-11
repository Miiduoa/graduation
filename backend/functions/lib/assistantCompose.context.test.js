'use strict';

jest.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({}),
  FieldValue: { serverTimestamp: () => 'server-timestamp' },
}));

const { buildAuthorizedAssistantContext } = require('./assistantCompose');

test('給模型的公告、活動、作業時間先換成台灣時間，跨日也對', () => {
  const context = buildAuthorizedAssistantContext({
    schoolId: 'pu',
    announcements: [{ id: 'a', title: '公告', publishedAt: new Date('2026-10-11T17:20:00Z') }],
    events: [{ id: 'e', title: '社團博覽會', location: '主顧廣場', startsAt: { seconds: Date.parse('2026-10-12T18:35:00Z') / 1000 } }],
    pendingAssignments: [{ id: 'h', title: 'HW1', dueAt: '2026-10-12T16:00:00.000Z' }],
  });
  expect(context.announcements[0].publishedAt).toBe('10 月 12 日 01:20');
  expect(context.events[0].startsAt).toBe('10 月 13 日 02:35');
  expect(context.pendingAssignments[0].dueAt).toBe('10 月 13 日 00:00');
});

test('時間讀不出來就不放，不塞原始值', () => {
  const context = buildAuthorizedAssistantContext({
    schoolId: 'pu',
    events: [{ id: 'e', title: '活動', startsAt: 'not a date' }],
  });
  expect(context.events[0]).toEqual({ id: 'e', title: '活動' });
});

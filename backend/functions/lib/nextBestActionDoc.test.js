'use strict';

const {
  buildNextBestActionFieldsFromInboxTask,
  assertValidInboxTaskPayload,
} = require('./nextBestActionDoc');

describe('nextBestActionDoc', () => {
  it('builds fields with nested inboxTask and 訊息 AssignmentDetail', () => {
    const task = {
      id: 't1',
      kind: 'assignment',
      groupId: 'g1',
      groupName: '課程 A',
      title: '作業一',
      subtitle: '明天交',
      priority: 2,
      assignmentId: 'hw1',
    };
    const doc = buildNextBestActionFieldsFromInboxTask(task, { source: 'inbox' });
    expect(doc.actionTarget.tab).toBe('訊息');
    expect(doc.actionTarget.screen).toBe('AssignmentDetail');
    expect(doc.inboxTask.assignmentId).toBe('hw1');
    expect(doc.inboxKind).toBe('assignment');
    expect(doc.source).toBe('inbox');
  });

  it('validates inbox task payloads', () => {
    expect(() => assertValidInboxTaskPayload(null)).toThrow();
    expect(() =>
      assertValidInboxTaskPayload({
        id: 'x',
        kind: 'assignment',
        groupId: 'g',
        title: 't',
        subtitle: 's',
        priority: 1,
      }),
    ).not.toThrow();
  });
});

import { describe, expect, it } from 'vitest';
import { parseAssistantCourseworkFollowup, type AssistantCourseworkFollowup } from '@campus/shared/src/assistantCourseworkFollowup';

const event = { title: '準備作業：資料結構', date: '2026-11-04', allDay: false, startTime: '10:35', endTime: '11:05' };
const expected = { schoolId: 'pu', mutationId: 'followup-calendar-001', event };
const original: AssistantCourseworkFollowup = {
  version: 1, operation: 'coursework.followup', ...expected,
  checkedAt: '2026-11-04T02:30:00.000Z', status: 'scheduled', calendar: 'matching',
  task: { workspaceId: 'course-a', taskId: 'task-a', kind: 'assignment' },
  source: { title: '資料結構', courseName: '程式設計', dueAt: '2026-11-05T23:59:00+08:00', state: 'open', submitted: false },
};
const read = (value: unknown) => parseAssistantCourseworkFollowup(value, expected);

describe('strict coursework followup read contract', () => {
  it.each(['scheduled', 'in_progress', 'elapsed', 'source_changed', 'conflict'] as const)(
    'accepts the original scoped event for %s without issuing action authority', status => {
      const checkedAt = status === 'in_progress' ? '2026-11-04T02:35:00.000Z'
        : status === 'elapsed' ? '2026-11-04T03:05:00.000Z' : original.checkedAt;
      const result = read({ ...original, status, checkedAt });
      expect(result.status).toBe(status);
      expect(result.event).toEqual(event);
      expect(result).not.toHaveProperty('token');
      expect(result).not.toHaveProperty('retryable');
    },
  );
  it('keeps source completion and calendar changes as separate facts', () => {
    expect(read({ ...original, status: 'submitted', calendar: 'missing',
      source: { ...original.source, submitted: true } })).toMatchObject({ status: 'submitted', calendar: 'missing' });
    expect(read({ ...original, status: 'closed', calendar: 'changed',
      source: { ...original.source, state: 'closed' } })).toMatchObject({ status: 'closed', calendar: 'changed' });
    expect(read({ ...original, status: 'event_changed', calendar: 'changed' })).toMatchObject({ status: 'event_changed' });
    expect(read({ ...original, status: 'event_missing', calendar: 'missing' })).toMatchObject({ status: 'event_missing' });
  });
  it('accepts unavailable partial reads and explicitly unrelated calendar cards', () => {
    expect(read({ ...original, status: 'unavailable', source: null })).toMatchObject({ task: original.task, source: null });
    expect(read({ ...original, status: 'unavailable', calendar: 'unavailable' })).toMatchObject({ source: original.source });
    expect(read({ ...original, status: 'not_coursework', task: null, source: null, calendar: 'unavailable' })).toMatchObject({ task: null });
  });
  it.each([
    { version: 2 }, { operation: 'calendar.create' }, { schoolId: 'ntu' }, { mutationId: 'another-action-001' },
    { event: { ...event, title: 'different source' } }, { event: { ...event, startTime: '10:40' } },
    { checkedAt: '2026-02-30T12:00:00.000Z' }, { checkedAt: 'yesterday' }, { status: 'completed' },
    { calendar: 'verified' }, { source: null }, { task: null }, { token: 'new-authority' }, { retryable: true },
    { source: { ...original.source, dueAt: '2026-11-05T12:00:00' } },
    { source: { ...original.source, dueAt: '2026-02-30T12:00:00Z' } },
    { source: { ...original.source, submitted: 'false' } },
    { source: { ...original.source, privateGrade: 99 } },
    { task: { ...original.task, kind: 'event' } }, { task: { ...original.task, taskId: '../task' } },
  ])('rejects unbound or malformed facts %j', change => {
    expect(() => read({ ...original, ...change })).toThrow();
  });
  it.each([
    { status: 'submitted' }, { status: 'closed' }, { status: 'event_missing' }, { status: 'event_changed' },
    { status: 'not_coursework' }, { calendar: 'unavailable' }, { status: 'elapsed' }, { status: 'in_progress' },
    { checkedAt: '2026-11-04T02:35:00.000Z' },
    { source: { ...original.source, submitted: true } }, { source: { ...original.source, state: 'closed' } },
  ])('rejects contradictory status %j', change => {
    expect(() => read({ ...original, ...change })).toThrow();
  });
  it('does not execute getters, accept inherited fields or silently fill absent fields', () => {
    let called = false;
    const getter = { ...original, get source() { called = true; return original.source; } };
    expect(() => read(getter)).toThrow();
    expect(called).toBe(false);
    expect(() => read(Object.create(original))).toThrow();
    const missing: Record<string, unknown> = { ...original };
    delete missing.checkedAt;
    expect(() => read(missing)).toThrow();
    expect(() => read({ ...original, [Symbol('hidden')]: true })).toThrow();
  });
});

/**
 * @jest-environment node
 *
 * Inbox actions 純函式測試。
 */
import { resolveInboxAction, resolveInboxActions } from '../services/inboxActions';
import type { InboxTask } from '../data/types';

const baseTask = (overrides: Partial<InboxTask>): InboxTask =>
  ({
    id: 't1',
    kind: 'assignment',
    groupId: 'cs1',
    groupName: 'DB',
    title: '繳交期中報告',
    subtitle: '今晚 23:59 截止',
    priority: 3,
    ...overrides,
  } as InboxTask);

describe('resolveInboxAction', () => {
  test('assignment → 去繳交（學生）', () => {
    const r = resolveInboxAction(baseTask({ kind: 'assignment', assignmentId: 'a1' }));
    expect(r?.target).toBe('submit_assignment');
    expect(r?.params).toMatchObject({ assignmentId: 'a1', courseSpaceId: 'cs1' });
    expect(r?.emphasis).toBe('primary');
  });

  test('assignment → 去批改（教師）', () => {
    const r = resolveInboxAction(baseTask({ kind: 'assignment', assignmentId: 'a1' }), {
      isTeachingRole: true,
    });
    expect(r?.target).toBe('grade_assignment');
    expect(r?.label).toBe('去批改');
  });

  test('quiz → 去作答（學生）', () => {
    const r = resolveInboxAction(baseTask({ kind: 'quiz', assignmentId: 'qz1' }));
    expect(r?.target).toBe('start_quiz');
    expect(r?.label).toBe('去作答');
  });

  test('quiz → 檢視測驗（教師）', () => {
    const r = resolveInboxAction(baseTask({ kind: 'quiz', assignmentId: 'qz1' }), {
      isTeachingRole: true,
    });
    expect(r?.target).toBe('start_quiz');
    expect(r?.label).toBe('檢視測驗');
  });

  test('live → 去簽到（學生）', () => {
    const r = resolveInboxAction(baseTask({ kind: 'live', sessionId: 's1' }));
    expect(r?.target).toBe('attendance_checkin');
    expect(r?.label).toBe('去簽到');
    expect(r?.params).toMatchObject({ sessionId: 's1' });
  });

  test('live → 進入課堂（教師）', () => {
    const r = resolveInboxAction(baseTask({ kind: 'live', sessionId: 's1' }), {
      isTeachingRole: true,
    });
    expect(r?.target).toBe('attendance_checkin');
    expect(r?.label).toBe('進入課堂');
  });

  test('group → 查看討論', () => {
    const r = resolveInboxAction(baseTask({ kind: 'group' }));
    expect(r?.target).toBe('open_discussion');
    expect(r?.emphasis).toBe('secondary');
  });

  test('assistant_queue → assistant_continue', () => {
    const r = resolveInboxAction(baseTask({ kind: 'assistant_queue' }));
    expect(r?.target).toBe('assistant_continue');
    expect(r?.params).toMatchObject({ sourceRunId: undefined });
  });

  test('未知 kind → null', () => {
    const r = resolveInboxAction({ ...baseTask({}), kind: 'unknown' as InboxTask['kind'] });
    expect(r).toBeNull();
  });

  test('每一個 action 都帶上 record event 設定', () => {
    const tasks: InboxTask[] = [
      baseTask({ kind: 'assignment' }),
      baseTask({ kind: 'quiz' }),
      baseTask({ kind: 'live' }),
    ];
    const r = resolveInboxActions(tasks);
    expect(r).toHaveLength(3);
    r.forEach(({ action }) => {
      expect(action?.recordEventOnComplete?.kind).toBe('inbox_action_taken');
    });
  });
});

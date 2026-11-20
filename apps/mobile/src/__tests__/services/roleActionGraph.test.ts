import { canRoleUseAction } from '../../utils/campusOs';

describe('role action graph', () => {
  test('student can use learning actions only', () => {
    expect(canRoleUseAction('student', 'schedule_reminder')).toBe(true);
    expect(canRoleUseAction('student', 'split_assignment')).toBe(true);
    expect(canRoleUseAction('student', 'submit_draft')).toBe(false);
  });

  test('teacher can submit draft actions', () => {
    expect(canRoleUseAction('teacher', 'draft_message')).toBe(true);
    expect(canRoleUseAction('teacher', 'submit_draft')).toBe(true);
  });

  test('staff cannot trigger assignment split', () => {
    expect(canRoleUseAction('staff', 'split_assignment')).toBe(false);
    expect(canRoleUseAction('staff', 'submit_draft')).toBe(true);
  });
});

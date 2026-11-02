import {
  ASSIGNMENT_FOCUS_MISSING,
  parseAssignmentFocusId,
  resolveAssignmentFocus,
} from '../screens/assignmentDeepLink';

describe('assignmentDeepLink', () => {
  it('parses assignment ids', () => {
    expect(parseAssignmentFocusId('hw-1')).toBe('hw-1');
    expect(parseAssignmentFocusId('../x')).toBeNull();
  });

  it('resolves focus state', () => {
    expect(resolveAssignmentFocus(['hw-1'], 'hw-1')).toEqual({ found: true, missing: false });
    expect(resolveAssignmentFocus(['hw-1'], 'hw-9')).toEqual({ found: false, missing: true });
    expect(ASSIGNMENT_FOCUS_MISSING).toContain('找不到這份作業');
  });
});

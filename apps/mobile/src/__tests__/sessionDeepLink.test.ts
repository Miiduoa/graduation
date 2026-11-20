import { SESSION_FOCUS_MISSING, parseSessionFocusId, resolveSessionFocus } from '../screens/sessionDeepLink';

describe('sessionDeepLink', () => {
  it('parses session ids', () => {
    expect(parseSessionFocusId('live-1')).toBe('live-1');
    expect(parseSessionFocusId('a/b')).toBeNull();
  });

  it('resolves focus state', () => {
    expect(resolveSessionFocus(['a'], 'a')).toEqual({ found: true, missing: false });
    expect(resolveSessionFocus(['a'], 'b')).toEqual({ found: false, missing: true });
    expect(SESSION_FOCUS_MISSING).toContain('找不到這一場點名');
  });
});

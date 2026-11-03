import { ORDER_FOCUS_MISSING, parseOrderFocusId, resolveOrderFocus } from '../screens/orderDeepLink';

describe('orderDeepLink', () => {
  it('parses safe order ids', () => {
    expect(parseOrderFocusId('co_ready_1')).toBe('co_ready_1');
    expect(parseOrderFocusId('../x')).toBeNull();
    expect(parseOrderFocusId('')).toBeNull();
  });

  it('resolves found versus missing focus', () => {
    expect(resolveOrderFocus(['a', 'b'], 'a')).toEqual({ found: true, missing: false });
    expect(resolveOrderFocus(['a'], 'gone')).toEqual({ found: false, missing: true });
    expect(ORDER_FOCUS_MISSING).toContain('找不到這筆訂單');
  });
});

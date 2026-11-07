import { parseOrderFocusId } from '../screens/orderDeepLink';

describe('orderDeepLink', () => {
  it('parses safe order ids', () => {
    expect(parseOrderFocusId('co_ready_1')).toBe('co_ready_1');
    expect(parseOrderFocusId('../x')).toBeNull();
    expect(parseOrderFocusId('')).toBeNull();
  });

});

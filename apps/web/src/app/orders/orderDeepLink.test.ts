import { afterEach, expect, it, vi } from 'vitest';
import {
  ORDER_FOCUS_MISSING,
  landOnOrder,
  orderFocusElementId,
  parseOrderFocusId,
  resolveOrderFocus,
} from './orderDeepLink';

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

it('accepts safe order ids and rejects path-like values', () => {
  expect(parseOrderFocusId('co_ready_aaa111')).toBe('co_ready_aaa111');
  expect(parseOrderFocusId('  co_ready_aaa111  ')).toBe('co_ready_aaa111');
  expect(parseOrderFocusId('../other')).toBeNull();
  expect(parseOrderFocusId('a/b')).toBeNull();
  expect(parseOrderFocusId('')).toBeNull();
  expect(parseOrderFocusId(null)).toBeNull();
});

it('marks a known order as found and an unknown one as missing', () => {
  expect(resolveOrderFocus(['a', 'b'], 'a')).toEqual({ found: true, missing: false });
  expect(resolveOrderFocus(['a', 'b'], 'missing')).toEqual({ found: false, missing: true });
  expect(resolveOrderFocus(['a'], null)).toEqual({ found: false, missing: false });
  expect(ORDER_FOCUS_MISSING).toContain('找不到這筆訂單');
});

it('scrolls to and marks the focused order element', () => {
  const node = document.createElement('article');
  node.id = orderFocusElementId('co_1');
  const scroll = vi.fn();
  const focus = vi.fn();
  node.scrollIntoView = scroll;
  node.focus = focus;
  document.body.append(node);

  expect(landOnOrder('co_1')).toBe(true);
  expect(node.getAttribute('data-order-focused')).toBe('true');
  expect(scroll).toHaveBeenCalled();
  expect(focus).toHaveBeenCalled();
  expect(landOnOrder('missing')).toBe(false);
});

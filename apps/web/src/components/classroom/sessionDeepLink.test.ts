import { afterEach, expect, it, vi } from 'vitest';
import {
  SESSION_FOCUS_MISSING,
  landOnSession,
  parseSessionFocusId,
  resolveSessionFocus,
  sessionFocusElementId,
} from './sessionDeepLink';

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

it('parses session ids safely', () => {
  expect(parseSessionFocusId('live-1')).toBe('live-1');
  expect(parseSessionFocusId('../x')).toBeNull();
  expect(parseSessionFocusId('')).toBeNull();
});

it('resolves focus against known sessions', () => {
  expect(resolveSessionFocus(['a', 'b'], 'b')).toEqual({ found: true, missing: false });
  expect(resolveSessionFocus(['a'], 'gone')).toEqual({ found: false, missing: true });
  expect(SESSION_FOCUS_MISSING).toContain('找不到這一場點名');
});

it('lands on the session card', () => {
  const node = document.createElement('article');
  node.id = sessionFocusElementId('sess-1');
  node.scrollIntoView = vi.fn();
  node.focus = vi.fn();
  document.body.append(node);
  expect(landOnSession('sess-1')).toBe(true);
  expect(node.getAttribute('data-session-focused')).toBe('true');
  expect(landOnSession('missing')).toBe(false);
});

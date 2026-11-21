import { expect, it } from 'vitest';
import { isCurrentTabNavigationClick } from './currentTabNavigation';

it('accepts a regular click and explicit case-insensitive current-window target', () => {
  const anchor = document.createElement('a');
  const click = new MouseEvent('click', { button: 0 });
  expect(isCurrentTabNavigationClick(click, anchor)).toBe(true);
  anchor.target = '_SELF';
  expect(isCurrentTabNavigationClick(click, anchor)).toBe(true);
});

it.each([
  { button: 1 },
  { button: 2 },
  { metaKey: true },
  { ctrlKey: true },
  { shiftKey: true },
  { altKey: true },
])('preserves browser behavior for %j', (gesture) => {
  expect(
    isCurrentTabNavigationClick(new MouseEvent('click', gesture), document.createElement('a')),
  ).toBe(false);
});

it('leaves cancelled clicks, downloads, named windows and new tabs untouched', () => {
  const anchor = document.createElement('a');
  const cancelled = new MouseEvent('click', { cancelable: true });
  cancelled.preventDefault();
  expect(isCurrentTabNavigationClick(cancelled, anchor)).toBe(false);
  const click = new MouseEvent('click');
  for (const target of ['_blank', 'another-window', '_parent', '_top']) {
    anchor.target = target;
    expect(isCurrentTabNavigationClick(click, anchor)).toBe(false);
  }
  anchor.removeAttribute('target');
  anchor.download = '';
  expect(isCurrentTabNavigationClick(click, anchor)).toBe(false);
});

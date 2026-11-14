import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { AnchorHTMLAttributes, MouseEvent } from 'react';
import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ServiceDirectory } from './ServiceDirectory';

const navigation = vi.hoisted(() => ({ search: '' }));
const selectedSchool = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(navigation.search),
}));
vi.mock('./SelectedSchoolProvider', () => ({ useOptionalSelectedSchool: selectedSchool }));
vi.mock('next/link', () => ({
  default: ({ onClick, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a
      {...props}
      onClick={(event: MouseEvent<HTMLAnchorElement>) => {
        onClick?.(event);
        event.preventDefault();
      }}
    />
  ),
}));

const nextHistoryState = {
  __NA: true,
  __PRIVATE_NEXTJS_INTERNALS_TREE: ['root', { children: ['life', {}] }],
  unrelated: { retained: true },
};
const lifeUrl = '/life?campus=pu&group=resources&q=%E5%80%9F%E6%9B%B8#services';
const originalScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');

function location(url: string, state: unknown = nextHistoryState) {
  window.history.replaceState(state, '', url);
  navigation.search = window.location.search.slice(1);
}

function pop(url: string, state: unknown) {
  location(url, state);
  act(() => window.dispatchEvent(new PopStateEvent('popstate', { state })));
}

function leaveLibrary() {
  location(lifeUrl);
  const view = render(<ServiceDirectory journey="life" />);
  fireEvent.click(screen.getByRole('link', { name: '圖書館' }));
  const entry = window.history.state;
  view.unmount();
  location('/library?campus=pu', { __NA: true });
  return entry;
}

beforeEach(() => {
  selectedSchool.mockReturnValue(null);
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
  pop('/life?campus=pu', nextHistoryState);
});

afterEach(() => {
  cleanup();
  pop('/life', null);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  selectedSchool.mockReset();
});

afterAll(() => {
  if (originalScroll)
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScroll);
  else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
});

it('Back arrives while the directory is unmounted and restores its original result once', () => {
  const entry = leaveLibrary();
  pop(lifeUrl, entry);
  const view = render(<ServiceDirectory journey="life" />);
  expect(document.activeElement).toBe(screen.getByRole('link', { name: '圖書館' }));
  expect(screen.getByRole('searchbox').getAttribute('value')).toBe('借書');
  expect(screen.getByRole('button', { name: '校園資源' }).getAttribute('aria-pressed')).toBe(
    'true',
  );

  const search = screen.getByRole('searchbox');
  search.focus();
  view.rerender(<ServiceDirectory journey="life" />);
  expect(document.activeElement).toBe(search);
  expect(window.history.state).toEqual(entry);
});

it('Forward to the service and Back again can restore the same history entry again', () => {
  const entry = leaveLibrary();
  pop(lifeUrl, entry);
  const view = render(<ServiceDirectory journey="life" />);
  expect(document.activeElement).toBe(screen.getByRole('link', { name: '圖書館' }));
  view.unmount();
  pop('/library?campus=pu', { __NA: true });
  pop(lifeUrl, entry);
  render(<ServiceDirectory journey="life" />);
  expect(document.activeElement).toBe(screen.getByRole('link', { name: '圖書館' }));
});

it('a first render or fresh main-navigation entry does not restore a saved history record', () => {
  const entry = leaveLibrary();
  location(lifeUrl, entry);
  const first = render(<ServiceDirectory journey="life" />);
  expect(document.activeElement).not.toBe(screen.getByRole('link', { name: '圖書館' }));
  first.unmount();
  location('/life?campus=pu', { __NA: true });
  render(<ServiceDirectory journey="life" />);
  expect(document.activeElement).not.toBe(screen.getByRole('link', { name: '圖書館' }));
});

it.each([
  '/life?campus=nthu&group=resources&q=%E5%80%9F%E6%9B%B8#services',
  '/life?campus=pu&group=resources#services',
  '/life?campus=pu&group=resources&q=%E5%80%9F%E6%9B%B8#different',
])('does not restore an old service into a different campus, filter or fragment: %s', (url) => {
  const entry = leaveLibrary();
  pop(url, entry);
  render(<ServiceDirectory journey="life" />);
  expect(document.activeElement).not.toBe(screen.getByRole('link', { name: '圖書館' }));
});

it('does not restore a query-free directory after its resolved campus preference changes', () => {
  selectedSchool.mockReturnValue({
    selectedSchool: { id: 'pu', code: 'PU' },
    loading: false,
    catalogStatus: 'ready',
  });
  location('/life');
  const view = render(<ServiceDirectory journey="life" />);
  fireEvent.click(screen.getByRole('link', { name: '圖書館' }));
  const entry = window.history.state;
  view.unmount();
  location('/library?campus=pu', { __NA: true });
  selectedSchool.mockReturnValue({
    selectedSchool: { id: 'nthu', code: 'NTHU' },
    loading: false,
    catalogStatus: 'ready',
  });
  pop('/life', entry);
  render(<ServiceDirectory journey="life" />);
  const library = screen.getByRole('link', { name: '圖書館' });
  expect(library.getAttribute('href')).toContain('campus=nthu');
  expect(document.activeElement).not.toBe(library);
});

it('opens only the parent disclosure needed to restore a child entry', () => {
  const url = '/life?campus=pu&group=daily';
  location(url);
  const view = render(<ServiceDirectory journey="life" />);
  const child = screen.getByRole('link', { name: '餐廳' });
  const parent = child.closest('details')!;
  parent.open = true;
  fireEvent.click(child);
  const entry = window.history.state;
  view.unmount();
  location('/cafeteria?campus=pu', { __NA: true });
  pop(url, entry);
  render(<ServiceDirectory journey="life" />);
  const restored = screen.getByRole('link', { name: '餐廳' });
  expect(restored.closest('details')!.open).toBe(true);
  expect(document.activeElement).toBe(restored);
});

it('does not restore a service that the current catalog no longer exposes', () => {
  vi.stubEnv('NEXT_PUBLIC_ONLINE_ORDERING', 'true');
  const url = '/life?campus=pu&group=daily';
  location(url);
  const view = render(<ServiceDirectory journey="life" />);
  const order = screen.getByRole('link', { name: 'App 餐廳訂單' });
  order.closest('details')!.open = true;
  fireEvent.click(order);
  const entry = window.history.state;
  view.unmount();
  location('/orders?campus=pu', { __NA: true });
  vi.stubEnv('NEXT_PUBLIC_ONLINE_ORDERING', 'false');
  pop(url, entry);
  render(<ServiceDirectory journey="life" />);
  expect(screen.queryByRole('link', { name: 'App 餐廳訂單' })).toBeNull();
  expect(screen.getByRole('link', { name: '餐廳' }).closest('details')!.open).toBe(false);
  expect(document.activeElement?.tagName).toBe('BODY');
});

it('restores the selected conversation entry without crossing into the life directory', () => {
  const url = '/connect?campus=pu&group=people&q=%E5%A5%BD%E5%8F%8B';
  location(url);
  const view = render(<ServiceDirectory journey="connect" />);
  fireEvent.click(screen.getByRole('link', { name: '找人' }));
  const entry = window.history.state;
  view.unmount();
  location('/friends?campus=pu', { __NA: true });
  pop(url, entry);
  render(<ServiceDirectory journey="connect" />);
  expect(document.activeElement).toBe(screen.getByRole('link', { name: '找人' }));
});

it('keeps Next history data and unrelated fields, but filter edits remove the old return', () => {
  location('/life?campus=pu');
  render(<ServiceDirectory journey="life" />);
  fireEvent.click(screen.getByRole('link', { name: '圖書館' }));
  expect(window.history.state).toMatchObject(nextHistoryState);
  expect(Object.keys(window.history.state)).toHaveLength(Object.keys(nextHistoryState).length + 1);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '公車' } });
  expect(window.history.state).toEqual(nextHistoryState);
  expect(window.location.search).toBe('?campus=pu&q=%E5%85%AC%E8%BB%8A');
});

it.each([
  { ctrlKey: true },
  { metaKey: true },
  { shiftKey: true },
  { altKey: true },
  { button: 1 },
])('opening another tab/window does not mark the current entry: %j', (modifier) => {
  location('/life?campus=pu');
  render(<ServiceDirectory journey="life" />);
  fireEvent.click(screen.getByRole('link', { name: '圖書館' }), modifier);
  expect(window.history.state).toEqual(nextHistoryState);
});

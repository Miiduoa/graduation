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

it('visitors can filter available services, keep the campus and reset without losing input focus', () => {
  const view = render(<ServiceDirectory journey="life" />);
  fireEvent.click(screen.getByRole('checkbox', { name: '只看免登入服務' }));
  expect(screen.getByRole('heading', { name: '免登入服務' })).toBeTruthy();
  expect(screen.getByRole('link', { name: '餐廳' }).getAttribute('href')).toBe(
    '/cafeteria?campus=pu',
  );
  expect(screen.queryByRole('link', { name: '點餐與取餐' })).toBeNull();
  expect(new URL(window.location.href).searchParams.get('access')).toBe('public');
  view.unmount();
  navigation.search = window.location.search.slice(1);
  render(<ServiceDirectory journey="life" />);
  expect(
    (screen.getByRole('checkbox', { name: '只看免登入服務' }) as HTMLInputElement).checked,
  ).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '顯示全部服務' }));
  expect(new URL(window.location.href).searchParams.get('campus')).toBe('pu');
  expect(new URL(window.location.href).searchParams.has('access')).toBe(false);
  expect(screen.getByRole('link', { name: '點餐與取餐' })).toBeTruthy();
  expect(document.activeElement).toBe(screen.getByRole('searchbox'));
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
  expect(window.history.state).toEqual({ ...nextHistoryState, __NA: undefined });
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

it.each([
  { journey: 'life', query: '', heading: '服務目錄' },
  { journey: 'connect', query: '', heading: '服務目錄' },
  { journey: 'life', query: '&q=借書', heading: '搜尋結果' },
  { journey: 'connect', query: '&q=好友', heading: '搜尋結果' },
  { journey: 'life', query: '&q=找不到的服務xyz', heading: '搜尋結果' },
  { journey: 'connect', query: '&q=找不到的服務xyz', heading: '搜尋結果' },
  { journey: 'life', query: '&group=travel', heading: '出門與交通' },
  { journey: 'connect', query: '&group=people', heading: '找人與聊天' },
  { journey: 'life', query: '&access=public', heading: '免登入服務' },
  { journey: 'connect', query: '&access=public', heading: '免登入服務' },
] as const)(
  'explicit search in $journey focuses its $heading result, including empty and filter-only states ($query)',
  ({ journey, query, heading }) => {
    location(`/${journey}?campus=pu${query}#services`);
    render(<ServiceDirectory journey={journey} />);
    const input = screen.getByRole('searchbox');
    input.focus();
    const previousUrl = window.location.href;
    const previousState = window.history.state;

    fireEvent.submit(screen.getByRole('search'));

    const resultHeading = screen.getByRole('heading', { name: heading, level: 2 });
    const region = screen.getByRole('region', { name: '服務搜尋結果' });
    expect(document.activeElement).toBe(resultHeading);
    expect(resultHeading.getAttribute('tabindex')).toBe('-1');
    expect(region.id).toBe(input.getAttribute('aria-controls'));
    expect(region.contains(resultHeading)).toBe(true);
    expect(resultHeading.getAttribute('aria-describedby')).toBe(screen.getByRole('status').id);
    expect(window.location.href).toBe(previousUrl);
    expect(window.history.state).toEqual(previousState);
  },
);

it.each(['life', 'connect'] as const)(
  'the visible search action and native submit share one result target in %s',
  (journey) => {
    location(`/${journey}?campus=pu`);
    render(<ServiceDirectory journey={journey} />);
    const input = screen.getByRole('searchbox');
    const action = screen.getByRole('button', { name: '查看結果' });
    input.focus();
    fireEvent.click(action);
    const heading = screen.getByRole('heading', { name: '服務目錄', level: 2 });
    expect(document.activeElement).toBe(heading);
    expect(action.getAttribute('type')).toBe('submit');
    expect(action.getAttribute('aria-controls')).toBe(input.getAttribute('aria-controls'));

    input.focus();
    expect(fireEvent.keyDown(input, { key: 'Enter' })).toBe(true);
    fireEvent.submit(screen.getByRole('search'));
    expect(document.activeElement).toBe(heading);
  },
);

it('live filtering keeps the current control focused and preserves the result heading across result states', () => {
  render(<ServiceDirectory journey="life" />);
  const input = screen.getByRole('searchbox');
  const heading = screen.getByRole('heading', { name: '服務目錄', level: 2 });
  input.focus();
  fireEvent.change(input, { target: { value: '借書' } });
  expect(document.activeElement).toBe(input);
  expect(screen.getByRole('heading', { name: '搜尋結果', level: 2 })).toBe(heading);
  expect(screen.getByRole('link', { name: '圖書館' })).toBeTruthy();

  const category = screen.getByRole('button', { name: '出門與交通' });
  category.focus();
  fireEvent.click(category);
  expect(document.activeElement).toBe(category);
  expect(screen.getByRole('heading', { name: '沒有找到符合的服務' })).toBeTruthy();
  expect(screen.getByRole('heading', { name: '搜尋結果', level: 2 })).toBe(heading);
  fireEvent.click(screen.getByRole('button', { name: '查看結果' }));
  expect(document.activeElement).toBe(heading);

  fireEvent.click(screen.getByRole('button', { name: '顯示全部服務' }));
  expect(document.activeElement).toBe(input);
  expect(screen.getByRole('heading', { name: '服務目錄', level: 2 })).toBe(heading);
});

it('composition keeps Enter and Escape with the input method and does not submit unfinished text', () => {
  render(<ServiceDirectory journey="life" />);
  const input = screen.getByRole('searchbox') as HTMLInputElement;
  const form = screen.getByRole('search');
  input.focus();
  fireEvent.compositionStart(input);
  fireEvent.change(input, { target: { value: '借' } });
  expect(fireEvent.keyDown(input, { key: 'Enter' })).toBe(false);
  fireEvent.keyDown(input, { key: 'Escape' });
  fireEvent.submit(form);
  expect(document.activeElement).toBe(input);
  expect(input.value).toBe('借');
  expect(new URL(window.location.href).searchParams.has('q')).toBe(false);

  fireEvent.compositionEnd(input, { data: '借書', target: { value: '借書' } });
  expect(new URL(window.location.href).searchParams.get('q')).toBe('借書');
  // Safari can report compositionend before the confirming Enter keydown.
  expect(fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 })).toBe(false);
  fireEvent.keyDown(input, { key: 'Escape', keyCode: 229 });
  expect(document.activeElement).toBe(input);
  expect(input.value).toBe('借書');
  expect(fireEvent.keyDown(input, { key: 'Enter', isComposing: true })).toBe(false);
  fireEvent.keyDown(input, { key: 'Escape', isComposing: true });
  expect(input.value).toBe('借書');

  expect(fireEvent.keyDown(input, { key: 'Enter' })).toBe(true);
  fireEvent.submit(form);
  expect(document.activeElement).toBe(screen.getByRole('heading', { name: '搜尋結果', level: 2 }));
});

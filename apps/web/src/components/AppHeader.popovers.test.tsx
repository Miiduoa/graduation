import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { AppHeader } from './AppHeader';

const state = vi.hoisted(() => ({
  pathname: '/timetable',
  search: 'schoolId=pu',
  hash: '',
  campus: 'schoolId=pu',
  hydrated: true,
  firebase: {
    user: null as { uid: string } | null,
    loading: false,
    signOutUser: vi.fn(),
  },
  nuni: {
    session: null as null | { platformAccountId: string; isPlatformOperator: boolean },
    loading: false,
    pendingLogout: false,
    logout: vi.fn(),
  },
}));

vi.mock('next/navigation', () => ({
  usePathname: () => state.pathname,
  useSearchParams: () => new URLSearchParams(state.search),
}));
vi.mock('@/lib/useClientHydrated', () => ({ useClientHydrated: () => state.hydrated }));
vi.mock('@/lib/useLocationHash', () => ({ useLocationHash: () => state.hash }));
vi.mock('@/lib/campusNavigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/campusNavigation')>()),
  useCampusNavigationSearch: () => state.campus,
}));
vi.mock('@/lib/useCampusBrowseContext', () => ({ useCampusBrowseContext: () => ({ status: 'ready', schoolId: state.campus }) }));
vi.mock('./AuthGuard', () => ({ useAuth: () => state.firebase }));
vi.mock('@/features/nuni/Session', () => ({ useNuniSession: () => state.nuni }));
vi.mock('./SchoolSelector', () => ({
  SchoolSelector: () => (
    <details name="campus-navigation-popover">
      <summary>切換校園</summary>
      <input aria-label="搜尋校園" />
    </details>
  ),
}));
vi.mock('./CampusServiceMenu', () => ({
  CampusServiceMenu: () => (
    <details name="campus-navigation-popover">
      <summary>所有服務</summary>
      <a href="/library">圖書館</a>
    </details>
  ),
}));
vi.mock('./TodayCampusEntry', () => ({
  TodayCampusEntry: () => (
    <div>
      <label htmlFor="header-quick-input">想做什麼？</label>
      <input id="header-quick-input" />
      <a href="/library">查看圖書館</a>
    </div>
  ),
}));

beforeEach(async () => {
  // Resolve React.lazy before the synchronous popover interactions.
  const warmup = render(<AppHeader />);
  fireEvent.click(screen.getByRole('button', { name: '開啟校園助理' }));
  await screen.findByLabelText('想做什麼？');
  warmup.unmount();
  vi.clearAllMocks();
  state.pathname = '/timetable';
  state.search = 'schoolId=pu';
  state.hash = '';
  state.campus = 'schoolId=pu';
  state.hydrated = true;
  state.firebase.user = null;
  state.firebase.loading = false;
  state.firebase.signOutUser.mockResolvedValue(undefined);
  state.nuni.session = null;
  state.nuni.loading = false;
  state.nuni.pendingLogout = false;
  state.nuni.logout.mockResolvedValue(undefined);
});

function openVoice() {
  const trigger = screen.getByRole('button', { name: '開啟校園助理' });
  fireEvent.click(trigger);
  return { trigger, panel: screen.getByRole('dialog', { name: '校園助理' }) };
}

it('keeps account actions in one disclosure and removes privileged links while revalidating', () => {
  state.nuni.session = { platformAccountId: 'operator', isPlatformOperator: true };
  const view = render(<AppHeader />);
  const disclosure = screen.getByLabelText('帳號').closest('details');
  expect(disclosure?.open).toBe(false);
  expect(screen.getByRole('link', { name: '我的帳號' }).closest('details')).toBe(disclosure);
  expect(screen.getByRole('link', { name: '平台管理' }).closest('details')).toBe(disclosure);
  fireEvent.click(screen.getByLabelText('帳號'));
  expect(screen.getByRole('link', { name: '我的帳號' }).getAttribute('href')).toBe('/profile');
  expect(screen.getByRole('link', { name: '平台管理' }).getAttribute('href')).toBe('/admin');
  expect(screen.getByRole('button', { name: '登出' })).toBeTruthy();

  state.nuni.loading = true;
  view.rerender(<AppHeader />);
  expect(screen.queryByRole('link', { name: '平台管理', hidden: true })).toBeNull();
  expect(screen.queryByRole('link', { name: '我的帳號', hidden: true })).toBeNull();
  expect(screen.getByRole('status').textContent).toContain('確認帳號中');
  expect((screen.getByRole('button', { name: '登出' }) as HTMLButtonElement).disabled).toBe(true);
});

it('keeps failed sign-out actionable and retries a pending platform logout', async () => {
  state.firebase.user = { uid: 'school-user' };
  state.nuni.session = { platformAccountId: 'platform-user', isPlatformOperator: false };
  state.nuni.logout.mockRejectedValueOnce(new Error('network unavailable'));
  const view = render(<AppHeader />);
  fireEvent.click(screen.getByLabelText('帳號'));
  fireEvent.click(screen.getByRole('button', { name: '登出' }));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', '登出失敗，請稍後重試。');
  await waitFor(() => expect(screen.getByRole('alert').closest('details')?.open).toBe(true));
  expect(state.firebase.signOutUser).toHaveBeenCalledOnce();
  expect(state.nuni.logout).toHaveBeenCalledOnce();

  state.firebase.user = null;
  state.nuni.session = null;
  state.nuni.pendingLogout = true;
  view.rerender(<AppHeader />);
  fireEvent.click(screen.getByLabelText('帳號，登出尚未完成'));
  fireEvent.click(screen.getByRole('button', { name: '重試登出' }));
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  expect(state.nuni.logout).toHaveBeenCalledTimes(2);
  expect(state.firebase.signOutUser).toHaveBeenCalledOnce();
});

it('returns account focus on explicit close, and keeps the selected outside control focused', () => {
  state.firebase.user = { uid: 'school-user' };
  render(
    <>
      <AppHeader />
      <button type="button">頁面操作</button>
    </>,
  );
  const trigger = screen.getByLabelText('帳號');
  fireEvent.click(trigger);
  const close = screen.getByRole('button', { name: '關閉帳號選單' });
  close.focus();
  fireEvent.keyDown(close, { key: 'Escape' });
  expect(trigger.closest('details')?.open).toBe(false);
  expect(document.activeElement).toBe(trigger);

  fireEvent.click(trigger);
  const outside = screen.getByRole('button', { name: '頁面操作' });
  act(() => outside.focus());
  expect(trigger.closest('details')?.open).toBe(false);
  expect(document.activeElement).toBe(outside);
});

it('opens a nonmodal voice panel and restores focus on Escape without cancelling IME composition', () => {
  render(<AppHeader />);
  const { trigger, panel } = openVoice();
  expect(document.activeElement).toBe(panel);
  expect(trigger.getAttribute('aria-expanded')).toBe('true');
  expect(trigger.getAttribute('aria-controls')).toBe(panel.id);
  const input = screen.getByLabelText('想做什麼？');
  input.focus();
  fireEvent.keyDown(input, { key: 'Escape', isComposing: true });
  expect(screen.getByRole('dialog')).toBe(panel);
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(trigger);
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
});

it('dismisses voice on outside pointer or keyboard focus without moving focus back', () => {
  render(
    <>
      <AppHeader />
      <button type="button">繼續頁面操作</button>
    </>,
  );
  openVoice();
  const outside = screen.getByRole('button', { name: '繼續頁面操作' });
  fireEvent.pointerDown(outside);
  expect(screen.queryByRole('dialog')).toBeNull();
  act(() => outside.focus());
  expect(document.activeElement).toBe(outside);

  openVoice();
  act(() => outside.focus());
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(outside);
});

it('keeps the measured header inset available to menus and voice without changing focus', () => {
  let onResize: (() => void) | undefined;
  const observe = vi.fn();
  const disconnect = vi.fn();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        onResize = callback;
      }
      observe = observe;
      disconnect = disconnect;
    },
  );
  const view = render(<AppHeader />);
  const navigation = screen.getByRole('banner');
  let bottom = 68;
  const geometry = vi
    .spyOn(navigation, 'getBoundingClientRect')
    .mockImplementation(() => ({ bottom }) as DOMRect);
  try {
    fireEvent(window, new Event('resize'));
    expect(navigation.style.getPropertyValue('--navigation-header-bottom')).toBe('68px');
    const { panel } = openVoice();
    expect(observe).toHaveBeenCalledWith(navigation);
    expect(panel.style.getPropertyValue('--voice-header-bottom')).toBe('68px');
    const input = screen.getByLabelText('想做什麼？');
    act(() => input.focus());

    bottom = 112;
    act(() => onResize?.());
    expect(panel.style.getPropertyValue('--voice-header-bottom')).toBe('112px');
    expect(navigation.style.getPropertyValue('--navigation-header-bottom')).toBe('112px');
    expect(document.activeElement).toBe(input);

    bottom = 88;
    fireEvent(window, new Event('resize'));
    expect(panel.style.getPropertyValue('--voice-header-bottom')).toBe('88px');
    bottom = -32;
    fireEvent(window, new Event('scroll'));
    expect(panel.style.getPropertyValue('--voice-header-bottom')).toBe('0px');
    expect(document.activeElement).toBe(input);

    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    bottom = 96;
    fireEvent(window, new Event('resize'));
    fireEvent(window, new Event('scroll'));
    expect(navigation.style.getPropertyValue('--navigation-header-bottom')).toBe('96px');
    expect(panel.style.getPropertyValue('--voice-header-bottom')).toBe('96px');

    const disconnectsBeforeUnmount = disconnect.mock.calls.length;
    view.unmount();
    expect(disconnect).toHaveBeenCalledTimes(disconnectsBeforeUnmount + 1);
    bottom = 120;
    fireEvent(window, new Event('resize'));
    fireEvent(window, new Event('scroll'));
    expect(navigation.style.getPropertyValue('--navigation-header-bottom')).toBe('96px');
  } finally {
    view.unmount();
    geometry.mockRestore();
    vi.unstubAllGlobals();
  }
});

it.each(['pathname', 'search', 'hash', 'campus'] as const)(
  'closes voice when %s changes and does not reopen it when returning',
  (key) => {
    const view = render(<AppHeader />);
    openVoice();
    const original = state[key];
    state[key] = key === 'pathname' ? '/library' : 'changed';
    view.rerender(<AppHeader />);
    expect(screen.queryByRole('dialog')).toBeNull();
    state[key] = original;
    view.rerender(<AppHeader />);
    expect(screen.queryByRole('dialog')).toBeNull();
  },
);

it('closes both disclosures when the signed-in account changes', () => {
  state.nuni.session = { platformAccountId: 'account-a', isPlatformOperator: false };
  const view = render(<AppHeader />);
  fireEvent.click(screen.getByLabelText('帳號'));
  state.nuni.session = { platformAccountId: 'account-b', isPlatformOperator: false };
  view.rerender(<AppHeader />);
  expect(screen.getByLabelText('帳號').closest('details')?.open).toBe(false);
  openVoice();
  state.nuni.session = { platformAccountId: 'account-c', isPlatformOperator: false };
  view.rerender(<AppHeader />);
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('closes an existing navigation disclosure before opening the voice panel', () => {
  render(<AppHeader />);
  const school = screen.getByText('切換校園').closest('details')!;
  school.open = true;
  openVoice();
  expect(school.open).toBe(false);
});

it('closes voice when another navigation disclosure opens', async () => {
  render(<AppHeader />);
  openVoice();
  const services = screen.getByText('所有服務').closest('details')!;
  act(() => {
    services.open = true;
    fireEvent(services, new Event('toggle'));
  });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(services.open).toBe(true);
});

it('keeps the Today shortcut in the existing assistant and closes other navigation popovers', () => {
  const onOpenVoice = vi.fn();
  render(<AppHeader onOpenAssistant={onOpenVoice} />);
  const services = screen.getByText('所有服務').closest('details')!;
  services.open = true;
  fireEvent.click(screen.getByRole('button', { name: '開啟校園助理' }));
  expect(onOpenVoice).toHaveBeenCalledOnce();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(services.open).toBe(false);
});

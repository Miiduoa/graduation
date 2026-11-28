import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const navigation = vi.hoisted(() => ({ pathname: '/life', search: '' }));
vi.mock('next/navigation', () => ({
  usePathname: () => navigation.pathname,
  useSearchParams: () => new URLSearchParams(navigation.search),
}));

let PWAInstallBanner: (typeof import('./PWAInstallBanner'))['PWAInstallBanner'];
let PWAInstallSettings: (typeof import('./PWAInstallSettings'))['PWAInstallSettings'];
let PWAInstallObserver: (typeof import('./PWAInstallObserver'))['PWAInstallObserver'];

function browser(ios = false, standalone = false) {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(ios ? 'iPhone' : 'Chrome');
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: standalone }));
}

function installEvent(
  prompt = vi.fn().mockResolvedValue(undefined),
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> = Promise.resolve({
    outcome: 'dismissed',
  }),
) {
  const event = new Event('beforeinstallprompt', { cancelable: true });
  Object.assign(event, { prompt, userChoice });
  act(() => window.dispatchEvent(event));
  return { event, prompt };
}

beforeEach(async () => {
  // A fresh module models a new browser visit. Individual tests also remount
  // within that visit to check that a captured one-use event survives routing.
  vi.resetModules();
  navigation.pathname = '/life';
  navigation.search = '';
  browser();
  ({ PWAInstallBanner } = await import('./PWAInstallBanner'));
  ({ PWAInstallSettings } = await import('./PWAInstallSettings'));
  ({ PWAInstallObserver } = await import('./PWAInstallObserver'));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('home screen installation', () => {
  it.each(['/bus', '/map', '/login', '/classroom/course/fixture', '/settings'])(
    'does not interrupt %s with an install suggestion',
    (pathname) => {
      browser(true);
      navigation.pathname = pathname;
      render(<PWAInstallBanner />);
      installEvent();
      expect(screen.queryByRole('region', { name: '加入主畫面' })).toBeNull();
    },
  );

  it('hides a visible suggestion immediately when the route changes', () => {
    browser(true);
    const page = render(<PWAInstallBanner />);
    expect(screen.getByRole('region', { name: '加入主畫面' })).toBeTruthy();
    navigation.pathname = '/bus';
    page.rerender(<PWAInstallBanner />);
    expect(screen.queryByRole('region', { name: '加入主畫面' })).toBeNull();
    navigation.pathname = '/life';
    page.rerender(<PWAInstallBanner />);
    expect(screen.getByRole('region', { name: '加入主畫面' })).toBeTruthy();
  });

  it('keeps server rendering independent of iOS and blocked storage', () => {
    browser(true);
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(renderToString(<PWAInstallObserver />)).toBe('');
    expect(renderToString(<PWAInstallBanner />)).not.toContain('加入主畫面');
    render(<PWAInstallBanner />);
    expect(screen.getByRole('region', { name: '加入主畫面' })).toBeTruthy();
    expect(screen.getByRole('link', { name: '查看加入方式' }).getAttribute('href')).toBe(
      '/settings?section=general',
    );
  });

  it('respects a previous dismissal while keeping the explicit settings entry usable', () => {
    browser(true);
    localStorage.setItem('pwa-install-dismissed', 'true');
    render(
      <>
        <PWAInstallBanner />
        <PWAInstallSettings />
      </>,
    );
    expect(screen.queryByRole('region', { name: '加入主畫面' })).toBeNull();
    const help = screen.getByRole('button', { name: '查看加入方式' });
    help.focus();
    fireEvent.click(help);
    expect(help.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('list').textContent).toContain('Safari');
    expect(document.activeElement).toBe(help);
    expect(localStorage.getItem('pwa-install-dismissed')).toBe('true');
    installEvent();
    expect(screen.getByRole('button', { name: '加入主畫面' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: '加入主畫面' })).toBeNull();
  });

  it('keeps dismissal through remounts even when storage is blocked', () => {
    browser(true);
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const page = render(<PWAInstallBanner />);
    fireEvent.click(screen.getByRole('button', { name: '暫時不用' }));
    page.unmount();
    render(
      <>
        <PWAInstallBanner />
        <PWAInstallSettings />
      </>,
    );
    installEvent();
    expect(screen.queryByRole('region', { name: '加入主畫面' })).toBeNull();
    expect(screen.getByRole('button', { name: '加入主畫面' })).toBeTruthy();
  });

  it('preserves an event captured on a task page for a later settings visit', async () => {
    navigation.pathname = '/classroom';
    const page = render(<PWAInstallBanner />);
    const { event, prompt } = installEvent();
    expect(event.defaultPrevented).toBe(true);
    expect(screen.queryByRole('region')).toBeNull();
    page.unmount();
    render(<PWAInstallSettings />);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '加入主畫面' })));
    expect(prompt).toHaveBeenCalledOnce();
    expect(screen.getByRole('status').textContent).toContain('已取消安裝');
  });

  it('consumes one browser event once across both entries and keeps cancellation recoverable', async () => {
    render(
      <>
        <PWAInstallBanner />
        <PWAInstallSettings />
      </>,
    );
    let finish!: (choice: { outcome: 'dismissed' }) => void;
    const choice = new Promise<{ outcome: 'dismissed' }>((resolve) => {
      finish = resolve;
    });
    const { event, prompt } = installEvent(vi.fn().mockResolvedValue(undefined), choice);
    const buttons = screen.getAllByRole('button', { name: '加入主畫面' });
    fireEvent.click(buttons[0]);
    fireEvent.click(buttons[1]);
    expect(prompt).toHaveBeenCalledOnce();
    expect(buttons.every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
    expect(buttons.every((button) => button.getAttribute('aria-busy') === 'true')).toBe(true);
    await act(async () => finish({ outcome: 'dismissed' }));
    expect(screen.queryByRole('region', { name: '加入主畫面' })).toBeNull();
    expect(screen.getByRole('button', { name: '查看加入方式' })).toBeTruthy();
    act(() => window.dispatchEvent(event));
    expect(screen.queryByRole('button', { name: '加入主畫面' })).toBeNull();
    const fresh = installEvent();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '加入主畫面' })));
    expect(fresh.prompt).toHaveBeenCalledOnce();
    expect(prompt).toHaveBeenCalledOnce();
  });

  it('keeps an in-flight install busy when navigating to settings', async () => {
    let finish!: (choice: { outcome: 'dismissed' }) => void;
    const choice = new Promise<{ outcome: 'dismissed' }>((resolve) => {
      finish = resolve;
    });
    const page = render(<PWAInstallBanner />);
    const { prompt } = installEvent(vi.fn().mockResolvedValue(undefined), choice);
    fireEvent.click(screen.getByRole('button', { name: '加入主畫面' }));
    page.unmount();
    render(<PWAInstallSettings />);
    const button = screen.getByRole('button', { name: '加入主畫面' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button);
    expect(prompt).toHaveBeenCalledOnce();
    await act(async () => finish({ outcome: 'dismissed' }));
    expect(screen.getByRole('status').textContent).toContain('已取消安裝');
  });

  it('retains the settings button and keyboard focus after a failed browser prompt', async () => {
    render(<PWAInstallSettings />);
    installEvent(vi.fn().mockRejectedValue(new Error('unsupported')));
    const button = screen.getByRole('button', { name: '加入主畫面' });
    button.focus();
    await act(async () => fireEvent.click(button));
    expect(screen.getByRole('alert').textContent).toContain('無法開啟安裝視窗');
    expect(screen.getByRole('button', { name: '查看加入方式' })).toBe(button);
    expect(document.activeElement).toBe(button);
    fireEvent.click(button);
    expect(screen.getByRole('list').textContent).toContain('書籤');
  });

  it('waits for actual installation instead of treating acceptance as completion', async () => {
    render(<PWAInstallSettings />);
    installEvent(undefined, Promise.resolve({ outcome: 'accepted' }));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '加入主畫面' })));
    expect(screen.getByRole('status').textContent).toBe('已送出安裝要求，等待瀏覽器完成安裝。');
    expect(screen.queryByRole('button', { name: '已加入主畫面' })).toBeNull();
    act(() => window.dispatchEvent(new Event('appinstalled')));
    expect(screen.getByRole('status').textContent).toBe('nuni 已加入主畫面。');
    expect(
      (screen.getByRole('button', { name: '已加入主畫面' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('ignores a late failure after the browser has already confirmed installation', async () => {
    let fail!: (reason: Error) => void;
    const prompt = vi.fn(
      () =>
        new Promise<void>((_, reject) => {
          fail = reject;
        }),
    );
    render(<PWAInstallSettings />);
    installEvent(prompt);
    fireEvent.click(screen.getByRole('button', { name: '加入主畫面' }));
    act(() => window.dispatchEvent(new Event('appinstalled')));
    await act(async () => fail(new Error('stale')));
    expect(screen.getByRole('status').textContent).toBe('nuni 已加入主畫面。');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('does not offer another install when already running from the home screen', () => {
    browser(true, true);
    render(
      <>
        <PWAInstallBanner />
        <PWAInstallSettings />
      </>,
    );
    installEvent();
    expect(screen.queryByRole('region', { name: '加入主畫面' })).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('nuni 已加入主畫面。');
    expect(screen.queryByRole('button', { name: '查看加入方式' })).toBeNull();
  });

  it('honors dismissal from another tab without disabling the settings action', () => {
    render(
      <>
        <PWAInstallBanner />
        <PWAInstallSettings />
      </>,
    );
    installEvent();
    act(() =>
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'pwa-install-dismissed',
          newValue: 'true',
        }),
      ),
    );
    expect(screen.queryByRole('region', { name: '加入主畫面' })).toBeNull();
    const settings = screen.getByRole('region', { name: '把 nuni 放在主畫面' });
    expect(within(settings).getByRole('button', { name: '加入主畫面' })).toBeTruthy();
  });

  it('offers manual help without claiming unsupported browsers can install directly', () => {
    render(<PWAInstallSettings />);
    const button = screen.getByRole('button', { name: '查看加入方式' });
    expect(screen.queryByRole('list')).toBeNull();
    fireEvent.click(button);
    expect(screen.getByRole('list').textContent).toContain('如果沒有這個選項');
    expect(button.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(button);
    expect(screen.queryByRole('list')).toBeNull();
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });
});

it('captures installation on Today before any banner or settings entry is mounted', async () => {
  const home = render(<PWAInstallObserver />);
  const { prompt } = installEvent();
  expect(home.container.textContent).toBe('');
  expect(screen.queryByRole('button')).toBeNull();
  const settings = render(<PWAInstallSettings />);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '加入主畫面' })));
  expect(prompt).toHaveBeenCalledOnce();
  expect(screen.getByRole('status').textContent).toContain('已取消安裝');
  settings.unmount();
  const fresh = installEvent();
  render(<PWAInstallSettings />);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '加入主畫面' })));
  expect(fresh.prompt).toHaveBeenCalledOnce();
});

it('opens the general settings entry with the current campus and no unrelated query', () => {
  browser(true);
  navigation.search = 'school=NTU&schoolId=ntu&campus=ntu&q=private-search&section=privacy';
  render(<PWAInstallBanner />);
  const destination = new URL(
    screen.getByRole('link', { name: '查看加入方式' }).getAttribute('href')!,
    'https://fixture.invalid',
  );
  expect(destination.pathname).toBe('/settings');
  expect(destination.searchParams.get('section')).toBe('general');
  expect(destination.searchParams.get('school')).toBe('NTU');
  expect(destination.searchParams.get('schoolId')).toBe('ntu');
  expect(destination.searchParams.get('campus')).toBe('ntu');
  expect(destination.searchParams.has('q')).toBe(false);
});

it('recognizes a change into standalone mode while the native install decision is pending', async () => {
  let changed!: (event: { matches: boolean }) => void;
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockReturnValue({
      matches: false,
      addEventListener: (_name: string, callback: typeof changed) => {
        changed = callback;
      },
      removeEventListener: vi.fn(),
    }),
  );
  let finish!: (choice: { outcome: 'dismissed' }) => void;
  const choice = new Promise<{ outcome: 'dismissed' }>((resolve) => {
    finish = resolve;
  });
  render(<PWAInstallSettings />);
  installEvent(vi.fn().mockResolvedValue(undefined), choice);
  fireEvent.click(screen.getByRole('button', { name: '加入主畫面' }));
  act(() => changed({ matches: true }));
  await act(async () => finish({ outcome: 'dismissed' }));
  expect(screen.getByRole('status').textContent).toBe('nuni 已加入主畫面。');
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByRole('button', { name: '已加入主畫面' }).getAttribute('aria-busy')).not.toBe(
    'true',
  );
});

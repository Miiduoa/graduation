import { act, fireEvent, render, screen } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PWAInstallBanner } from './PWAInstallBanner';

function browser(ios = false, standalone = false) {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(ios ? 'iPhone' : 'Chrome');
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: standalone }));
}
function installEvent(prompt = vi.fn().mockResolvedValue(undefined), outcome = 'dismissed') {
  const event = new Event('beforeinstallprompt', { cancelable: true });
  Object.assign(event, { prompt, userChoice: Promise.resolve({ outcome }) });
  act(() => {
    window.dispatchEvent(event);
  });
  return { event, prompt };
}

beforeEach(() => browser());
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('home screen installation', () => {
  it('keeps the server render independent of iOS and blocked storage', () => {
    browser(true);
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(renderToString(<PWAInstallBanner />)).toBe('');
    render(<PWAInstallBanner />);
    expect(screen.getByRole('region', { name: '加入主畫面' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '加入主畫面' })).toBeNull();
  });

  it('can dismiss with storage blocked and stays dismissed for subsequent prompt events', () => {
    browser(true);
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    render(<PWAInstallBanner />);
    fireEvent.click(screen.getByRole('button', { name: '暫時不用' }));
    installEvent();
    expect(screen.queryByRole('region', { name: '加入主畫面' })).toBeNull();
  });

  it('does not prompt when already running as an installed app', () => {
    browser(true, true);
    render(<PWAInstallBanner />);
    installEvent();
    expect(screen.queryByRole('region')).toBeNull();
  });

  it('opens one browser prompt and removes the consumed button after cancellation', async () => {
    render(<PWAInstallBanner />);
    let finish!: () => void;
    const prompt = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const { event } = installEvent(prompt);
    expect(event.defaultPrevented).toBe(true);
    const button = screen.getByRole('button', { name: '加入主畫面' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(prompt).toHaveBeenCalledTimes(1);
    await act(async () => {
      finish();
    });
    expect(screen.queryByRole('region')).toBeNull();
  });

  it('reports prompt failure without leaving a nonfunctional install button', async () => {
    render(<PWAInstallBanner />);
    installEvent(vi.fn().mockRejectedValue(new Error('unsupported')));
    fireEvent.click(screen.getByRole('button', { name: '加入主畫面' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '加入主畫面' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '暫時不用' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('hides after app installation or dismissal from another tab', () => {
    const view = render(<PWAInstallBanner />);
    installEvent();
    act(() => {
      window.dispatchEvent(new Event('appinstalled'));
    });
    expect(screen.queryByRole('region')).toBeNull();
    view.unmount();
    render(<PWAInstallBanner />);
    installEvent();
    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', { key: 'pwa-install-dismissed', newValue: 'true' }),
      );
    });
    expect(screen.queryByRole('region')).toBeNull();
  });
});

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { UpdateBanner } from './UpdateBanner';
import { activateServiceWorkerUpdate } from '@/lib/serviceWorkerUpdates';

vi.mock('@/lib/serviceWorkerUpdates', () => ({ activateServiceWorkerUpdate: vi.fn() }));
const registration = { waiting: { postMessage: vi.fn() } };
const getRegistration = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  getRegistration.mockResolvedValue(registration);
  vi.stubGlobal('navigator', { serviceWorker: { getRegistration } });
});
afterEach(() => vi.unstubAllGlobals());

it('finds an update that was waiting before this page mounted', async () => {
  render(<UpdateBanner />);
  expect(await screen.findByRole('region', { name: '版本更新' })).toBeTruthy();
  expect(activateServiceWorkerUpdate).not.toHaveBeenCalled();
});

it('does not show a first install or a failed worker lookup as an available update', async () => {
  getRegistration
    .mockResolvedValueOnce({ waiting: null })
    .mockRejectedValueOnce(new Error('offline'));
  render(<UpdateBanner />);
  await act(async () => {
    window.dispatchEvent(new Event('swUpdate'));
  });
  expect(screen.queryByRole('region')).toBeNull();
});

it('waits for activation, prevents duplicate requests, and preserves the page when activation fails', async () => {
  let reject!: (reason: unknown) => void;
  vi.mocked(activateServiceWorkerUpdate).mockImplementation(
    () =>
      new Promise((_, fail) => {
        reject = fail;
      }),
  );
  render(<UpdateBanner />);
  const button = await screen.findByRole('button', { name: '更新並重新載入' });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(activateServiceWorkerUpdate).toHaveBeenCalledTimes(1);
  expect(button.hasAttribute('disabled')).toBe(true);
  await act(async () => {
    reject(new Error('timed out'));
  });
  expect(screen.getByRole('alert').textContent).toContain('頁面已保留');
  expect(button.hasAttribute('disabled')).toBe(false);
});

it('cleans up listeners and ignores a late registration lookup after leaving the page', async () => {
  let resolve!: (value: unknown) => void;
  getRegistration.mockImplementationOnce(
    () =>
      new Promise((finish) => {
        resolve = finish;
      }),
  );
  const view = render(<UpdateBanner />);
  view.unmount();
  await act(async () => {
    resolve(registration);
    window.dispatchEvent(new Event('swUpdate'));
  });
  await waitFor(() => expect(getRegistration).toHaveBeenCalledTimes(1));
  expect(screen.queryByRole('region')).toBeNull();
});

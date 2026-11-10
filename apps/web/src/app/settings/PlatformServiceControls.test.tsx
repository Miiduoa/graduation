import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { PlatformServiceControls } from './PlatformServiceControls';

const request = vi.hoisted(() => vi.fn());
vi.mock('@/features/nuni/Session', () => ({ browserRequest: request }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it('explains that both services stay enabled without switches or save requests', () => {
  render(<PlatformServiceControls />);
  expect(screen.getByRole('heading', { name: '公開社群' })).toBeTruthy();
  expect(screen.getByRole('heading', { name: '雲端 AI 助理' })).toBeTruthy();
  expect(screen.getAllByText(/維持開啟，無法關閉/)).toHaveLength(2);
  expect(screen.queryByRole('switch')).toBeNull();
  expect(screen.queryByRole('button')).toBeNull();
  expect(request).not.toHaveBeenCalled();
});

it('ignores legacy settings and cross-tab disable notifications', () => {
  localStorage.setItem('nuni.platform.service-access-changed', 'social:legacy');
  render(<PlatformServiceControls />);
  act(() => window.dispatchEvent(new StorageEvent('storage', {
    key: 'nuni.platform.service-access-changed', newValue: 'cloudAi:legacy',
  })));
  expect(screen.getAllByText(/維持開啟，無法關閉/)).toHaveLength(2);
  expect(screen.queryByRole('switch')).toBeNull();
  expect(request).not.toHaveBeenCalled();
  localStorage.clear();
});

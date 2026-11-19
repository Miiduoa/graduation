import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { createAccountDemoPermissions, createAccountDemoState } from '@campus/shared/src/accountDemo';
import type { AccountDemoController } from './AccountDemoState';
import { AccountDemoFeature } from './AccountDemoFeature';

const state = vi.hoisted(() => ({
  pathname: '/library',
  controller: null as AccountDemoController | null,
  mutate: vi.fn(),
}));
vi.mock('next/navigation', () => ({ usePathname: () => state.pathname }));
vi.mock('./AccountDemoState', () => ({
  AccountDemoScope: ({ children }: { children: (value: AccountDemoController) => ReactNode }) =>
    state.controller ? children(state.controller) : null,
}));
vi.mock('./AccountDemoSettings', () => ({
  AccountDemoImportControl: () => <button type="button">同步我的課表與行程</button>,
}));

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
  vi.clearAllMocks();
  state.pathname = '/library';
  state.mutate.mockResolvedValue(true);
  state.controller = {
    context: 'current-session', blocked: false, busy: false, error: '', notice: '',
    mutate: state.mutate, reload: vi.fn(),
    demo: {
      accountId: 'pa_11111111-1111-4111-8111-111111111111', revision: 2,
      profile: { displayName: '展示同學', schoolId: 'pu', schoolName: '靜宜大學', studentId: 'DEMO123456', department: '資訊管理學系' },
      permissions: createAccountDemoPermissions(true), state: createAccountDemoState(),
      expiresAt: '2099-12-01T00:00:00.000Z',
    },
  };
});

it.each([
  ['/classroom', '資料庫 ER 圖作業', ['繳交作業', '完成簽到']],
  ['/grades', '資料庫作業評分', ['發布成績']],
  ['/leave', '專題成果展公假', ['送出請假']],
  ['/leave/review', '專題成果展公假審核', ['核准請假']],
  ['/library', '我的圖書與座位', ['預約座位', '續借圖書']],
  ['/dormitory', '篤行學苑 A305 報修', ['送出報修']],
  ['/community/me', '專題彩排限時動態', ['發布限時動態']],
  ['/dms', '專題小組集合提醒', ['傳送訊息']],
  ['/announcements', '專題成果展示準備會', ['發布公告']],
] as const)('shows only the corresponding records on %s', (pathname, title, buttons) => {
  state.pathname = pathname;
  render(<AccountDemoFeature />);
  expect(screen.getByRole('heading', { name: title })).toBeTruthy();
  expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual(buttons);
  expect(screen.getByRole('link', { name: '資料權限' }).getAttribute('href'))
    .toBe('/settings?section=platform&campus=pu#account-demo-permissions');
  expect(screen.getAllByRole('link').every((link) => !link.getAttribute('href')?.includes('/demo/'))).toBe(true);
});
it.each(['/timetable', '/calendar'])('offers personal import synchronization inside %s', (pathname) => {
  state.pathname = pathname;
  render(<AccountDemoFeature />);
  expect(screen.getByRole('button', { name: '同步我的課表與行程' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: '送出請假' })).toBeNull();
});
it('does not add a demo dashboard to unrelated routes or an unavailable account', () => {
  state.pathname = '/map';
  const view = render(<AccountDemoFeature />);
  expect(view.container.textContent).toBe('');
  state.pathname = '/library';
  state.controller = null;
  view.rerender(<AccountDemoFeature />);
  expect(view.container.textContent).toBe('');
});
it('requires confirmation and preserves the proposal when saving was not confirmed', async () => {
  state.mutate.mockResolvedValue(false);
  render(<AccountDemoFeature />);
  fireEvent.click(screen.getByRole('button', { name: '預約座位' }));
  expect(state.mutate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '確認並儲存' }));
  await waitFor(() => expect(state.mutate).toHaveBeenCalledWith({ action: 'reserveSeat' }));
  expect(screen.getByRole('dialog', { name: '預約座位' })).toBeTruthy();
  state.mutate.mockResolvedValue(true);
  await waitFor(() => expect((screen.getByRole('button', { name: '確認並儲存' }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: '確認並儲存' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});
it('cancels without mutating and respects feature permission revocation', () => {
  const view = render(<AccountDemoFeature />);
  fireEvent.click(screen.getByRole('button', { name: '續借圖書' }));
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  expect(state.mutate).not.toHaveBeenCalled();
  state.controller!.demo.permissions.library = false;
  view.rerender(<AccountDemoFeature />);
  expect((screen.getByRole('button', { name: '預約座位（已關閉）' }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: '續借圖書（已關閉）' }) as HTMLButtonElement).disabled).toBe(true);
});
it('enforces prerequisites and returns leave review to the normal request page', () => {
  state.pathname = '/leave/review';
  const view = render(<AccountDemoFeature />);
  expect((screen.getByRole('button', { name: '核准請假' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByRole('link', { name: '查看申請' }).getAttribute('href')).toBe('/leave?campus=pu');
  state.controller!.demo.state.requestLeave = true;
  view.rerender(<AccountDemoFeature />);
  expect((screen.getByRole('button', { name: '核准請假' }) as HTMLButtonElement).disabled).toBe(false);
  state.controller!.demo.state.approveLeave = true;
  view.rerender(<AccountDemoFeature />);
  expect((screen.getByRole('button', { name: '✓ 核准請假' }) as HTMLButtonElement).disabled).toBe(true);
});

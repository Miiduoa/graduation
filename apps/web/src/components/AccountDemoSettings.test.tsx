import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { createAccountDemoPermissions, createAccountDemoState } from '@campus/shared/src/accountDemo';
import type { AccountDemoController } from './AccountDemoState';
import { AccountDemoImportControl, AccountDemoSettings } from './AccountDemoSettings';

const harness = vi.hoisted(() => ({
  controller: null as AccountDemoController | null,
  mutate: vi.fn(), enable: vi.fn(), sync: vi.fn(), status: vi.fn(), imports: vi.fn(),
}));
vi.mock('./AccountDemoState', () => ({
  AccountDemoScope: ({ children }: { children: (value: AccountDemoController) => ReactNode }) =>
    harness.controller ? children(harness.controller) : null,
}));
vi.mock('@/lib/personalImportSync', () => ({
  setPersonalImportSyncEnabled: harness.enable,
  syncPersonalImports: harness.sync,
  getPersonalImportSyncStatus: harness.status,
}));
vi.mock('@/lib/personalImports', () => ({ readPersonalImports: harness.imports }));

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
  vi.clearAllMocks();
  harness.mutate.mockResolvedValue(true);
  harness.enable.mockResolvedValue(undefined);
  harness.sync.mockResolvedValue(undefined);
  harness.status.mockReturnValue({ phase: 'synced' });
  harness.imports.mockReturnValue([{}, {}, {}]);
  harness.controller = {
    context: 'verified-context', blocked: false, busy: false, error: '', notice: '',
    mutate: harness.mutate, reload: vi.fn(),
    demo: {
      accountId: 'pa_11111111-1111-4111-8111-111111111111', revision: 3,
      profile: { displayName: '展示同學', schoolId: 'pu', schoolName: '靜宜大學', studentId: 'DEMO123456', department: '資訊管理學系' },
      permissions: createAccountDemoPermissions(true), state: createAccountDemoState(),
      expiresAt: '2099-12-01T00:00:00.000Z',
    },
  };
});

it('places all twelve permission switches and native service links in existing settings', () => {
  render(<AccountDemoSettings />);
  const switches = screen.getAllByRole('switch');
  expect(switches).toHaveLength(12);
  expect(switches.every((element) => element.getAttribute('aria-checked') === 'true')).toBe(true);
  expect((screen.getByRole('button', { name: '全部開啟' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual([
    '/student-card?campus=pu', '/classroom?campus=pu', '/timetable?campus=pu',
    '/food?campus=pu', '/merchant/workspace?campus=pu', '/ai-assistant?campus=pu',
  ]);
});
it('changes only the selected permission and sends the complete settings value', () => {
  render(<AccountDemoSettings />);
  fireEvent.click(screen.getByRole('switch', { name: '學生證展示權限' }));
  expect(harness.mutate).toHaveBeenCalledWith({
    permissions: { ...createAccountDemoPermissions(true), studentCard: false },
  });
});
it('can enable all twelve permissions in one account-scoped mutation', () => {
  harness.controller!.demo.permissions = createAccountDemoPermissions(false);
  render(<AccountDemoSettings />);
  fireEvent.click(screen.getByRole('button', { name: '全部開啟' }));
  expect(harness.mutate).toHaveBeenCalledOnce();
  expect(harness.mutate).toHaveBeenCalledWith({ permissions: createAccountDemoPermissions(true) });
});
it('requires explicit confirmation before resetting demonstration progress', async () => {
  render(<AccountDemoSettings />);
  fireEvent.click(screen.getByRole('button', { name: '重設展示進度' }));
  expect(harness.mutate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '確認並儲存' }));
  await waitFor(() => expect(harness.mutate).toHaveBeenCalledWith({ action: 'reset' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});
it('disables permission writes and synchronization while the controller is blocked', () => {
  harness.controller!.blocked = true;
  render(<AccountDemoSettings />);
  expect(screen.getAllByRole('switch').every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
  expect((screen.getByRole('button', { name: '同步我的課表與行程' }) as HTMLButtonElement).disabled).toBe(true);
});
it('synchronizes the verified account and school and reports only confirmed local records', async () => {
  render(<AccountDemoImportControl controller={harness.controller!} />);
  fireEvent.click(screen.getByRole('button', { name: '同步我的課表與行程' }));
  await screen.findByText('已同步 3 筆課表、行程與成績資料。');
  const scope = { owner: `platform:${harness.controller!.demo.accountId}`, schoolId: 'pu' };
  expect(harness.enable).toHaveBeenCalledWith(scope, true, expect.any(Function));
  expect(harness.sync).toHaveBeenCalledWith(scope, {
    platformAccountId: harness.controller!.demo.accountId, context: 'verified-context',
  }, expect.any(Function));
  expect(harness.imports).toHaveBeenCalledWith(scope);
});
it('shows sync conflicts as a pending result rather than claiming completion', async () => {
  harness.status.mockReturnValue({ phase: 'conflict', message: '請先核對這台裝置的修改。' });
  render(<AccountDemoImportControl controller={harness.controller!} />);
  fireEvent.click(screen.getByRole('button', { name: '同步我的課表與行程' }));
  expect((await screen.findByRole('alert')).textContent).toContain('請先核對這台裝置的修改。');
  expect(harness.imports).not.toHaveBeenCalled();
  expect(screen.queryByText(/已同步 \d/)).toBeNull();
});
it('allows recovery after a failed sync without reporting a success receipt', async () => {
  harness.sync.mockRejectedValueOnce(new Error('網路暫時無法連線。'));
  render(<AccountDemoImportControl controller={harness.controller!} />);
  fireEvent.click(screen.getByRole('button', { name: '同步我的課表與行程' }));
  await screen.findByText('網路暫時無法連線。');
  expect(harness.imports).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '同步我的課表與行程' }));
  await screen.findByText('已同步 3 筆課表、行程與成績資料。');
  expect(screen.queryByRole('alert')).toBeNull();
});
it('does not synchronize when timetable access is closed', () => {
  harness.controller!.demo.permissions.timetable = false;
  render(<AccountDemoImportControl controller={harness.controller!} />);
  const button = screen.getByRole('button', { name: '同步我的課表與行程' });
  expect((button as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(button);
  expect(harness.enable).not.toHaveBeenCalled();
  expect(harness.sync).not.toHaveBeenCalled();
});
it('stops before the sync call if permission is revoked while enabling synchronization', async () => {
  let finish: () => void = () => {};
  harness.enable.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
  const original = harness.controller!;
  const view = render(<AccountDemoImportControl controller={original} />);
  fireEvent.click(screen.getByRole('button', { name: '同步我的課表與行程' }));
  const revoked = { ...original, demo: { ...original.demo, permissions: { ...original.demo.permissions, timetable: false } } };
  view.rerender(<AccountDemoImportControl controller={revoked} />);
  await act(async () => { finish(); });
  expect(harness.sync).not.toHaveBeenCalled();
  expect(harness.imports).not.toHaveBeenCalled();
  expect(screen.queryByText(/已同步 \d/)).toBeNull();
});
it('invalidates pending synchronization after leaving the feature', async () => {
  let finish: () => void = () => {};
  harness.enable.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
  const view = render(<AccountDemoImportControl controller={harness.controller!} />);
  fireEvent.click(screen.getByRole('button', { name: '同步我的課表與行程' }));
  view.unmount();
  await act(async () => { finish(); });
  expect(harness.sync).not.toHaveBeenCalled();
  expect(harness.imports).not.toHaveBeenCalled();
});

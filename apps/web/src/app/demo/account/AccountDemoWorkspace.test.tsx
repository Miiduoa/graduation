import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import {
  createAccountDemoPermissions,
  createAccountDemoState,
  type AccountDemoSnapshot,
} from '@campus/shared/src/accountDemo';
import { NuniError } from '@campus/shared/src/nuni';
import { AccountDemoWorkspace } from './AccountDemoWorkspace';
import { parseOwnedAccountDemo } from '@/lib/accountDemoClient';

const harness = vi.hoisted(() => ({
  session: {
    platformAccountId: 'pa_11111111-1111-4111-8111-111111111111',
    context: 'session-one',
  } as { platformAccountId: string; context: string } | null,
  error: '',
  refresh: vi.fn(),
  request: vi.fn(),
  enableSync: vi.fn(),
  sync: vi.fn(),
  syncStatus: vi.fn(),
  readImports: vi.fn(),
}));
vi.mock('@/features/nuni/Session', () => ({
  useOptionalNuniSession: () => ({
    session: harness.session,
    loading: false,
    pendingLogout: false,
    error: harness.error,
    refresh: harness.refresh,
  }),
  browserRequest: harness.request,
}));
vi.mock('@/components/SiteShell', () => ({
  SiteShell: ({ title, children }: { title: string; children: ReactNode }) => (
    <main>
      <h1>{title}</h1>
      {children}
    </main>
  ),
}));
vi.mock('@/lib/personalImportSync', () => ({
  setPersonalImportSyncEnabled: harness.enableSync,
  syncPersonalImports: harness.sync,
  getPersonalImportSyncStatus: harness.syncStatus,
}));
vi.mock('@/lib/personalImports', () => ({ readPersonalImports: harness.readImports }));

function fixture(): AccountDemoSnapshot {
  return {
    accountId: 'pa_11111111-1111-4111-8111-111111111111',
    revision: 3,
    profile: {
      displayName: '展示同學',
      schoolId: 'pu',
      schoolName: '靜宜大學',
      studentId: 'DEMO1150001',
      department: '資訊管理學系',
    },
    permissions: createAccountDemoPermissions(true),
    state: createAccountDemoState(),
    expiresAt: new Date(Date.now() + 86400_000).toISOString(),
  };
}
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  vi.clearAllMocks();
  harness.error = '';
  harness.refresh.mockResolvedValue(undefined);
  harness.session = { platformAccountId: fixture().accountId, context: 'session-one' };
  harness.request.mockResolvedValue({ demo: fixture() });
  harness.enableSync.mockResolvedValue(undefined);
  harness.sync.mockResolvedValue(undefined);
  harness.syncStatus.mockReturnValue({ phase: 'synced' });
  harness.readImports.mockReturnValue([{}, {}, {}]);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('account presentation workspace', () => {
  it('offers session recovery instead of loading private data when identity cannot be confirmed', async () => {
    harness.error = '目前無法確認帳號，請稍後重試。';
    render(<AccountDemoWorkspace />);
    expect(screen.getByRole('alert').textContent).toBe(harness.error);
    expect(harness.request).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '重新確認帳號' }));
    expect(harness.refresh).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: '建立訂餐' })).toBeNull();
  });
  it('asks unauthenticated visitors to sign in without reading private data', () => {
    harness.session = null;
    render(<AccountDemoWorkspace />);
    expect(screen.getByRole('link', { name: '登入 nuni' })).toBeTruthy();
    expect(harness.request).not.toHaveBeenCalled();
  });
  it('shows only the current account grant and all twelve stored feature controls', async () => {
    render(<AccountDemoWorkspace />);
    await screen.findByText('展示同學，資料已備妥');
    expect(screen.getAllByRole('switch')).toHaveLength(12);
    expect(screen.getByRole('link', { name: /開啟展示學生證/ }).getAttribute('href')).toBe(
      '/student-card?campus=pu',
    );
    expect(screen.getByRole('link', { name: /開啟助理/ }).getAttribute('href')).toBe(
      '/ai-assistant?campus=pu',
    );
    expect(harness.request).toHaveBeenCalledWith('account-demo', 'session-one');
  });
  it('does not claim an action completed until the matching server receipt returns', async () => {
    let resolveSave!: (value: unknown) => void;
    harness.request.mockImplementation((_path, _context, input) =>
      input
        ? new Promise((resolve) => {
            resolveSave = resolve;
          })
        : Promise.resolve({ demo: fixture() }),
    );
    render(<AccountDemoWorkspace />);
    await screen.findByText('展示同學，資料已備妥');
    fireEvent.click(screen.getByRole('button', { name: '建立訂餐' }));
    expect(harness.request).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '確認並儲存' }));
    expect(harness.request).toHaveBeenLastCalledWith('account-demo', 'session-one', {
      expectedRevision: 3,
      action: 'createOrder',
    });
    expect(screen.queryByText('建立訂餐：展示紀錄已儲存。')).toBeNull();
    const next = fixture();
    next.revision = 4;
    next.state.createOrder = true;
    await act(async () => resolveSave({ demo: next }));
    await screen.findByText('建立訂餐：展示紀錄已儲存。');
    expect(screen.getByRole('button', { name: '✓ 建立訂餐' }).hasAttribute('disabled')).toBe(true);
  });
  it('saves a feature switch before allowing its action state to change', async () => {
    harness.request.mockImplementation((_path, _context, input) => {
      if (!input) return Promise.resolve({ demo: fixture() });
      const next = fixture();
      next.revision = 4;
      next.permissions = input.permissions;
      return Promise.resolve({ demo: next });
    });
    render(<AccountDemoWorkspace />);
    await screen.findByText('展示同學，資料已備妥');
    fireEvent.click(screen.getByRole('switch', { name: '訂餐展示權限' }));
    await waitFor(() =>
      expect(
        screen.getByRole('switch', { name: '訂餐展示權限' }).getAttribute('aria-checked'),
      ).toBe('false'),
    );
    expect(
      screen.getByRole('button', { name: '建立訂餐（已關閉）' }).hasAttribute('disabled'),
    ).toBe(true);
  });
  it('requires a re-read after a conflicting or uncertain save and never retries a mutation', async () => {
    harness.request.mockImplementation((_path, _context, input) =>
      input
        ? Promise.reject(new NuniError(409, 'DEMO_REVISION_CHANGED'))
        : Promise.resolve({ demo: fixture() }),
    );
    render(<AccountDemoWorkspace />);
    await screen.findByText('展示同學，資料已備妥');
    fireEvent.click(screen.getByRole('switch', { name: '學生證展示權限' }));
    await screen.findByRole('alert');
    expect(harness.request).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('switch', { name: '學生證展示權限' }).hasAttribute('disabled')).toBe(
      true,
    );
    expect(
      screen.getByRole('switch', { name: '學生證展示權限' }).getAttribute('aria-checked'),
    ).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: '重新讀取' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(harness.request).toHaveBeenCalledTimes(3);
  });
  it('does not accept a newer receipt when it does not contain the requested change', async () => {
    harness.request.mockImplementation((_path, _context, input) =>
      Promise.resolve({ demo: input ? { ...fixture(), revision: 4 } : fixture() }),
    );
    render(<AccountDemoWorkspace />);
    await screen.findByText('展示同學，資料已備妥');
    fireEvent.click(screen.getByRole('switch', { name: '學生證展示權限' }));
    await screen.findByRole('alert');
    expect(screen.queryByText('展示權限已儲存。')).toBeNull();
    expect(
      screen.getByRole('switch', { name: '學生證展示權限' }).getAttribute('aria-checked'),
    ).toBe('true');
  });
  it('discards a late private response after the active account changes', async () => {
    let resolveOld!: (value: unknown) => void;
    harness.request.mockImplementation((_path, context) =>
      context === 'session-one'
        ? new Promise((resolve) => {
            resolveOld = resolve;
          })
        : Promise.resolve({ demo: null }),
    );
    const view = render(<AccountDemoWorkspace />);
    harness.session = {
      platformAccountId: 'pa_22222222-2222-4222-8222-222222222222',
      context: 'session-two',
    };
    view.rerender(<AccountDemoWorkspace />);
    await screen.findByText('此帳號尚未開通展示資料');
    await act(async () => resolveOld({ demo: fixture() }));
    expect(screen.queryByText('展示同學，資料已備妥')).toBeNull();
  });
  it('uses the current account and school for existing personal-data synchronization', async () => {
    render(<AccountDemoWorkspace />);
    await screen.findByText('展示同學，資料已備妥');
    fireEvent.click(screen.getByRole('button', { name: '同步我的課表與行程' }));
    await screen.findByText(/已載入 3 筆本人課表/);
    expect(harness.enableSync).toHaveBeenCalledWith(
      { owner: `platform:${fixture().accountId}`, schoolId: 'pu' },
      true,
      expect.any(Function),
    );
    expect(harness.sync).toHaveBeenCalledWith(
      { owner: `platform:${fixture().accountId}`, schoolId: 'pu' },
      { platformAccountId: fixture().accountId, context: 'session-one' },
      expect.any(Function),
    );
  });
  it('shows a sync conflict without claiming the cloud records were loaded', async () => {
    harness.syncStatus.mockReturnValue({
      phase: 'conflict',
      message: '請核對兩台裝置的資料差異。',
    });
    render(<AccountDemoWorkspace />);
    await screen.findByText('展示同學，資料已備妥');
    fireEvent.click(screen.getByRole('button', { name: '同步我的課表與行程' }));
    await screen.findByText('請核對兩台裝置的資料差異。');
    expect(harness.readImports).not.toHaveBeenCalled();
    expect(screen.queryByText(/已載入 3 筆/)).toBeNull();
  });
  it('invalidates sync checkpoints when the demonstration grant expires during a request', async () => {
    let finish!: () => void;
    harness.sync.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    render(<AccountDemoWorkspace />);
    await screen.findByText('展示同學，資料已備妥');
    fireEvent.click(screen.getByRole('button', { name: '同步我的課表與行程' }));
    await waitFor(() => expect(harness.sync).toHaveBeenCalledTimes(1));
    const isCurrent = harness.sync.mock.calls[0][2] as () => boolean;
    expect(isCurrent()).toBe(true);
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 2 * 86400_000);
    expect(isCurrent()).toBe(false);
    await act(async () => finish());
    expect(harness.readImports).not.toHaveBeenCalled();
    expect(screen.queryByText(/已載入 3 筆/)).toBeNull();
  });
});

it('rejects foreign, expired and malformed account-demo responses', () => {
  expect(() =>
    parseOwnedAccountDemo({ demo: fixture() }, 'pa_22222222-2222-4222-8222-222222222222'),
  ).toThrow();
  expect(
    parseOwnedAccountDemo(
      { demo: { ...fixture(), expiresAt: '2020-01-01T00:00:00.000Z' } },
      fixture().accountId,
    ),
  ).toBeNull();
  expect(() =>
    parseOwnedAccountDemo({ demo: fixture(), extra: true }, fixture().accountId),
  ).toThrow();
});

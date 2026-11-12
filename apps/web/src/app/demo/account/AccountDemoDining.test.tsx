import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyAccountDemoAction,
  createAccountDemoPermissions,
  createAccountDemoState,
  type AccountDemoMutation,
  type AccountDemoSnapshot,
} from '@campus/shared/src/accountDemo';
import { AccountDemoWorkspace } from './AccountDemoWorkspace';
import { AccountDemoDining } from './AccountDemoDining';

const harness = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('@/features/nuni/Session', () => ({
  useOptionalNuniSession: () => ({
    session: {
      platformAccountId: 'pa_11111111-1111-4111-8111-111111111111',
      context: 'dining-session',
    },
    loading: false,
    pendingLogout: false,
  }),
  browserRequest: harness.request,
}));
vi.mock('@/components/SiteShell', () => ({
  SiteShell: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
vi.mock('@/lib/personalImportSync', () => ({
  setPersonalImportSyncEnabled: vi.fn(),
  syncPersonalImports: vi.fn(),
  getPersonalImportSyncStatus: vi.fn(),
}));
vi.mock('@/lib/personalImports', () => ({ readPersonalImports: vi.fn() }));

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
  vi.clearAllMocks();
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
});
afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', window.location.pathname);
  vi.restoreAllMocks();
});

describe('account-owned student and merchant demonstration', () => {
  it('opens the linked merchant view and supports returning to the student menu anchor', () => {
    window.history.replaceState(null, '', '#merchant-demo');
    render(<AccountDemoDining demo={fixture()} blocked={false} onAction={vi.fn()} />);
    expect(screen.getByRole('button', { name: '店家接單' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(screen.getByText('目前沒有展示訂單')).toBeTruthy();
    window.history.replaceState(null, '', '#account-dining');
    fireEvent(window, new HashChangeEvent('hashchange'));
    expect(screen.getByRole('article', { name: '展示菜單' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '學生點餐' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  it('shares a confirmed order between roles and restores its receipt after reloading', async () => {
    let stored = fixture();
    harness.request.mockImplementation(
      async (_path: string, _context: string, input?: AccountDemoMutation) => {
        if (input && 'action' in input) {
          expect(input.expectedRevision).toBe(stored.revision);
          stored = {
            ...stored,
            revision: stored.revision + 1,
            state: applyAccountDemoAction(stored, input.action),
          };
        }
        return { demo: structuredClone(stored) };
      },
    );
    const view = render(<AccountDemoWorkspace />);
    await screen.findByText('展示同學，資料已備妥');
    fireEvent.click(screen.getByRole('button', { name: '店家接單' }));
    expect(screen.getByText('目前沒有展示訂單')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '標示可取餐' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '學生點餐' }));
    fireEvent.click(screen.getByRole('button', { name: '建立訂餐' }));
    fireEvent.click(screen.getByRole('button', { name: '確認並儲存' }));
    await screen.findByText('建立訂餐：展示紀錄已儲存。');
    expect(harness.request).toHaveBeenLastCalledWith('account-demo', 'dining-session', {
      expectedRevision: 3,
      action: 'createOrder',
    });
    expect(
      within(screen.getByRole('article', { name: '我的展示取餐單' })).getByText('備餐中'),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '店家接單' }));
    const merchantOrder = screen.getByRole('article', { name: '店家展示訂單' });
    expect(within(merchantOrder).getByText('展示單號 DEMO1150001-01')).toBeTruthy();
    expect(within(merchantOrder).getByText('香煎雞腿飯 × 1')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '標示可取餐' }));
    fireEvent.click(screen.getByRole('button', { name: '確認並儲存' }));
    await screen.findByText('標示可取餐：展示紀錄已儲存。');
    expect(harness.request).toHaveBeenLastCalledWith('account-demo', 'dining-session', {
      expectedRevision: 4,
      action: 'readyOrder',
    });

    fireEvent.click(screen.getByRole('button', { name: '查看學生取餐單' }));
    expect(screen.getByText('餐點準備好了')).toBeTruthy();
    view.unmount();
    render(<AccountDemoWorkspace />);
    await screen.findByText('餐點準備好了');
    expect(screen.getByText('展示單號 DEMO1150001-01')).toBeTruthy();
    expect(harness.request).toHaveBeenLastCalledWith('account-demo', 'dining-session');
  });

  it('keeps the merchant order in preparation until the exact ready receipt is confirmed', async () => {
    const stored = fixture();
    stored.state.createOrder = true;
    let finish!: (value: unknown) => void;
    harness.request.mockImplementation((_path, _context, input) =>
      input
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : Promise.resolve({ demo: stored }),
    );
    render(<AccountDemoWorkspace />);
    await screen.findByText('展示同學，資料已備妥');
    fireEvent.click(screen.getByRole('button', { name: '店家接單' }));
    fireEvent.click(screen.getByRole('button', { name: '標示可取餐' }));
    fireEvent.click(screen.getByRole('button', { name: '確認並儲存' }));
    expect(screen.queryByText('可取餐狀態已儲存，學生取餐單已同步更新。')).toBeNull();
    expect(
      within(screen.getByRole('article', { name: '店家展示訂單' })).getByText('備餐中'),
    ).toBeTruthy();
    // A newer revision alone is insufficient: it must contain the requested ready state.
    await act(async () => finish({ demo: { ...stored, revision: stored.revision + 1 } }));
    await screen.findByRole('alert');
    expect(screen.queryByText('可取餐狀態已儲存，學生取餐單已同步更新。')).toBeNull();
    expect(screen.getByRole('button', { name: '標示可取餐' }).hasAttribute('disabled')).toBe(true);
  });

  it('requires both food and administration grants for merchant updates', () => {
    const demo = fixture();
    demo.state.createOrder = true;
    demo.permissions.administration = false;
    const onAction = vi.fn();
    const view = render(<AccountDemoDining demo={demo} blocked={false} onAction={onAction} />);
    fireEvent.click(screen.getByRole('button', { name: '店家接單' }));
    fireEvent.click(screen.getByRole('button', { name: '標示可取餐（已關閉）' }));
    expect(onAction).not.toHaveBeenCalled();
    demo.permissions.administration = true;
    demo.permissions.food = false;
    view.rerender(<AccountDemoDining demo={demo} blocked={false} onAction={onAction} />);
    expect(
      screen.getByRole('button', { name: '標示可取餐（已關閉）' }).hasAttribute('disabled'),
    ).toBe(true);
    demo.permissions.food = true;
    view.rerender(<AccountDemoDining demo={demo} blocked={false} onAction={onAction} />);
    fireEvent.click(screen.getByRole('button', { name: '標示可取餐' }));
    expect(onAction).toHaveBeenCalledExactlyOnceWith('readyOrder');
  });
});

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
import { FoodWorkspace } from '@/features/food/FoodWorkspace';
import { MerchantWorkspace } from '@/features/merchant/MerchantWorkspace';
import { AccountDemoDining } from './AccountDemoDining';

const harness = vi.hoisted(() => ({
  request: vi.fn(),
  auth: {
    session: {
      platformAccountId: 'pa_11111111-1111-4111-8111-111111111111',
      context: 'dining-session',
    },
    loading: false,
    pendingLogout: false,
    error: '',
    refresh: vi.fn(),
    logout: vi.fn(),
  },
}));
vi.mock('@/features/nuni/Session', () => ({
  useNuniSession: () => harness.auth,
  useOptionalNuniSession: () => harness.auth,
  browserRequest: harness.request,
}));
vi.mock('@/lib/useCampusBrowseContext', () => ({
  useCampusBrowseContext: () => ({
    status: 'ready',
    schoolId: 'pu',
    schoolName: '靜宜大學',
    schoolSearch: '?campus=pu',
  }),
}));
vi.mock('@/components/SiteShell', () => ({
  SiteShell: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));

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
  vi.stubEnv('NEXT_PUBLIC_ONLINE_ORDERING', 'false');
  sessionStorage.clear();
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function expectNativeLinks() {
  for (const link of screen.getAllByRole('link')) {
    expect(link.getAttribute('href')).not.toContain('/demo/');
  }
}

describe('account-owned dining inside the original feature pages', () => {
  it('places, prepares and restores the same order through /food and /merchant/workspace', async () => {
    let stored = fixture();
    harness.request.mockImplementation(
      async (path: string, _context: string, input?: AccountDemoMutation) => {
        expect(path).toBe('account-demo');
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
    const emptyMerchant = render(<MerchantWorkspace view="workspace" />);
    await screen.findByText('目前沒有展示訂單');
    expect(screen.getByRole('link', { name: '前往學生點餐' }).getAttribute('href')).toBe(
      '/food?campus=pu',
    );
    expect(screen.queryByRole('button', { name: '標示可取餐' })).toBeNull();
    expectNativeLinks();
    emptyMerchant.unmount();

    const student = render(<FoodWorkspace campusSearch="campus=pu" />);
    await screen.findByRole('heading', { name: '今日菜單與取餐單' });
    expect(screen.queryByText('目前還不能線上點餐')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '建立訂餐' }));
    fireEvent.click(screen.getByRole('button', { name: '確認並儲存' }));
    await screen.findByText('建立訂餐：展示紀錄已儲存。');
    expect(
      within(screen.getByRole('article', { name: '我的展示取餐單' })).getByText('備餐中'),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: '前往店家接單' }).getAttribute('href')).toBe(
      '/merchant/workspace?campus=pu',
    );
    expectNativeLinks();
    student.unmount();

    const merchant = render(<MerchantWorkspace view="workspace" />);
    const order = await screen.findByRole('article', { name: '店家展示訂單' });
    expect(within(order).getByText('展示單號 DEMO1150001-01')).toBeTruthy();
    expect(within(order).getByText('香煎雞腿飯 × 1')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '標示可取餐' }));
    fireEvent.click(screen.getByRole('button', { name: '確認並儲存' }));
    await screen.findByText('標示可取餐：展示紀錄已儲存。');
    expect(screen.getByRole('link', { name: '查看學生取餐單' }).getAttribute('href')).toBe(
      '/food?campus=pu',
    );
    expectNativeLinks();
    merchant.unmount();

    render(<FoodWorkspace campusSearch="campus=pu" />);
    await screen.findByText('餐點準備好了');
    expect(screen.getByText('展示單號 DEMO1150001-01')).toBeTruthy();
    expect(harness.request.mock.calls.filter((call) => call[2]).map((call) => call[2])).toEqual([
      { expectedRevision: 3, action: 'createOrder' },
      { expectedRevision: 4, action: 'readyOrder' },
    ]);
  });

  it('keeps the original merchant overview linked to the existing workspace', async () => {
    harness.request.mockResolvedValue({ demo: fixture() });
    render(<MerchantWorkspace />);
    expect((await screen.findByRole('link', { name: '管理門市與訂單' })).getAttribute('href')).toBe(
      '/merchant/workspace?campus=pu',
    );
    expectNativeLinks();
  });

  it('keeps the merchant order in preparation when the returned ready receipt does not match', async () => {
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
    render(<MerchantWorkspace view="workspace" />);
    await screen.findByRole('article', { name: '店家展示訂單' });
    fireEvent.click(screen.getByRole('button', { name: '標示可取餐' }));
    fireEvent.click(screen.getByRole('button', { name: '確認並儲存' }));
    expect(screen.queryByText('可取餐狀態已儲存，學生取餐單已同步更新。')).toBeNull();
    expect(
      within(screen.getByRole('article', { name: '店家展示訂單' })).getByText('備餐中'),
    ).toBeTruthy();
    await act(async () => finish({ demo: { ...stored, revision: stored.revision + 1 } }));
    await screen.findByRole('alert');
    expect(screen.queryByText('可取餐狀態已儲存，學生取餐單已同步更新。')).toBeNull();
    expect(screen.getByRole('button', { name: '標示可取餐' }).hasAttribute('disabled')).toBe(true);
  });

  it('preserves an explicitly linked real order without replacing it with the account meal', async () => {
    harness.request.mockResolvedValue({ realms: [] });
    render(<FoodWorkspace initialTenant="real-campus" initialOrder="real-order" />);
    await screen.findByText('這個帳號目前沒有訂單紀錄。');
    expect(harness.request).toHaveBeenCalledWith(
      'food-order-realms',
      'dining-session',
      undefined,
      undefined,
      undefined,
    );
    expect(harness.request.mock.calls.some(([path]) => path === 'account-demo')).toBe(false);
    expect(screen.queryByRole('heading', { name: '今日菜單與取餐單' })).toBeNull();
  });

  it('requires both food and administration grants for merchant updates', () => {
    const demo = fixture();
    demo.state.createOrder = true;
    demo.permissions.administration = false;
    const onAction = vi.fn();
    const view = render(
      <AccountDemoDining demo={demo} blocked={false} onAction={onAction} view="merchant" />,
    );
    fireEvent.click(screen.getByRole('button', { name: '標示可取餐（已關閉）' }));
    expect(onAction).not.toHaveBeenCalled();
    demo.permissions.administration = true;
    demo.permissions.food = false;
    view.rerender(
      <AccountDemoDining demo={demo} blocked={false} onAction={onAction} view="merchant" />,
    );
    expect(
      screen.getByRole('button', { name: '標示可取餐（已關閉）' }).hasAttribute('disabled'),
    ).toBe(true);
    demo.permissions.food = true;
    view.rerender(
      <AccountDemoDining demo={demo} blocked={false} onAction={onAction} view="merchant" />,
    );
    fireEvent.click(screen.getByRole('button', { name: '標示可取餐' }));
    expect(onAction).toHaveBeenCalledExactlyOnceWith('readyOrder');
  });
});

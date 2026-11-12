import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  createAccountDemoPermissions,
  createAccountDemoState,
  type AccountDemoSnapshot,
} from '@campus/shared/src/accountDemo';
import { AccountDemoEntry } from './AccountDemoEntry';

const harness = vi.hoisted(() => ({
  session: {
    platformAccountId: 'pa_11111111-1111-4111-8111-111111111111',
    context: 'account-one',
  } as { platformAccountId: string; context: string } | null,
  request: vi.fn(),
}));
vi.mock('@/features/nuni/Session', () => ({
  useNuniSession: () => ({
    session: harness.session,
    loading: false,
    pendingLogout: false,
    error: '',
  }),
  browserRequest: harness.request,
}));

function fixture(): AccountDemoSnapshot {
  return {
    accountId: 'pa_11111111-1111-4111-8111-111111111111',
    revision: 0,
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
  harness.session = { platformAccountId: fixture().accountId, context: 'account-one' };
});
afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', window.location.pathname);
});

it.each([
  ['account', '開啟我的展示工作區', '/demo/account?campus=pu'],
  ['merchant', '開啟我的店家展示', '/demo/account?campus=pu#merchant-demo'],
  ['food', '開啟我的點餐展示', '/demo/account?campus=pu#account-dining'],
] as const)(
  'shows the %s entry only after receiving the current account grant',
  async (destination, label, href) => {
    let finish!: (value: unknown) => void;
    harness.request.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    render(<AccountDemoEntry destination={destination} />);
    expect(screen.queryByRole('link')).toBeNull();
    await act(async () => finish({ demo: fixture() }));
    expect(screen.getByRole('link', { name: label }).getAttribute('href')).toBe(href);
    expect(harness.request).toHaveBeenCalledExactlyOnceWith('account-demo', 'account-one');
  },
);

it('uses the school from the verified grant instead of the current page selection', async () => {
  window.history.replaceState(null, '', '?campus=ntu');
  const demo = fixture();
  demo.profile.schoolId = 'demo-campus';
  harness.request.mockResolvedValue({ demo });
  render(<AccountDemoEntry destination="merchant" />);
  expect((await screen.findByRole('link', { name: '開啟我的店家展示' })).getAttribute('href')).toBe(
    '/demo/account?campus=demo-campus#merchant-demo',
  );
});

it.each([
  ['merchant', false, true, '「訂餐」'],
  ['merchant', true, false, '「管理展示」'],
  ['merchant', false, false, '「訂餐」與「管理展示」'],
  ['food', false, true, '「訂餐」'],
  ['food', true, false, '「管理展示」'],
  ['food', false, false, '「訂餐」與「管理展示」'],
] as const)(
  'keeps the %s entry and names disabled permissions (food=%s, administration=%s)',
  async (destination, food, administration, missing) => {
    const demo = fixture();
    demo.permissions.food = food;
    demo.permissions.administration = administration;
    harness.request.mockResolvedValue({ demo });
    render(<AccountDemoEntry destination={destination} />);
    expect(
      await screen.findByText(
        `展示資料已備妥；請先在展示權限開啟${missing}，再完成學生訂餐與店家備餐流程。`,
      ),
    ).toBeTruthy();
    expect(screen.getByRole('link').getAttribute('href')).toBe(
      `/demo/account?campus=pu#${destination === 'merchant' ? 'merchant-demo' : 'account-dining'}`,
    );
    expect(screen.queryByText(/都能接著操作/)).toBeNull();
  },
);

it('does not expose a previous account grant after an account switch', async () => {
  let finishOld!: (value: unknown) => void;
  harness.request.mockImplementation((_path, context) =>
    context === 'account-one'
      ? new Promise((resolve) => {
          finishOld = resolve;
        })
      : Promise.resolve({ demo: null }),
  );
  const view = render(<AccountDemoEntry destination="merchant" />);
  harness.session = {
    platformAccountId: 'pa_22222222-2222-4222-8222-222222222222',
    context: 'account-two',
  };
  view.rerender(<AccountDemoEntry destination="merchant" />);
  await act(async () => finishOld({ demo: fixture() }));
  expect(screen.queryByRole('link')).toBeNull();
  expect(harness.request).toHaveBeenLastCalledWith('account-demo', 'account-two');
});

it('does not read demonstration data when signed out', () => {
  harness.session = null;
  render(<AccountDemoEntry destination="merchant" />);
  expect(screen.queryByRole('link')).toBeNull();
  expect(harness.request).not.toHaveBeenCalled();
});

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createAccountDemoPermissions,
  createAccountDemoState,
  type AccountDemoSnapshot,
} from '@campus/shared/src/accountDemo';
import { NuniError } from '@campus/shared/src/nuni';
import type { CampusBrowseContext } from '@/lib/useCampusBrowseContext';
import { AccountDemoScope, type AccountDemoController } from './AccountDemoState';

const harness = vi.hoisted(() => ({
  auth: {
    session: { platformAccountId: 'pa_11111111-1111-4111-8111-111111111111', context: 'session-one' } as {
      platformAccountId: string; context: string;
    } | null,
    loading: false,
    pendingLogout: false,
    error: '',
  },
  campus: { status: 'ready', schoolId: 'pu', schoolName: '靜宜大學', schoolSearch: '?campus=pu' } as CampusBrowseContext,
  request: vi.fn(),
}));
vi.mock('@/features/nuni/Session', () => ({
  useOptionalNuniSession: () => harness.auth,
  browserRequest: harness.request,
}));
vi.mock('@/lib/useCampusBrowseContext', () => ({ useCampusBrowseContext: () => harness.campus }));

const OTHER_ACCOUNT = 'pa_22222222-2222-4222-8222-222222222222';
let controller: AccountDemoController | null;

function fixture(): AccountDemoSnapshot {
  return {
    accountId: 'pa_11111111-1111-4111-8111-111111111111',
    revision: 7,
    profile: {
      displayName: '測試同學', schoolId: 'pu', schoolName: '靜宜大學',
      studentId: 'DEMO1150001', department: '資訊管理學系',
    },
    permissions: createAccountDemoPermissions(true),
    state: createAccountDemoState(),
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  };
}

function deferred<T = unknown>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function Probe({ fallback = true, campusScoped = true }: { fallback?: boolean; campusScoped?: boolean }) {
  return <AccountDemoScope campusScoped={campusScoped} fallback={fallback ? <p>一般功能</p> : null}>
    {(value) => <ProbeContent value={value} />}
  </AccountDemoScope>;
}

function ProbeContent({ value }: { value: AccountDemoController }) {
  useEffect(() => { controller = value; }, [value]);
  return <section data-testid="account-data">
      <p>{value.demo.profile.displayName}</p>
      <output data-testid="revision">{value.demo.revision}</output>
      <output data-testid="order">{String(value.demo.state.createOrder)}</output>
      <output data-testid="food-permission">{String(value.demo.permissions.food)}</output>
      <button type="button" disabled={value.blocked} onClick={() => void value.mutate({ action: 'createOrder' })}>儲存訂餐紀錄</button>
      <button type="button" onClick={() => void value.reload()}>讀取最新資料</button>
  </section>;
}

function current() {
  if (!controller) throw new Error('No account controller rendered');
  return controller;
}

async function load(snapshot = fixture()) {
  harness.request.mockResolvedValue({ demo: snapshot });
  const view = render(<Probe />);
  await screen.findByTestId('account-data');
  return view;
}

beforeEach(() => {
  vi.resetAllMocks();
  controller = null;
  harness.auth = {
    session: { platformAccountId: fixture().accountId, context: 'session-one' },
    loading: false, pendingLogout: false, error: '',
  };
  harness.campus = { status: 'ready', schoolId: 'pu', schoolName: '靜宜大學', schoolSearch: '?campus=pu' };
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('account data identity and lifetime', () => {
  it.each(['signed-out', 'auth-loading', 'logout', 'auth-error', 'campus-loading', 'campus-error', 'campus-unselected'])(
    'does not read account data while %s', (state) => {
      if (state === 'signed-out') harness.auth.session = null;
      if (state === 'auth-loading') harness.auth.loading = true;
      if (state === 'logout') harness.auth.pendingLogout = true;
      if (state === 'auth-error') harness.auth.error = 'Session cannot be verified';
      if (state === 'campus-loading') harness.campus.status = 'loading';
      if (state === 'campus-error') harness.campus.status = 'error';
      if (state === 'campus-unselected') {
        harness.campus.status = 'unselected';
        harness.campus.schoolId = null;
      }
      render(<Probe />);
      expect(harness.request).not.toHaveBeenCalled();
      expect(screen.queryByTestId('account-data')).toBeNull();
    },
  );

  it('renders no private state until a current-account read completes', async () => {
    const pending = deferred();
    harness.request.mockReturnValue(pending.promise);
    render(<Probe />);
    expect(screen.queryByTestId('account-data')).toBeNull();
    expect(harness.request).toHaveBeenCalledExactlyOnceWith('account-demo', 'session-one');
    await act(async () => pending.resolve({ demo: fixture() }));
    expect(screen.getByText('測試同學')).toBeTruthy();
  });

  it.each(['no-grant', 'foreign-account', 'other-school', 'expired', 'malformed'])(
    'keeps the normal feature fallback for %s data', async (state) => {
      const snapshot = fixture();
      if (state === 'foreign-account') snapshot.accountId = OTHER_ACCOUNT;
      if (state === 'other-school') snapshot.profile.schoolId = 'ntu';
      if (state === 'expired') snapshot.expiresAt = new Date(Date.now() - 1).toISOString();
      harness.request.mockResolvedValue(state === 'malformed' ? { demo: snapshot, extra: true } : { demo: state === 'no-grant' ? null : snapshot });
      render(<Probe />);
      await screen.findByText('一般功能');
      expect(screen.queryByTestId('account-data')).toBeNull();
    },
  );

  it('accepts the canonical and internal aliases of the same school', async () => {
    const snapshot = fixture();
    snapshot.profile.schoolId = 'tw-pu';
    await load(snapshot);
    expect(screen.getByText('測試同學')).toBeTruthy();
  });

  it('allows account-level settings without requiring a selected or available campus', async () => {
    harness.campus = { status: 'unselected', schoolId: null, schoolName: '', schoolSearch: '?campus=all' };
    harness.request.mockResolvedValue({ demo: fixture() });
    const view = render(<Probe campusScoped={false} />);
    await screen.findByText('測試同學');
    harness.campus = { ...harness.campus, status: 'loading' };
    view.rerender(<Probe campusScoped={false} />);
    expect(screen.getByTestId('account-data')).toBeTruthy();
    harness.campus = { ...harness.campus, status: 'error' };
    view.rerender(<Probe campusScoped={false} />);
    expect(screen.getByTestId('account-data')).toBeTruthy();
    expect(harness.request).toHaveBeenCalledExactlyOnceWith('account-demo', 'session-one');
  });

  it('keeps account-level settings scoped to identity across browsing-campus changes', async () => {
    harness.campus = { ...harness.campus, schoolId: 'ntu' };
    harness.request.mockResolvedValue({ demo: fixture() });
    const view = render(<Probe campusScoped={false} />);
    await screen.findByText('測試同學');
    harness.campus = { ...harness.campus, schoolId: 'nthu' };
    view.rerender(<Probe campusScoped={false} />);
    expect(screen.getByTestId('account-data')).toBeTruthy();
    expect(harness.request).toHaveBeenCalledTimes(1);
    harness.request.mockResolvedValue({ demo: null });
    harness.auth.session = { platformAccountId: OTHER_ACCOUNT, context: 'session-two' };
    view.rerender(<Probe campusScoped={false} />);
    await screen.findByText('一般功能');
    expect(screen.queryByTestId('account-data')).toBeNull();
    expect(harness.request).toHaveBeenLastCalledWith('account-demo', 'session-two');
  });

  it.each(['account', 'context', 'campus', 'logout'])(
    'discards a late private read after the active %s changes', async (changed) => {
      const oldRead = deferred();
      harness.request.mockReturnValueOnce(oldRead.promise).mockResolvedValue({ demo: null });
      const view = render(<Probe />);
      if (changed === 'account') harness.auth.session = { platformAccountId: OTHER_ACCOUNT, context: 'session-two' };
      if (changed === 'context') harness.auth.session = { ...harness.auth.session!, context: 'session-two' };
      if (changed === 'campus') harness.campus = { ...harness.campus, schoolId: 'ntu' };
      if (changed === 'logout') harness.auth.session = null;
      view.rerender(<Probe />);
      await act(async () => oldRead.resolve({ demo: fixture() }));
      expect(screen.queryByTestId('account-data')).toBeNull();
      expect(screen.getByText('一般功能')).toBeTruthy();
      expect(harness.request).toHaveBeenCalledTimes(changed === 'logout' ? 1 : 2);
    },
  );

  it('removes loaded private state immediately when logout starts', async () => {
    const view = await load();
    harness.auth.pendingLogout = true;
    view.rerender(<Probe fallback={false} />);
    expect(screen.queryByTestId('account-data')).toBeNull();
    expect(screen.queryByText('測試同學')).toBeNull();
    expect(harness.request).toHaveBeenCalledTimes(1);
  });

  it.each(['account', 'context', 'campus', 'logout'])(
    'refuses a retained write callback after the active %s changes', async (changed) => {
      const view = await load();
      const oldController = current();
      harness.request.mockResolvedValue({ demo: null });
      if (changed === 'account') harness.auth.session = { platformAccountId: OTHER_ACCOUNT, context: 'session-two' };
      if (changed === 'context') harness.auth.session = { ...harness.auth.session!, context: 'session-two' };
      if (changed === 'campus') harness.campus = { ...harness.campus, schoolId: 'ntu' };
      if (changed === 'logout') harness.auth.session = null;
      view.rerender(<Probe />);
      await act(async () => {});
      const requestCount = harness.request.mock.calls.length;
      expect(await oldController.mutate({ action: 'createOrder' })).toBe(false);
      expect(harness.request).toHaveBeenCalledTimes(requestCount);
      expect(harness.request.mock.calls.some((call) => call[2])).toBe(false);
    },
  );

  it('expires a grant while idle and refuses a retained action callback', async () => {
    vi.useFakeTimers();
    const snapshot = fixture();
    snapshot.expiresAt = new Date(Date.now() + 1000).toISOString();
    harness.request.mockResolvedValue({ demo: snapshot });
    render(<Probe />);
    await act(async () => {});
    const oldController = current();
    await act(async () => vi.advanceTimersByTime(1001));
    expect(screen.queryByTestId('account-data')).toBeNull();
    expect(await oldController.mutate({ action: 'createOrder' })).toBe(false);
    expect(harness.request).toHaveBeenCalledTimes(1);
  });
});

describe('account data writes and authoritative receipts', () => {
  it('returns success only after a CAS receipt and a separate matching server read', async () => {
    const original = fixture();
    await load(original);
    const receipt = deferred();
    const verification = deferred();
    harness.request.mockReturnValueOnce(receipt.promise).mockReturnValueOnce(verification.promise);
    let operation!: Promise<boolean>;
    act(() => { operation = current().mutate({ action: 'createOrder' }); });
    expect(harness.request).toHaveBeenLastCalledWith('account-demo', 'session-one', { expectedRevision: 7, action: 'createOrder' });
    expect(screen.getByTestId('order').textContent).toBe('false');
    expect(current().busy).toBe(true);
    const next = { ...original, revision: 8, state: { ...original.state, createOrder: true } };
    let returned = false;
    void operation.then(() => { returned = true; });
    await act(async () => receipt.resolve({ demo: next }));
    expect(returned).toBe(false);
    expect(screen.queryByText(/展示紀錄已儲存/)).toBeNull();
    expect(screen.getByTestId('order').textContent).toBe('false');
    expect(harness.request).toHaveBeenLastCalledWith('account-demo', 'session-one');
    await act(async () => verification.resolve({ demo: next }));
    expect(await operation).toBe(true);
    expect(screen.getByTestId('order').textContent).toBe('true');
    expect(screen.getByTestId('revision').textContent).toBe('8');
    expect(screen.getByText(/建立訂餐：展示紀錄已儲存/)).toBeTruthy();
  });

  it('prevents two writes fired before React can rerender', async () => {
    const original = fixture();
    await load(original);
    const pending = deferred();
    const next = { ...original, revision: 8, state: { ...original.state, createOrder: true } };
    harness.request.mockReturnValueOnce(pending.promise).mockResolvedValue({ demo: next });
    const oldController = current();
    let first!: Promise<boolean>;
    let second!: Promise<boolean>;
    act(() => {
      first = oldController.mutate({ action: 'createOrder' });
      second = oldController.mutate({ action: 'createOrder' });
    });
    expect(await second).toBe(false);
    expect(harness.request).toHaveBeenCalledTimes(2);
    await act(async () => pending.resolve({ demo: next }));
    expect(await first).toBe(true);
    expect(harness.request.mock.calls.filter((call) => call[2])).toHaveLength(1);
  });

  it('does not send a disabled action even if its callback is invoked directly', async () => {
    const snapshot = fixture();
    snapshot.permissions.food = false;
    await load(snapshot);
    let result!: boolean;
    await act(async () => { result = await current().mutate({ action: 'createOrder' }); });
    expect(result).toBe(false);
    expect(harness.request).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('order').textContent).toBe('false');
    expect(screen.queryByText(/展示紀錄已儲存/)).toBeNull();
  });

  it('saves permission changes only after readback and honors the new disabled permission', async () => {
    const original = fixture();
    await load(original);
    const permissions = { ...original.permissions, food: false };
    const next = { ...original, revision: 8, permissions };
    harness.request.mockResolvedValue({ demo: next });
    let result!: boolean;
    await act(async () => { result = await current().mutate({ permissions }); });
    expect(result).toBe(true);
    expect(harness.request).toHaveBeenNthCalledWith(2, 'account-demo', 'session-one', { expectedRevision: 7, permissions });
    expect(harness.request).toHaveBeenNthCalledWith(3, 'account-demo', 'session-one');
    expect(screen.getByTestId('food-permission').textContent).toBe('false');
    await act(async () => { result = await current().mutate({ action: 'createOrder' }); });
    expect(result).toBe(false);
    expect(harness.request).toHaveBeenCalledTimes(3);
  });

  it.each(['wrong-revision', 'unchanged-state', 'changed-permission', 'changed-profile', 'extended-expiry', 'foreign-account'])(
    'rejects a %s receipt without announcing success or reading it back as accepted', async (kind) => {
      const original = fixture();
      await load(original);
      const next = structuredClone(original);
      next.revision = 8;
      next.state.createOrder = true;
      if (kind === 'wrong-revision') next.revision = 9;
      if (kind === 'unchanged-state') next.state.createOrder = false;
      if (kind === 'changed-permission') next.permissions.food = false;
      if (kind === 'changed-profile') next.profile.displayName = 'Other name';
      if (kind === 'extended-expiry') next.expiresAt = new Date(Date.parse(original.expiresAt) + 1000).toISOString();
      if (kind === 'foreign-account') next.accountId = OTHER_ACCOUNT;
      harness.request.mockResolvedValue({ demo: next });
      let result!: boolean;
      await act(async () => { result = await current().mutate({ action: 'createOrder' }); });
      expect(result).toBe(false);
      expect(harness.request).toHaveBeenCalledTimes(2);
      expect(screen.getByRole('alert')).toBeTruthy();
      expect(current().blocked).toBe(true);
      expect(screen.getByTestId('order').textContent).toBe('false');
      expect(screen.queryByText(/展示紀錄已儲存/)).toBeNull();
    },
  );

  it.each(['changed', 'revoked', 'offline'])(
    'withholds success when the independent readback is %s', async (kind) => {
      const original = fixture();
      await load(original);
      const next = { ...original, revision: 8, state: { ...original.state, createOrder: true } };
      harness.request.mockResolvedValueOnce({ demo: next });
      if (kind === 'offline') harness.request.mockRejectedValueOnce(new Error('Network unavailable'));
      else harness.request.mockResolvedValueOnce({ demo: kind === 'revoked' ? null : { ...next, revision: 9, permissions: { ...next.permissions, food: false } } });
      let result!: boolean;
      await act(async () => { result = await current().mutate({ action: 'createOrder' }); });
      expect(result).toBe(false);
      expect(harness.request).toHaveBeenCalledTimes(3);
      expect(screen.queryByText(/展示紀錄已儲存/)).toBeNull();
      expect(current().blocked).toBe(true);
      await act(async () => { result = await current().mutate({ action: 'createOrder' }); });
      expect(result).toBe(false);
      expect(harness.request).toHaveBeenCalledTimes(3);
    },
  );

  it('blocks a conflict until an explicit reread and never retries the write automatically', async () => {
    const original = fixture();
    await load(original);
    harness.request.mockRejectedValueOnce(new NuniError(409, 'DEMO_REVISION_CHANGED'));
    let result!: boolean;
    await act(async () => { result = await current().mutate({ action: 'createOrder' }); });
    expect(result).toBe(false);
    expect(screen.getByRole('alert').textContent).toContain('資料已在其他畫面更新');
    await act(async () => { result = await current().mutate({ action: 'createOrder' }); });
    expect(result).toBe(false);
    expect(harness.request).toHaveBeenCalledTimes(2);
    const changed = { ...original, revision: 8, permissions: { ...original.permissions, food: false } };
    harness.request.mockResolvedValueOnce({ demo: changed });
    fireEvent.click(screen.getByRole('button', { name: '重新讀取帳號資料' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(screen.getByTestId('revision').textContent).toBe('8');
    expect(screen.getByTestId('food-permission').textContent).toBe('false');
    expect(harness.request).toHaveBeenCalledTimes(3);
  });

  it.each([401, 403])('removes private controls on server permission failure %s', async (status) => {
    await load();
    harness.request.mockRejectedValueOnce(new NuniError(status, 'SESSION_OR_GRANT_REVOKED'));
    let result!: boolean;
    await act(async () => { result = await current().mutate({ action: 'createOrder' }); });
    expect(result).toBe(false);
    expect(screen.queryByTestId('account-data')).toBeNull();
    expect(screen.getByText('一般功能')).toBeTruthy();
    expect(screen.getByRole('alert')).toBeTruthy();
  });
});

describe('overlapping reads and writes', () => {
  it('keeps a newer revocation when an earlier focus refresh finishes late', async () => {
    const original = fixture();
    await load(original);
    const oldRefresh = deferred();
    const latestRefresh = deferred();
    harness.request.mockReturnValueOnce(oldRefresh.promise).mockReturnValueOnce(latestRefresh.promise);
    fireEvent.focus(window);
    fireEvent.focus(window);
    await act(async () => latestRefresh.resolve({ demo: null }));
    await act(async () => oldRefresh.resolve({ demo: original }));
    expect(screen.queryByTestId('account-data')).toBeNull();
    expect(screen.getByText('一般功能')).toBeTruthy();
  });

  it.each(['account', 'campus', 'logout'])(
    'ignores an old write receipt after %s changes, including its success notice', async (changed) => {
      const original = fixture();
      const view = await load(original);
      const receipt = deferred();
      harness.request.mockReturnValueOnce(receipt.promise).mockResolvedValue({ demo: null });
      let operation!: Promise<boolean>;
      act(() => { operation = current().mutate({ action: 'createOrder' }); });
      if (changed === 'account') harness.auth.session = { platformAccountId: OTHER_ACCOUNT, context: 'session-two' };
      if (changed === 'campus') harness.campus = { ...harness.campus, schoolId: 'ntu' };
      if (changed === 'logout') harness.auth.session = null;
      view.rerender(<Probe />);
      await act(async () => receipt.resolve({ demo: { ...original, revision: 8, state: { ...original.state, createOrder: true } } }));
      expect(await operation).toBe(false);
      expect(screen.queryByTestId('account-data')).toBeNull();
      expect(screen.queryByText(/展示紀錄已儲存/)).toBeNull();
      expect(harness.request).toHaveBeenCalledTimes(changed === 'logout' ? 2 : 3);
    },
  );

  it('does not restore an expired grant from an in-flight write receipt', async () => {
    vi.useFakeTimers();
    const original = fixture();
    original.expiresAt = new Date(Date.now() + 1000).toISOString();
    harness.request.mockResolvedValue({ demo: original });
    render(<Probe />);
    await act(async () => {});
    const receipt = deferred();
    harness.request.mockReturnValueOnce(receipt.promise);
    let operation!: Promise<boolean>;
    act(() => { operation = current().mutate({ action: 'createOrder' }); });
    await act(async () => vi.advanceTimersByTime(1001));
    await act(async () => receipt.resolve({ demo: { ...original, revision: 8, state: { ...original.state, createOrder: true } } }));
    expect(await operation).toBe(false);
    expect(screen.queryByTestId('account-data')).toBeNull();
    expect(screen.queryByText(/展示紀錄已儲存/)).toBeNull();
    expect(harness.request).toHaveBeenCalledTimes(2);
  });

  it('preserves a newer permission read when a stale mutation receipt arrives afterward', async () => {
    const original = fixture();
    await load(original);
    const receipt = deferred();
    const revoked = { ...original, revision: 9, permissions: { ...original.permissions, food: false } };
    harness.request.mockReturnValueOnce(receipt.promise).mockResolvedValueOnce({ demo: revoked });
    let operation!: Promise<boolean>;
    act(() => { operation = current().mutate({ action: 'createOrder' }); });
    fireEvent.focus(window);
    await screen.findByTestId('account-data');
    expect(screen.getByTestId('food-permission').textContent).toBe('false');
    await act(async () => receipt.resolve({ demo: { ...original, revision: 8, state: { ...original.state, createOrder: true } } }));
    expect(await operation).toBe(false);
    expect(screen.getByTestId('revision').textContent).toBe('9');
    expect(screen.getByTestId('food-permission').textContent).toBe('false');
    expect(screen.getByTestId('order').textContent).toBe('false');
    expect(screen.queryByText(/展示紀錄已儲存/)).toBeNull();
    expect(harness.request).toHaveBeenCalledTimes(3);
  });
});

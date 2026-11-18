import { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { NuniError } from '@campus/shared/src/nuni';
import type { PlatformAssistantPermissionState } from '@campus/shared/src/platformAssistantPermissions';
import { PlatformAssistantPermissions } from './PlatformAssistantPermissions';

const A = 'pa_11111111-1111-4111-8111-111111111111';
const B = 'pa_22222222-2222-4222-8222-222222222222';
const state = vi.hoisted(() => ({
  request: vi.fn(),
  auth: {
    session: null as { platformAccountId: string; context: string } | null,
    loading: false,
    error: '',
    pendingLogout: false,
    refresh: vi.fn(),
    logout: vi.fn(),
  },
}));
vi.mock('@/features/nuni/Session', () => ({
  useNuniSession: () => state.auth,
  browserRequest: state.request,
}));

function record(accountId = A, revision = 0): PlatformAssistantPermissionState {
  return {
    scope: 'platform-account',
    accountId,
    revision,
    permissions: { createPersonalEvent: false, prepareFoodOrder: false },
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const calendar = () => screen.getByRole('switch', { name: '新增個人行程' }) as HTMLButtonElement;
const food = () => screen.getByRole('switch', { name: '整理訂餐草稿' }) as HTMLButtonElement;
const save = () => screen.getByRole('button', { name: '儲存 AI 代辦權限' }) as HTMLButtonElement;
async function ready() {
  await waitFor(() => expect(calendar().disabled).toBe(false));
}

beforeEach(() => {
  vi.resetAllMocks();
  state.auth.session = { platformAccountId: A, context: 'context-a' };
  state.auth.loading = false;
  state.auth.error = '';
  state.auth.pendingLogout = false;
  state.request.mockResolvedValue(record());
});

it('lets a Google-only account save independent permissions and reads them after remount', async () => {
  let stored = record();
  state.request.mockImplementation(
    async (
      _path: string,
      _context: string,
      input?: { permissions: PlatformAssistantPermissionState['permissions'] },
    ) => {
      if (input)
        stored = { ...stored, revision: stored.revision + 1, permissions: input.permissions };
      return structuredClone(stored);
    },
  );
  const view = render(<PlatformAssistantPermissions />);
  await ready();
  expect(calendar().getAttribute('aria-checked')).toBe('false');
  expect(food().getAttribute('aria-checked')).toBe('false');
  expect(save().disabled).toBe(true);
  fireEvent.click(calendar());
  fireEvent.click(save());
  await screen.findByText('AI 代辦權限已儲存。');
  expect(state.request).toHaveBeenLastCalledWith('assistant-permissions', 'context-a', {
    expectedRevision: 0,
    permissions: { createPersonalEvent: true, prepareFoodOrder: false },
  });
  view.unmount();
  render(<PlatformAssistantPermissions />);
  await ready();
  expect(calendar().getAttribute('aria-checked')).toBe('true');
  fireEvent.click(calendar());
  fireEvent.click(food());
  fireEvent.click(save());
  await screen.findByText('AI 代辦權限已儲存。');
  expect(stored.permissions).toEqual({ createPersonalEvent: false, prepareFoodOrder: true });
});

it('cannot save before an authoritative read and allows an explicit retry after failure', async () => {
  const pending = deferred<unknown>();
  state.request.mockReturnValueOnce(pending.promise);
  render(<PlatformAssistantPermissions />);
  expect(calendar().disabled).toBe(true);
  expect(save().disabled).toBe(true);
  await act(async () => pending.reject(new Error('offline')));
  expect(screen.getByRole('alert').textContent).toContain('暫時無法讀取');
  expect(calendar().disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '重新讀取權限' }));
  await ready();
});

it('discards an old account read immediately when another Google account becomes active', async () => {
  const old = deferred<unknown>();
  state.request.mockReturnValueOnce(old.promise).mockResolvedValue(record(B));
  const view = render(<PlatformAssistantPermissions />);
  await waitFor(() =>
    expect(state.request).toHaveBeenCalledWith('assistant-permissions', 'context-a'),
  );
  state.auth.session = { platformAccountId: B, context: 'context-b' };
  view.rerender(<PlatformAssistantPermissions />);
  await ready();
  await act(async () =>
    old.resolve({
      ...record(A, 2),
      permissions: { createPersonalEvent: true, prepareFoodOrder: true },
    }),
  );
  expect(calendar().getAttribute('aria-checked')).toBe('false');
  expect(food().getAttribute('aria-checked')).toBe('false');
  expect(state.request).toHaveBeenLastCalledWith('assistant-permissions', 'context-b');
});

it('skips a queued read when the account changes before it starts', async () => {
  state.request.mockImplementation(async (_path: string, context: string) =>
    record(context === 'context-b' ? B : A),
  );
  const view = render(<PlatformAssistantPermissions />);
  state.auth.session = { platformAccountId: B, context: 'context-b' };
  view.rerender(<PlatformAssistantPermissions />);
  await ready();
  expect(state.request).toHaveBeenCalledTimes(1);
  expect(state.request).toHaveBeenCalledWith('assistant-permissions', 'context-b');
});

it('rejects permission responses belonging to another account', async () => {
  state.request.mockResolvedValue(record(B));
  render(<PlatformAssistantPermissions />);
  await screen.findByRole('alert');
  expect(calendar().disabled).toBe(true);
  expect(save().disabled).toBe(true);
});

it('does not announce or broadcast an old save after the account changes', async () => {
  const pending = deferred<unknown>();
  state.request
    .mockResolvedValueOnce(record())
    .mockReturnValueOnce(pending.promise)
    .mockResolvedValue(record(B));
  const view = render(<PlatformAssistantPermissions />);
  await ready();
  fireEvent.click(calendar());
  fireEvent.click(save());
  state.auth.session = { platformAccountId: B, context: 'context-b' };
  view.rerender(<PlatformAssistantPermissions />);
  await ready();
  await act(async () =>
    pending.resolve({
      ...record(A, 1),
      permissions: { createPersonalEvent: true, prepareFoodOrder: false },
    }),
  );
  expect(screen.queryByText('AI 代辦權限已儲存。')).toBeNull();
  expect(calendar().getAttribute('aria-checked')).toBe('false');
  expect(localStorage.getItem('nuni.platform.assistant-permissions-changed')).toBeNull();
});

it('sends only one mutation while saving and waits for a matching persisted receipt', async () => {
  const pending = deferred<unknown>();
  state.request.mockResolvedValueOnce(record()).mockReturnValueOnce(pending.promise);
  render(<PlatformAssistantPermissions />);
  await ready();
  fireEvent.click(calendar());
  const button = save();
  fireEvent.click(button);
  fireEvent.click(button);
  expect(state.request).toHaveBeenCalledTimes(2);
  expect(calendar().disabled).toBe(true);
  expect(screen.queryByText('AI 代辦權限已儲存。')).toBeNull();
  await act(async () =>
    pending.resolve({
      ...record(A, 1),
      permissions: { createPersonalEvent: true, prepareFoodOrder: false },
    }),
  );
  await screen.findByText('AI 代辦權限已儲存。');
});

it.each([new NuniError(409, 'ASSISTANT_PERMISSION_REVISION_CONFLICT'), new Error('response lost')])(
  'requires a new read instead of overwriting after an unconfirmed save (%s)',
  async (failure) => {
    state.request
      .mockResolvedValueOnce(record())
      .mockRejectedValueOnce(failure)
      .mockResolvedValue(record(A, 3));
    render(<PlatformAssistantPermissions />);
    await ready();
    fireEvent.click(calendar());
    fireEvent.click(save());
    await screen.findByRole('alert');
    expect(calendar().getAttribute('aria-checked')).toBe('true');
    expect(save().disabled).toBe(true);
    expect(screen.queryByText('AI 代辦權限已儲存。')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '重新讀取權限' }));
    await ready();
    expect(calendar().getAttribute('aria-checked')).toBe('false');
  },
);

it('rejects a successful HTTP response that did not persist the requested values', async () => {
  state.request.mockResolvedValueOnce(record()).mockResolvedValueOnce(record(A, 1));
  render(<PlatformAssistantPermissions />);
  await ready();
  fireEvent.click(calendar());
  fireEvent.click(save());
  await screen.findByRole('alert');
  expect(screen.queryByText('AI 代辦權限已儲存。')).toBeNull();
  expect(save().disabled).toBe(true);
});

it('invalidates an unsaved draft when another tab updates permissions', async () => {
  render(<PlatformAssistantPermissions />);
  await ready();
  fireEvent.click(calendar());
  act(() =>
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: 'nuni.platform.assistant-permissions-changed',
        newValue: 'new-revision',
      }),
    ),
  );
  expect(screen.getByRole('alert').textContent).toContain('另一個分頁更新');
  expect(save().disabled).toBe(true);
  expect(state.request).toHaveBeenCalledTimes(1);
});

it('removes editable values during refresh or unconfirmed logout and exposes recovery', async () => {
  const view = render(<PlatformAssistantPermissions />);
  await ready();
  state.auth.loading = true;
  view.rerender(<PlatformAssistantPermissions />);
  expect(screen.queryByRole('switch')).toBeNull();
  state.auth.loading = false;
  state.auth.pendingLogout = true;
  view.rerender(<PlatformAssistantPermissions />);
  fireEvent.click(screen.getByRole('button', { name: '重試登出 Google 帳號' }));
  expect(state.auth.logout).toHaveBeenCalledOnce();
  expect(screen.queryByRole('switch')).toBeNull();
});

it('loads successfully under React StrictMode without stale effect locks', async () => {
  render(
    <StrictMode>
      <PlatformAssistantPermissions />
    </StrictMode>,
  );
  await ready();
  fireEvent.click(calendar());
  expect(save().disabled).toBe(false);
});

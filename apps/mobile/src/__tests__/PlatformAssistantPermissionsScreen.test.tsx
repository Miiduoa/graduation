import React, { StrictMode } from 'react';
import { Switch } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { NuniError } from '@campus/shared/src/nuni';
import { createDefaultAssistantWritePermissions } from '@campus/shared/src/assistantPermissions';
import type { PlatformAssistantPermissionState } from '@campus/shared/src/platformAssistantPermissions';
import { AssistantPermissionsScreen } from '../screens/AssistantPermissionsScreen';
import type { useOptionalNuniSession } from '../state/nuniSession';
import {
  loadAssistantWritePermissionsState,
  saveAssistantWritePermissions,
} from '../services/assistantPermissions';

jest.mock('../state/auth', () => ({ useAuth: () => mockSchool }));
jest.mock('../state/nuniSession', () => ({ useOptionalNuniSession: () => mockPlatform }));
jest.mock('../ui/navigationTheme', () => ({ useTabBarContentBottomPadding: () => 80 }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../services/assistantPermissions', () => ({
  loadAssistantWritePermissionsState: jest.fn(),
  saveAssistantWritePermissions: jest.fn(),
}));

type PlatformAuth = NonNullable<ReturnType<typeof useOptionalNuniSession>>;
const accountA = 'pa_11111111-1111-4111-8111-111111111111';
const accountB = 'pa_22222222-2222-4222-8222-222222222222';
const loadSchool = loadAssistantWritePermissionsState as jest.Mock;
const saveSchool = saveAssistantWritePermissions as jest.Mock;
let mockSchool: { user: { uid: string } | null };
let mockPlatform: PlatformAuth | null;

function state(
  accountId = accountA,
  revision = 0,
  createPersonalEvent = false,
  prepareFoodOrder = false,
): PlatformAssistantPermissionState {
  return {
    scope: 'platform-account',
    accountId,
    revision,
    permissions: { createPersonalEvent, prepareFoodOrder },
  };
}

function auth(request: jest.Mock, accountId = accountA, context = 'context-a'): PlatformAuth {
  return {
    session: {
      platformAccountId: accountId,
      context,
      expiresAt: Date.now() + 3600000,
      isPlatformOperator: false,
    },
    loading: false,
    pendingLogout: false,
    error: '',
    bffRequest: request,
    isSessionCurrent: (expectedAccount, expectedContext) =>
      !!mockPlatform &&
      !mockPlatform.loading &&
      !mockPlatform.error &&
      !mockPlatform.pendingLogout &&
      mockPlatform.session?.platformAccountId === expectedAccount &&
      mockPlatform.session.context === expectedContext,
    request: jest.fn(),
    upload: jest.fn(),
    refresh: jest.fn(),
    logout: jest.fn(),
    signIn: jest.fn(),
  };
}

function deferred<T = unknown>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSchool = { user: null };
  mockPlatform = null;
  loadSchool.mockResolvedValue({
    permissions: createDefaultAssistantWritePermissions(),
    source: 'server',
  });
  saveSchool.mockResolvedValue(undefined);
});

test('Google-only users can save both account preferences without a school login', async () => {
  const request = jest
    .fn()
    .mockResolvedValueOnce(state())
    .mockResolvedValueOnce(state(accountA, 1, true, true));
  mockPlatform = auth(request);
  const view = render(<AssistantPermissionsScreen />);
  await waitFor(() => expect(view.getByLabelText('新增個人行程').props.disabled).toBe(false));
  expect(view.queryByText('請先登入')).toBeNull();
  expect(view.queryByText('學校帳號的寫入動作')).toBeNull();
  expect(view.getAllByRole('switch')).toHaveLength(2);
  expect(view.getByLabelText('新增個人行程').props.value).toBe(false);
  expect(view.getByLabelText('整理訂餐草稿').props.value).toBe(false);
  fireEvent(view.getByLabelText('新增個人行程'), 'valueChange', true);
  fireEvent(view.getByLabelText('整理訂餐草稿'), 'valueChange', true);
  fireEvent.press(view.getByText('儲存 AI 代辦權限'));
  await waitFor(() => expect(view.getByText('AI 代辦權限已儲存。')).toBeTruthy());
  expect(request.mock.calls).toEqual([
    ['assistant-permissions', 'context-a'],
    [
      'assistant-permissions',
      'context-a',
      { expectedRevision: 0, permissions: { createPersonalEvent: true, prepareFoodOrder: true } },
    ],
  ]);
  expect(loadSchool).not.toHaveBeenCalled();
  expect(saveSchool).not.toHaveBeenCalled();
});

test('dual identities show independent Google and school groups and retain the 12 school permissions', async () => {
  mockSchool = { user: { uid: 'school-user' } };
  const request = jest.fn().mockResolvedValue(state());
  mockPlatform = auth(request);
  const view = render(<AssistantPermissionsScreen />);
  await waitFor(() => expect(view.getByLabelText('送出請假申請').props.disabled).toBe(false));
  expect(view.getByText('Google 帳號的代辦動作')).toBeTruthy();
  expect(view.getByText('學校帳號的寫入動作')).toBeTruthy();
  expect(view.getAllByRole('switch')).toHaveLength(14);
  fireEvent(view.getByLabelText('預約座位'), 'valueChange', true);
  fireEvent.press(view.getByText('儲存助理權限'));
  await waitFor(() =>
    expect(saveSchool).toHaveBeenCalledWith(
      'school-user',
      expect.objectContaining({ reserveSeat: true }),
    ),
  );
  expect(request).toHaveBeenCalledTimes(1);
  expect(view.getByLabelText('新增個人行程').props.value).toBe(false);
});

test('a failed read disables editing until a successful retry', async () => {
  const request = jest
    .fn()
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce(state(accountA, 3, true));
  mockPlatform = auth(request);
  const view = render(<AssistantPermissionsScreen />);
  await waitFor(() => expect(view.getByText('重新讀取權限')).toBeTruthy());
  expect(view.getByLabelText('新增個人行程').props.disabled).toBe(true);
  expect(view.getByLabelText('新增個人行程').props.value).toBe(true);
  fireEvent.press(view.getByText('儲存 AI 代辦權限'));
  expect(request).toHaveBeenCalledTimes(1);
  fireEvent.press(view.getByText('重新讀取權限'));
  await waitFor(() => expect(view.getByLabelText('新增個人行程').props.disabled).toBe(false));
  expect(view.getByLabelText('新增個人行程').props.value).toBe(true);
  expect(view.queryByText('AI 代辦權限已儲存。')).toBeNull();
});

test.each([
  ['account', accountB, 'context-b'],
  ['session context', accountA, 'context-new'],
])('ignores a late read when the %s changes', async (_label, nextAccount, nextContext) => {
  const late = deferred();
  const first = jest.fn().mockReturnValue(late.promise);
  mockPlatform = auth(first);
  const view = render(<AssistantPermissionsScreen />);
  const second = jest.fn().mockResolvedValue(state(nextAccount, 5, false, true));
  mockPlatform = auth(second, nextAccount, nextContext);
  view.rerender(<AssistantPermissionsScreen />);
  await waitFor(() => expect(view.getByLabelText('整理訂餐草稿').props.value).toBe(true));
  await act(async () => {
    late.resolve(state(accountA, 3, true));
  });
  expect(view.getByLabelText('新增個人行程').props.value).toBe(false);
  expect(view.getByLabelText('整理訂餐草稿').props.value).toBe(true);
  expect(second).toHaveBeenCalledWith('assistant-permissions', nextContext);
});

test.each(['resolve', 'reject'] as const)(
  'ignores a late save %s after switching accounts',
  async (outcome) => {
    const late = deferred();
    const first = jest.fn().mockResolvedValueOnce(state()).mockReturnValueOnce(late.promise);
    mockPlatform = auth(first);
    const view = render(<AssistantPermissionsScreen />);
    await waitFor(() => expect(view.getByLabelText('新增個人行程').props.disabled).toBe(false));
    fireEvent(view.getByLabelText('新增個人行程'), 'valueChange', true);
    fireEvent.press(view.getByText('儲存 AI 代辦權限'));
    expect(first).toHaveBeenCalledTimes(2);
    mockPlatform = auth(jest.fn().mockResolvedValue(state(accountB)), accountB, 'context-b');
    view.rerender(<AssistantPermissionsScreen />);
    await waitFor(() => expect(view.getByLabelText('新增個人行程').props.disabled).toBe(false));
    await act(async () => {
      if (outcome === 'resolve') late.resolve(state(accountA, 1, true));
      else late.reject(new NuniError(409, 'ASSISTANT_PERMISSION_REVISION_CONFLICT'));
    });
    expect(view.getByLabelText('新增個人行程').props.value).toBe(false);
    expect(view.queryByText('AI 代辦權限已儲存。')).toBeNull();
    expect(view.queryByText('重新讀取權限')).toBeNull();
  },
);

test('clears unsaved choices on logout and ignores responses or handlers from the closed editor', async () => {
  const late = deferred();
  const request = jest.fn().mockResolvedValueOnce(state()).mockReturnValueOnce(late.promise);
  mockPlatform = auth(request);
  const view = render(<AssistantPermissionsScreen />);
  await waitFor(() => expect(view.getByLabelText('新增個人行程').props.disabled).toBe(false));
  const toggle = view
    .UNSAFE_getAllByType(Switch)
    .find((row) => row.props.accessibilityLabel === '新增個人行程')!.props.onValueChange;
  fireEvent(view.getByLabelText('新增個人行程'), 'valueChange', true);
  fireEvent.press(view.getByText('儲存 AI 代辦權限'));
  act(() => toggle(false));
  expect(view.getByLabelText('新增個人行程').props.value).toBe(true);
  mockPlatform = null;
  view.rerender(<AssistantPermissionsScreen />);
  expect(view.getByText('請先登入')).toBeTruthy();
  await act(async () => {
    late.resolve(state(accountA, 1, true));
    toggle(true);
  });
  expect(view.queryByText('AI 代辦權限已儲存。')).toBeNull();
  expect(request).toHaveBeenCalledTimes(2);
  mockPlatform = auth(jest.fn().mockResolvedValue(state()), accountA, 'new-login');
  view.rerender(<AssistantPermissionsScreen />);
  await waitFor(() => expect(view.getByLabelText('新增個人行程').props.disabled).toBe(false));
  expect(view.getByLabelText('新增個人行程').props.value).toBe(false);
});

test.each([
  ['conflict', new NuniError(409, 'ASSISTANT_PERMISSION_REVISION_CONFLICT')],
  ['uncertain network result', new NuniError(0, 'NETWORK_ERROR')],
  ['wrong account receipt', state(accountB, 1, true)],
  ['wrong stored values', state(accountA, 1, false)],
  ['wrong revision receipt', state(accountA, 2, true)],
])(
  'requires fresh readback after %s and never reports success or resends the draft',
  async (_label, result) => {
    const request = jest.fn().mockResolvedValueOnce(state());
    if (result instanceof Error) request.mockRejectedValueOnce(result);
    else request.mockResolvedValueOnce(result);
    request
      .mockResolvedValueOnce(state(accountA, 4, false, true))
      .mockResolvedValueOnce(state(accountA, 5, true, true));
    mockPlatform = auth(request);
    const view = render(<AssistantPermissionsScreen />);
    await waitFor(() => expect(view.getByLabelText('新增個人行程').props.disabled).toBe(false));
    fireEvent(view.getByLabelText('新增個人行程'), 'valueChange', true);
    const save = view.getByText('儲存 AI 代辦權限');
    act(() => {
      fireEvent.press(save);
      fireEvent.press(save);
    });
    await waitFor(() => expect(view.getByText('重新讀取權限')).toBeTruthy());
    expect(view.queryByText('AI 代辦權限已儲存。')).toBeNull();
    expect(view.getByLabelText('新增個人行程').props.disabled).toBe(true);
    fireEvent.press(view.getByText('儲存 AI 代辦權限'));
    expect(request).toHaveBeenCalledTimes(2);
    fireEvent.press(view.getByText('重新讀取權限'));
    await waitFor(() => expect(view.getByLabelText('新增個人行程').props.disabled).toBe(false));
    expect(view.getByLabelText('新增個人行程').props.value).toBe(false);
    expect(view.getByLabelText('整理訂餐草稿').props.value).toBe(true);
    expect(view.queryByText('AI 代辦權限已儲存。')).toBeNull();
    fireEvent(view.getByLabelText('新增個人行程'), 'valueChange', true);
    fireEvent.press(view.getByText('儲存 AI 代辦權限'));
    await waitFor(() => expect(view.getByText('AI 代辦權限已儲存。')).toBeTruthy());
    expect(request.mock.calls[3]).toEqual([
      'assistant-permissions',
      'context-a',
      {
        expectedRevision: 4,
        permissions: { createPersonalEvent: true, prepareFoodOrder: true },
      },
    ]);
  },
);

test('StrictMode effect replay isolates late load results and keeps the newer editor interactive', async () => {
  const oldRead = deferred();
  const newRead = deferred();
  const request = jest
    .fn()
    .mockReturnValueOnce(oldRead.promise)
    .mockReturnValueOnce(newRead.promise);
  mockPlatform = auth(request);
  const view = render(
    <StrictMode>
      <AssistantPermissionsScreen />
    </StrictMode>,
  );
  await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  await act(async () => {
    newRead.resolve(state(accountA, 4, false, true));
  });
  await act(async () => {
    oldRead.resolve(state(accountA, 1, true));
  });
  expect(view.getByLabelText('新增個人行程').props.disabled).toBe(false);
  expect(view.getByLabelText('新增個人行程').props.value).toBe(false);
  expect(view.getByLabelText('整理訂餐草稿').props.value).toBe(true);
});

test.each(['loading', 'error', 'pendingLogout'] as const)(
  'holds permission access while Google session is %s',
  async (condition) => {
    const request = jest.fn().mockResolvedValue(state());
    mockPlatform = {
      ...auth(request),
      [condition]: condition === 'error' ? 'SESSION_UNAVAILABLE' : true,
    };
    const view = render(<AssistantPermissionsScreen />);
    expect(view.queryByLabelText('新增個人行程')).toBeNull();
    expect(request).not.toHaveBeenCalled();
    if (condition === 'error') {
      fireEvent.press(view.getByText('重新確認 Google 帳號'));
      expect(mockPlatform.refresh).toHaveBeenCalledTimes(1);
    }
    if (condition === 'pendingLogout') {
      fireEvent.press(view.getByText('重試登出 Google 帳號'));
      expect(mockPlatform.logout).toHaveBeenCalledTimes(1);
    }
    mockPlatform = auth(request);
    view.rerender(<AssistantPermissionsScreen />);
    await waitFor(() => expect(view.getByLabelText('新增個人行程').props.disabled).toBe(false));
  },
);

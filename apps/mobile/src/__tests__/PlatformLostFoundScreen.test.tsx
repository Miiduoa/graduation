import React from 'react';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { Alert, Share } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NuniError } from '@campus/shared/src/nuni';
import type { NuniLostFoundItem } from '@campus/shared/src/nuniLostFound';
import { PlatformLostFoundScreen } from '../screens/PlatformLostFoundScreen';
import {
  platformLostFoundStorageKey,
  readPlatformLostFoundDeviceState,
  savePlatformLostFoundPending,
} from '../data/platformLostFoundDrafts';

const accountA = 'pa_11111111-1111-4111-8111-111111111111';
const accountB = 'pa_22222222-2222-4222-8222-222222222222';
const itemId = 'plf_33333333-3333-4333-8333-333333333333';
const stamp = '2026-11-07T14:00:00.000Z';
const example: NuniLostFoundItem = {
  id: itemId,
  schoolId: 'pu',
  type: 'found',
  title: '圖書館的黑色皮夾',
  description: '有藍色扣環，請提供內容物核對。',
  category: 'wallet',
  location: '圖書館一樓',
  date: '2026-11-07',
  contactInfo: 'owner@example.test',
  status: 'open',
  version: 1,
  createdAt: stamp,
  updatedAt: stamp,
  resolvedAt: null,
  isOwner: true,
};
let mockSchool = { id: 'pu', name: '靜宜大學' };
let mockFocused = true;
let mockUuid = 0;
const mockRequest = jest.fn();
const mockSignIn = jest.fn(async () => 'signed-in');
const mockRefresh = jest.fn(async () => undefined);
const mockLogout = jest.fn(async () => undefined);
const mockSessionCurrent = jest.fn(
  (account: string, context: string) =>
    !mockAuth.loading &&
    !mockAuth.error &&
    !mockAuth.pendingLogout &&
    mockAuth.session?.platformAccountId === account &&
    mockAuth.session.context === context &&
    mockAuth.session.expiresAt > Date.now(),
);
let mockAuth: {
  session: {
    platformAccountId: string;
    context: string;
    isPlatformOperator: boolean;
    expiresAt: number;
  } | null;
  loading: boolean;
  error: string;
  pendingLogout: boolean;
} = { session: null, loading: false, error: '', pendingLogout: false };
let records = new Map<string, NuniLostFoundItem>();

jest.mock('../state/nuniSession', () => ({
  useNuniSession: () => ({
    ...mockAuth,
    request: mockRequest,
    signIn: mockSignIn,
    refresh: mockRefresh,
    logout: mockLogout,
    isSessionCurrent: mockSessionCurrent,
  }),
}));
jest.mock('../state/school', () => ({
  useSchool: () => ({ school: mockSchool, selectionReady: true }),
}));
jest.mock('../state/theme', () => ({ useThemeMode: () => ({ themeMode: 'light' }) }));
jest.mock('../components/SchoolBrowsingControl', () => ({ SchoolBrowsingControl: () => null }));
jest.mock('../services/nuniGoogle', () => ({
  getGoogleCredentialCapability: () => ({ available: true }),
}));
jest.mock('expo-crypto', () => ({
  randomUUID: () => `aaaaaaaa-aaaa-4aaa-8aaa-${String(++mockUuid).padStart(12, '0')}`,
}));
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback: () => () => void) => {
    const React = require('react');
    const focused = mockFocused;
    React.useEffect(() => (focused ? callback() : undefined), [callback, focused]);
  },
}));
jest.mock('../ui/navigationTheme', () => ({ TAB_BAR_CONTENT_BOTTOM_PADDING: 80 }));
jest.mock('../ui/components', () => {
  const React = require('react');
  const { View, Text, Pressable } = require('react-native');
  return {
    Screen: ({ children }: { children: React.ReactNode }) => <View>{children}</View>,
    AnimatedCard: ({
      children,
      title,
      subtitle,
    }: {
      children?: React.ReactNode;
      title?: string;
      subtitle?: string;
    }) => (
      <View>
        {title && <Text>{title}</Text>}
        {subtitle && <Text>{subtitle}</Text>}
        {children}
      </View>
    ),
    Button: ({
      text,
      onPress,
      disabled,
    }: {
      text: string;
      onPress: () => void;
      disabled?: boolean;
    }) => (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={text}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onPress}
      >
        <Text>{text}</Text>
      </Pressable>
    ),
    Pill: ({ text }: { text: string }) => <Text>{text}</Text>,
    SegmentedControl: ({
      options,
      onSelect,
      selected,
    }: {
      options: { id: string; label: string }[];
      selected: string;
      onSelect: (id: string) => void;
    }) => (
      <View>
        {options.map(({ id, label }) => (
          <Pressable
            key={id}
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityState={{ selected: selected === id }}
            onPress={() => onSelect(id)}
          >
            <Text>{label}</Text>
          </Pressable>
        ))}
      </View>
    ),
  };
});

function summary(item: NuniLostFoundItem) {
  const result = { ...item };
  delete result.contactInfo;
  return result;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

beforeEach(async () => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
  await AsyncStorage.clear();
  mockSchool = { id: 'pu', name: '靜宜大學' };
  mockFocused = true;
  mockUuid = 0;
  mockAuth = {
    session: {
      platformAccountId: accountA,
      context: 'context-a',
      isPlatformOperator: false,
      expiresAt: Date.now() + 100_000,
    },
    loading: false,
    error: '',
    pendingLogout: false,
  };
  records = new Map([[itemId, { ...example }]]);
  mockRequest.mockImplementation(
    async (path: string, _context: string, input: Record<string, unknown>) => {
      const school = input.schoolId as string;
      if (path === 'lost-found/list' || path === 'lost-found/export') {
        let items = [...records.values()].filter((item) => item.schoolId === school);
        if (path === 'lost-found/list') {
          if (input.mine) items = items.filter((item) => item.isOwner);
          if ((input.status ?? (input.mine ? 'all' : 'open')) !== 'all')
            items = items.filter((item) => item.status === (input.status ?? 'open'));
          if (input.type) items = items.filter((item) => item.type === input.type);
          if (input.category) items = items.filter((item) => item.category === input.category);
        }
        return {
          schoolId: school,
          items: path === 'lost-found/export' ? items : items.map(summary),
          nextCursor: null,
        };
      }
      const id = input.id as string;
      if (path === 'lost-found/get') {
        const item = records.get(id);
        if (!item || item.schoolId !== school) throw new NuniError(404, 'LOST_FOUND_NOT_FOUND');
        return { item };
      }
      if (path === 'lost-found/create') {
        const item = { ...example, ...(input.fields as object), id, schoolId: school };
        records.set(id, item);
        return { item };
      }
      const item = records.get(id);
      if (!item?.isOwner) throw new NuniError(404, 'LOST_FOUND_NOT_FOUND');
      if (path === 'lost-found/remove') {
        records.delete(id);
        return { id, schoolId: school, removed: true };
      }
      const next: NuniLostFoundItem = {
        ...item,
        ...(input.fields as object),
        version: Number(input.expectedVersion) + 1,
        ...(path === 'lost-found/resolve'
          ? { status: 'resolved' as const, resolvedAt: stamp, contactInfo: '' }
          : {}),
      };
      records.set(id, next);
      return { item: next };
    },
  );
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.sharedAction });
});

async function openDetail(view: ReturnType<typeof render>) {
  fireEvent.press(await view.findByRole('button', { name: `查看平台刊登：${example.title}` }));
  await view.findByText(example.contactInfo!);
}
async function confirmAlert() {
  const buttons = jest.mocked(Alert.alert).mock.calls.at(-1)?.[2];
  const button = buttons?.find((entry) => entry.style !== 'cancel');
  expect(button?.onPress).toBeDefined();
  await act(async () => {
    button!.onPress!();
  });
}
async function fillCreate(view: ReturnType<typeof render>) {
  await waitFor(() => expect(view.getByRole('button', { name: '我遺失了' })).not.toBeDisabled());
  fireEvent.press(view.getByRole('button', { name: '我遺失了' }));
  fireEvent.changeText(await view.findByLabelText('物品名稱'), '水壺');
  fireEvent.changeText(view.getByLabelText('物品描述'), '白色水壺，有貼紙。');
  fireEvent.changeText(view.getByLabelText('遺失或拾獲地點'), '操場');
  fireEvent.changeText(view.getByLabelText('發生日期'), '2026-11-07');
  fireEvent.changeText(view.getByLabelText('聯絡方式'), 'me@example.test');
}

test('a Google-only account reads platform data without any Firebase identity and hides contacts from the list', async () => {
  const view = render(<PlatformLostFoundScreen />);
  await view.findByRole('button', { name: `查看平台刊登：${example.title}` });
  expect(view.queryByText(example.contactInfo!)).toBeNull();
  expect(mockRequest).toHaveBeenCalledWith('lost-found/list', 'context-a', {
    schoolId: 'pu',
    status: 'open',
  });
  expect(view.queryByText('查看既有校園刊登')).toBeNull();
  await openDetail(view);
  expect(view.getByText('這是你的刊登')).toBeTruthy();
});

test('signed-out users get a direct Google action without any school SSO navigation', async () => {
  mockAuth.session = null;
  const navigation = { navigate: jest.fn() };
  const view = render(<PlatformLostFoundScreen navigation={navigation} />);
  fireEvent.press(view.getByRole('button', { name: '使用 Google 繼續' }));
  await waitFor(() => expect(mockSignIn).toHaveBeenCalledTimes(1));
  expect(mockRequest).not.toHaveBeenCalled();
  expect(navigation.navigate).not.toHaveBeenCalled();
});

test('Google sign-in refusal leaves a recoverable login screen without loading private records', async () => {
  mockAuth.session = null;
  mockSignIn.mockRejectedValueOnce(new Error('credential refused'));
  const view = render(<PlatformLostFoundScreen />);
  fireEvent.press(view.getByRole('button', { name: '使用 Google 繼續' }));
  await view.findByText('操作沒有完成，請確認連線後重試。');
  expect(view.getByRole('button', { name: '使用 Google 繼續' })).toBeTruthy();
  expect(mockRequest).not.toHaveBeenCalled();
});

test('an expired verified session is rechecked instead of exposing stored records', async () => {
  mockAuth.session!.expiresAt = Date.now() - 1;
  const view = render(<PlatformLostFoundScreen />);
  fireEvent.press(view.getByRole('button', { name: '重新確認登入' }));
  await waitFor(() => expect(mockRefresh).toHaveBeenCalledTimes(1));
  expect(mockRequest).not.toHaveBeenCalled();
  expect(view.queryByText(example.contactInfo!)).toBeNull();
});

test.each(['loading', 'error', 'pendingLogout'] as const)(
  'does not expose records while Google authentication has %s',
  async (kind) => {
    if (kind === 'error') mockAuth.error = '無法確認帳號';
    else mockAuth[kind] = true;
    const view = render(<PlatformLostFoundScreen />);
    expect(view.queryByText(example.title)).toBeNull();
    expect(mockRequest).not.toHaveBeenCalled();
  },
);

test('an unavailable API is shown honestly rather than as an empty list', async () => {
  mockRequest.mockRejectedValue(new NuniError(404, 'NOT_FOUND'));
  const view = render(<PlatformLostFoundScreen />);
  await view.findByText('平台失物招領服務目前無法使用，請稍後再試。');
  expect(view.queryByText('目前沒有符合條件的刊登')).toBeNull();
  expect(view.getByRole('button', { name: '重新讀取列表' })).toBeTruthy();
});

test('an old API 401 remains an unavailable feature after a same-context Google refresh without a list loop', async () => {
  const failedList = deferred<unknown>();
  mockRequest.mockImplementation(async (path: string) => {
    if (path === 'lost-found/list') return failedList.promise;
    if (path === 'sessions/current')
      return { authenticated: true, platformAccountId: accountA, isPlatformOperator: false };
    throw new Error(`unexpected request: ${path}`);
  });
  const view = render(<PlatformLostFoundScreen />);
  await waitFor(() => expect(mockRequest).toHaveBeenCalledTimes(1));

  // The actual controller publishes a new principal while preserving the live
  // session context before its request rejects the original legacy 401.
  mockAuth = { ...mockAuth, session: { ...mockAuth.session! } };
  view.rerender(<PlatformLostFoundScreen />);
  await act(async () => failedList.reject(new NuniError(401, 'CAMPUS_AUTH_REQUIRED')));
  await view.findByText('平台失物招領服務目前無法使用，請稍後再試。');
  expect(mockRequest.mock.calls.map(([path]) => path)).toEqual([
    'lost-found/list',
    'sessions/current',
  ]);
  expect(mockRequest).toHaveBeenLastCalledWith('sessions/current', 'context-a');
  expect(view.queryByText('Google 登入狀態已過期，請重新確認登入。')).toBeNull();
  expect(view.queryByRole('button', { name: '使用 Google 繼續' })).toBeNull();
  expect(view.queryByText('目前沒有符合條件的刊登')).toBeNull();
});

test('an item deep link preserves its source and rejects a mismatched browsing campus', async () => {
  const view = render(
    <PlatformLostFoundScreen route={{ params: { id: itemId, schoolId: 'nthu' } }} />,
  );
  expect(view.getByText('連結屬於另一個校園')).toBeTruthy();
  expect(mockRequest).not.toHaveBeenCalled();
  mockSchool = { id: 'nthu', name: '國立清華大學' };
  records.set(itemId, { ...example, schoolId: 'nthu' });
  view.rerender(<PlatformLostFoundScreen route={{ params: { id: itemId, schoolId: 'nthu' } }} />);
  await view.findByText(example.contactInfo!);
  expect(mockRequest).toHaveBeenCalledWith('lost-found/get', 'context-a', {
    schoolId: 'nthu',
    id: itemId,
  });
});

test.each(['personal', 'all', 'unavailable-campus'])(
  'a browsing placeholder %s never becomes a platform publication scope',
  async (schoolId) => {
    mockSchool = { id: schoolId, name: '尚未選校' };
    const view = render(<PlatformLostFoundScreen />);
    expect(view.getByText('請先選擇校園')).toBeTruthy();
    expect(mockRequest).not.toHaveBeenCalled();
  },
);

test('legacy Firebase listings remain an explicit separately registered navigation target', async () => {
  const navigation = {
    navigate: jest.fn(),
    getState: () => ({ routeNames: ['LostFound', 'PlatformLostFound'] }),
  };
  const view = render(<PlatformLostFoundScreen navigation={navigation} />);
  fireEvent.press(await view.findByRole('button', { name: '查看既有校園刊登' }));
  expect(navigation.navigate).toHaveBeenCalledWith('LostFound');
});

test('creating a record persists a stable intent, blocks double taps and clears local contact data after a valid receipt', async () => {
  const view = render(<PlatformLostFoundScreen />);
  await fillCreate(view);
  fireEvent.press(view.getByRole('button', { name: '確認刊登' }));
  fireEvent.press(view.getByRole('button', { name: '確認刊登' }));
  await view.findByText('已完成刊登。');
  await waitFor(() => expect(view.queryByText('還有一則操作待確認')).toBeNull());
  const calls = mockRequest.mock.calls.filter(([path]) => path === 'lost-found/create');
  expect(calls).toHaveLength(1);
  expect(calls[0][2]).toEqual(
    expect.objectContaining({
      schoolId: 'pu',
      id: expect.stringMatching(/^plf_/),
      mutationId: expect.stringMatching(/^plfm_/),
      fields: expect.objectContaining({ title: '水壺', contactInfo: 'me@example.test' }),
    }),
  );
  const raw = await AsyncStorage.getItem(
    platformLostFoundStorageKey({ accountId: accountA, schoolId: 'pu' }),
  );
  expect(raw).not.toContain('me@example.test');
});

test('an uncertain create retries its exact persisted operation instead of creating a duplicate', async () => {
  const normal = mockRequest.getMockImplementation()!;
  let lostReceipt = true;
  mockRequest.mockImplementation(async (...args: unknown[]) => {
    if (args[0] === 'lost-found/create' && lostReceipt) {
      lostReceipt = false;
      throw new NuniError(0, 'NETWORK_ERROR');
    }
    return normal(...args);
  });
  const view = render(<PlatformLostFoundScreen />);
  await fillCreate(view);
  fireEvent.press(view.getByRole('button', { name: '確認刊登' }));
  await view.findByText(/結果尚未確認/);
  expect(view.queryByText('已完成刊登。')).toBeNull();
  await act(async () => fireEvent.press(view.getByRole('button', { name: '重試確認這則操作' })));
  await view.findByText('已完成刊登。');
  const calls = mockRequest.mock.calls.filter(([path]) => path === 'lost-found/create');
  expect(calls).toHaveLength(2);
  expect(calls[1][2]).toEqual(calls[0][2]);
});

test('a corrupted mutation receipt stays pending and never claims success', async () => {
  const normal = mockRequest.getMockImplementation()!;
  mockRequest.mockImplementation(async (...args: unknown[]) =>
    args[0] === 'lost-found/create'
      ? { item: { ...example, id: (args[2] as { id: string }).id, schoolId: 'nthu' } }
      : normal(...args),
  );
  const view = render(<PlatformLostFoundScreen />);
  await fillCreate(view);
  fireEvent.press(view.getByRole('button', { name: '確認刊登' }));
  await view.findByText(/結果尚未確認/);
  expect(view.queryByText('已完成刊登。')).toBeNull();
  expect(
    (await readPlatformLostFoundDeviceState({ accountId: accountA, schoolId: 'pu' }, () => true))
      .pending?.action,
  ).toBe('create');
});

test('a storage failure prevents a mutation from being sent', async () => {
  const view = render(<PlatformLostFoundScreen />);
  await fillCreate(view);
  await waitFor(() => expect(view.queryByText('正在保存本機草稿…')).toBeNull());
  jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('storage unavailable'));
  fireEvent.press(view.getByRole('button', { name: '確認刊登' }));
  await view.findByText(/這台手機暫時無法保存待確認操作/);
  expect(mockRequest.mock.calls.filter(([path]) => path === 'lost-found/create')).toHaveLength(0);
});

test('an owner can clear contact information when editing and a rejected conflict preserves the draft', async () => {
  const view = render(<PlatformLostFoundScreen />);
  await openDetail(view);
  await waitFor(() =>
    expect(view.getByRole('button', { name: '編輯這則刊登' })).not.toBeDisabled(),
  );
  fireEvent.press(view.getByRole('button', { name: '編輯這則刊登' }));
  fireEvent.changeText(await view.findByLabelText('聯絡方式'), '');
  fireEvent.press(view.getByRole('button', { name: '儲存修改' }));
  await view.findByText('修改已儲存。');
  const update = mockRequest.mock.calls.find(([path]) => path === 'lost-found/update')!;
  expect(update[2]).toEqual(
    expect.objectContaining({
      expectedVersion: 1,
      fields: expect.objectContaining({ contactInfo: '' }),
    }),
  );
  await view.findByText('發布者未提供聯絡方式。');
  await waitFor(() =>
    expect(view.getByRole('button', { name: '編輯這則刊登' })).not.toBeDisabled(),
  );
  fireEvent.press(view.getByRole('button', { name: '編輯這則刊登' }));
  fireEvent.changeText(await view.findByLabelText('物品名稱'), '保留這段修改');
  const normal = mockRequest.getMockImplementation()!;
  mockRequest.mockImplementation(async (...args: unknown[]) => {
    if (args[0] === 'lost-found/update') throw new NuniError(409, 'LOST_FOUND_VERSION_CONFLICT');
    return normal(...args);
  });
  fireEvent.press(view.getByRole('button', { name: '儲存修改' }));
  await view.findByText(/已被其他操作更新/);
  expect(view.getByLabelText('物品名稱').props.value).toBe('保留這段修改');
  const stored = await readPlatformLostFoundDeviceState(
    { accountId: accountA, schoolId: 'pu' },
    () => true,
  );
  expect(stored.pending).toBeNull();
  expect(stored.draft?.fields.title).toBe('保留這段修改');
});

test('resolve and remove require explicit confirmation and clear contact data after a confirmed receipt', async () => {
  const view = render(<PlatformLostFoundScreen />);
  await openDetail(view);
  await waitFor(() =>
    expect(view.getByRole('button', { name: '將這則刊登結案' })).not.toBeDisabled(),
  );
  fireEvent.press(view.getByRole('button', { name: '將這則刊登結案' }));
  expect(Alert.alert).toHaveBeenCalledWith(
    '確認結案？',
    expect.stringContaining('聯絡方式將永久清除'),
    expect.any(Array),
  );
  expect(mockRequest.mock.calls.some(([path]) => path === 'lost-found/resolve')).toBe(false);
  await confirmAlert();
  await view.findAllByText('已結案，聯絡方式已清除。');
  expect(view.queryByText(example.contactInfo!)).toBeNull();
  expect(view.queryByRole('button', { name: '編輯這則刊登' })).toBeNull();
  await waitFor(() =>
    expect(view.getByRole('button', { name: '下架這則刊登' })).not.toBeDisabled(),
  );
  fireEvent.press(view.getByRole('button', { name: '下架這則刊登' }));
  await confirmAlert();
  await view.findByText('已下架這則刊登。');
  expect(mockRequest.mock.calls.find(([path]) => path === 'lost-found/remove')?.[2]).toEqual(
    expect.objectContaining({ expectedVersion: 2 }),
  );
  await view.findByText('目前沒有符合條件的刊登');
});

test.each(['resolve', 'remove'] as const)(
  'an old detail response cannot restore contacts after a recovered %s receipt',
  async (action) => {
    await savePlatformLostFoundPending(
      { accountId: accountA, schoolId: 'pu' },
      {
        action,
        input: {
          schoolId: 'pu',
          id: itemId,
          expectedVersion: 1,
          mutationId: 'stored-pending-0001',
        },
      },
      () => true,
    );
    const delayed = deferred<unknown>();
    const normal = mockRequest.getMockImplementation()!;
    mockRequest.mockImplementation((...args: unknown[]) =>
      args[0] === 'lost-found/get' ? delayed.promise : normal(...args),
    );
    const view = render(
      <PlatformLostFoundScreen route={{ params: { id: itemId, schoolId: 'pu' } }} />,
    );
    fireEvent.press(await view.findByRole('button', { name: '重試確認這則操作' }));
    if (action === 'resolve') await view.findAllByText('已結案，聯絡方式已清除。');
    else await view.findByText('已下架這則刊登。');
    await act(async () => delayed.resolve({ item: example }));
    expect(view.queryByText(example.contactInfo!)).toBeNull();
    expect(view.queryByRole('button', { name: '編輯這則刊登' })).toBeNull();
  },
);

test.each(['resolve', 'remove'] as const)(
  'confirmed %s hides contacts even when pending cleanup fails, then retries only local cleanup',
  async (action) => {
    const normalRequest = mockRequest.getMockImplementation()!;
    const normalSet = jest.mocked(AsyncStorage.setItem).getMockImplementation()!;
    let failCleanup = false;
    mockRequest.mockImplementation(async (...args: unknown[]) => {
      const result = await normalRequest(...args);
      if (args[0] === `lost-found/${action}`) failCleanup = true;
      return result;
    });
    jest.spyOn(AsyncStorage, 'setItem').mockImplementation(async (key, raw) => {
      if (failCleanup && JSON.parse(raw).pending === null) {
        failCleanup = false;
        throw new Error('device storage unavailable');
      }
      return normalSet(key, raw);
    });
    const view = render(<PlatformLostFoundScreen />);
    await openDetail(view);
    const button = action === 'resolve' ? '將這則刊登結案' : '下架這則刊登';
    await waitFor(() => expect(view.getByRole('button', { name: button })).not.toBeDisabled());
    fireEvent.press(view.getByRole('button', { name: button }));
    await confirmAlert();
    await view.findByText('操作已完成，但這台手機的待確認紀錄尚未清除。請重試清理，不需重新刊登。');
    expect(view.queryByText(example.contactInfo!)).toBeNull();
    expect(view.queryByRole('button', { name: '編輯這則刊登' })).toBeNull();
    fireEvent.press(view.getByRole('button', { name: '重試清理本機紀錄' }));
    await waitFor(() =>
      expect(view.queryByRole('button', { name: '重試清理本機紀錄' })).toBeNull(),
    );
    expect(mockRequest.mock.calls.filter(([path]) => path === `lost-found/${action}`)).toHaveLength(
      1,
    );
  },
);

test('reloading an edit draft disables edits until the reviewed latest version is loaded', async () => {
  const view = render(<PlatformLostFoundScreen />);
  await openDetail(view);
  await waitFor(() =>
    expect(view.getByRole('button', { name: '編輯這則刊登' })).not.toBeDisabled(),
  );
  fireEvent.press(view.getByRole('button', { name: '編輯這則刊登' }));
  await view.findByLabelText('物品名稱');
  const next = deferred<unknown>();
  const normal = mockRequest.getMockImplementation()!;
  mockRequest.mockImplementation((...args: unknown[]) =>
    args[0] === 'lost-found/get' ? next.promise : normal(...args),
  );
  fireEvent.press(view.getByRole('button', { name: '重新讀取最新內容' }));
  await confirmAlert();
  expect(view.getByLabelText('物品名稱').props.editable).toBe(false);
  await act(async () =>
    next.resolve({ item: { ...example, version: 2, title: '另一個裝置更新的物品名稱' } }),
  );
  await waitFor(() =>
    expect(view.getByLabelText('物品名稱').props.value).toBe('另一個裝置更新的物品名稱'),
  );
  expect(view.getByLabelText('物品名稱').props.editable).toBe(true);
  expect(
    (await readPlatformLostFoundDeviceState({ accountId: accountA, schoolId: 'pu' }, () => true))
      .draft?.expectedVersion,
  ).toBe(2);
});

test('another user cannot see owner controls or manipulate the record through the UI', async () => {
  records.set(itemId, { ...example, isOwner: false });
  const view = render(<PlatformLostFoundScreen />);
  await openDetail(view);
  expect(view.queryByText('這是你的刊登')).toBeNull();
  expect(view.queryByRole('button', { name: '編輯這則刊登' })).toBeNull();
  expect(view.queryByRole('button', { name: '將這則刊登結案' })).toBeNull();
  expect(view.queryByRole('button', { name: '下架這則刊登' })).toBeNull();
});

test('changing Google accounts hides contacts immediately and suppresses a late previous-account detail response', async () => {
  const delayed = deferred<unknown>();
  const normal = mockRequest.getMockImplementation()!;
  mockRequest.mockImplementation((...args: unknown[]) =>
    args[0] === 'lost-found/get' && args[1] === 'context-a' ? delayed.promise : normal(...args),
  );
  const view = render(<PlatformLostFoundScreen />);
  fireEvent.press(await view.findByRole('button', { name: `查看平台刊登：${example.title}` }));
  await waitFor(() =>
    expect(mockRequest).toHaveBeenCalledWith('lost-found/get', 'context-a', expect.any(Object)),
  );
  mockAuth.session = { ...mockAuth.session!, platformAccountId: accountB, context: 'context-b' };
  records.clear();
  view.rerender(<PlatformLostFoundScreen />);
  await view.findByText('目前沒有符合條件的刊登');
  await act(async () =>
    delayed.resolve({ item: { ...example, contactInfo: 'previous-account-only' } }),
  );
  expect(view.queryByText('previous-account-only')).toBeNull();
});

test('a stale destructive confirmation is inert after an account or campus change', async () => {
  const view = render(<PlatformLostFoundScreen />);
  await openDetail(view);
  await waitFor(() =>
    expect(view.getByRole('button', { name: '下架這則刊登' })).not.toBeDisabled(),
  );
  fireEvent.press(view.getByRole('button', { name: '下架這則刊登' }));
  const confirm = jest
    .mocked(Alert.alert)
    .mock.calls.at(-1)?.[2]
    ?.find((button) => button.style !== 'cancel')?.onPress;
  mockSchool = { id: 'nthu', name: '國立清華大學' };
  view.rerender(<PlatformLostFoundScreen />);
  await act(async () => confirm?.());
  expect(mockRequest.mock.calls.some(([path]) => path === 'lost-found/remove')).toBe(false);
});

test('a late create receipt does not display success in a new Google session', async () => {
  const delayed = deferred<unknown>();
  const normal = mockRequest.getMockImplementation()!;
  mockRequest.mockImplementation((...args: unknown[]) =>
    args[0] === 'lost-found/create' ? delayed.promise : normal(...args),
  );
  const view = render(<PlatformLostFoundScreen />);
  await fillCreate(view);
  fireEvent.press(view.getByRole('button', { name: '確認刊登' }));
  await waitFor(() =>
    expect(mockRequest.mock.calls.some(([path]) => path === 'lost-found/create')).toBe(true),
  );
  const input = mockRequest.mock.calls.find(([path]) => path === 'lost-found/create')![2];
  mockAuth.session = { ...mockAuth.session!, platformAccountId: accountB, context: 'context-b' };
  records.clear();
  view.rerender(<PlatformLostFoundScreen />);
  await act(async () => delayed.resolve({ item: { ...example, ...input.fields, id: input.id } }));
  expect(view.queryByText('已完成刊登。')).toBeNull();
  expect(view.queryByLabelText('聯絡方式')).toBeNull();
  expect(
    (await readPlatformLostFoundDeviceState({ accountId: accountA, schoolId: 'pu' }, () => true))
      .pending?.action,
  ).toBe('create');
  expect(
    (await readPlatformLostFoundDeviceState({ accountId: accountB, schoolId: 'pu' }, () => true))
      .pending,
  ).toBeNull();
});

test('a focus change prevents an old list response from returning on focus ABA', async () => {
  const delayed = deferred<unknown>();
  mockRequest.mockReturnValueOnce(delayed.promise);
  const view = render(<PlatformLostFoundScreen />);
  await waitFor(() => expect(mockRequest).toHaveBeenCalled());
  mockFocused = false;
  view.rerender(<PlatformLostFoundScreen />);
  records.clear();
  mockFocused = true;
  view.rerender(<PlatformLostFoundScreen />);
  await view.findByText('目前沒有符合條件的刊登');
  await act(async () =>
    delayed.resolve({ schoolId: 'pu', items: [summary(example)], nextCursor: null }),
  );
  expect(view.queryByText(example.title)).toBeNull();
});

test('my listings export uses authenticated owner data and shares only the explicit selected-campus export', async () => {
  const view = render(<PlatformLostFoundScreen />);
  await view.findByRole('button', { name: `查看平台刊登：${example.title}` });
  fireEvent.press(
    within(view.getByTestId('platform-lost-found-owner-filter')).getByRole('button', {
      name: '我的刊登',
    }),
  );
  fireEvent.press(await view.findByRole('button', { name: '匯出本校的本人刊登' }));
  await waitFor(() => expect(Share.share).toHaveBeenCalledTimes(1));
  const shared = jest.mocked(Share.share).mock.calls[0][0];
  expect('message' in shared && JSON.parse(shared.message).items).toEqual([example]);
  expect(mockRequest).toHaveBeenCalledWith('lost-found/export', 'context-a', { schoolId: 'pu' });
});

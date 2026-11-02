import React from 'react';
import { Alert, Modal as NativeModal, Text, TextInput, TouchableWithoutFeedback, View } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AgentDraftProvider, useOptionalAgentDrafts, type AgentDraftContextValue } from '../../state/AgentDraftProvider';
import { SchoolProvider, useSchool } from '../../state/school';
import { clearCacheExceptSchool } from '../../data/cachedSource';
import { aiOverlay } from '../../app/useAIOverlay';
import { AIOverlayHost } from '../../components/AIOverlayHost';

let mockAuth: { user: { uid: string } | null; loading: boolean; tokenExpired: boolean; error: string | null };
let mockNuni: { session: { platformAccountId: string; context: string; isPlatformOperator?: boolean } | null; loading: boolean; error: string; pendingLogout: boolean };
jest.mock('../../state/auth', () => ({ useAuth: () => mockAuth }));
jest.mock('../../state/nuniSession', () => ({ useOptionalNuniSession: () => mockNuni }));
jest.mock('../../data/cachedSource', () => ({ clearCacheExceptSchool: jest.fn(async () => {}) }));
jest.mock('../../data/hybridSource', () => ({ setHybridSourceSchoolContext: jest.fn() }));
jest.mock('../../ui/theme', () => ({ ...jest.requireActual('../../ui/theme'), registerSchoolTheme: jest.fn(), applySchoolTheme: jest.fn() }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
const mockOverlayRenders: Array<{ owner: string; prompt: string; key: string }> = [];
jest.mock('../../screens/CampusAssistantScreen', () => ({
  CampusAssistantScreen: ({ route }: { route: { key: string; params: { prompt: string } } }) => {
    const owner = require('../../state/AgentDraftProvider').useOptionalAgentDrafts().ownerKey;
    mockOverlayRenders.push({ owner, prompt: route.params.prompt, key: route.key });
    return require('react').createElement(require('react-native').Text, null, route.params.prompt);
  },
}));
let latest: AgentDraftContextValue;
let selection: ReturnType<typeof useSchool>;
function Probe() {
  latest = useOptionalAgentDrafts()!;
  selection = useSchool();
  return <View><Text>{selection.school.id}</Text><TextInput accessibilityLabel="草稿" value={latest.navigation} onChangeText={(text) => latest.setDraft('navigation', text)} /></View>;
}
function App({ visible = true }: { visible?: boolean }) {
  return <SchoolProvider><AgentDraftProvider><AIOverlayHost />{visible ? <Probe /> : null}</AgentDraftProvider></SchoolProvider>;
}
const refresh = (view: ReturnType<typeof render>) => view.rerender(<App />);
beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  mockAuth = { user: { uid: 'A' }, loading: false, tokenExpired: false, error: null };
  mockNuni = { session: { platformAccountId: 'nuni-A', context: 'a1' }, loading: false, error: '', pendingLogout: false };
  aiOverlay.close();
  mockOverlayRenders.length = 0;
});
afterEach(() => jest.restoreAllMocks());

async function started() {
  const view = render(<App />);
  await waitFor(() => expect(AsyncStorage.setItem).toHaveBeenCalled());
  fireEvent.changeText(view.getByLabelText('草稿'), '從圖書館到活動中心');
  return view;
}

test('same owner retains memory through consumer unmount; there is no draft storage write', async () => {
  const view = await started();
  const writes = jest.mocked(AsyncStorage.setItem).mock.calls.length;
  act(() => latest.retainQuota(Date.now() + 30_000));
  const deadline = latest.retryReadyAt;
  view.rerender(<App visible={false} />);
  view.rerender(<App />);
  expect(latest.navigation).toBe('從圖書館到活動中心');
  expect(latest.retryReadyAt).toBe(deadline);
  expect(AsyncStorage.setItem).toHaveBeenCalledTimes(writes);
});

test('native foreground refresh pauses access and invalidates work without clearing same-account text', async () => {
  const view = await started();
  const before = latest;
  mockNuni = { ...mockNuni, session: null, loading: true };
  refresh(view);
  expect(latest.ready).toBe(false);
  expect(latest.navigation).toBe('');
  expect(before.isCurrent()).toBe(false);
  act(() => before.setDraft('navigation', 'late overwrite'));
  mockNuni = { ...mockNuni, loading: false, session: { platformAccountId: 'nuni-A', context: 'a2', isPlatformOperator: true } };
  refresh(view);
  expect(latest.navigation).toBe('從圖書館到活動中心');
  expect(latest.ready).toBe(true);
});

test.each(['firebase', 'nuni', 'logout'])('%s identity change clears text and quota; ABA cannot revive them', async (kind) => {
  const view = await started();
  act(() => latest.retainQuota(Date.now() + 30_000));
  const old = latest;
  if (kind === 'firebase') mockAuth = { ...mockAuth, user: { uid: 'B' } };
  else mockNuni = { ...mockNuni, session: kind === 'logout' ? null : { platformAccountId: 'nuni-B', context: 'b1' } };
  refresh(view);
  expect(latest.navigation).toBe('');
  expect(latest.retryReadyAt).toBeNull();
  mockAuth = { ...mockAuth, user: { uid: 'A' } };
  mockNuni = { ...mockNuni, session: { platformAccountId: 'nuni-A', context: 'a3' } };
  refresh(view);
  act(() => { old.setDraft('navigation', 'old A'); old.retainQuota(Date.now() + 99_000); });
  expect(latest.navigation).toBe('');
  expect(latest.retryReadyAt).toBeNull();
});

test('same account role refresh invalidates work without clearing text', async () => {
  const view = await started();
  const prior = latest;
  mockNuni = { ...mockNuni, session: { ...mockNuni.session, isPlatformOperator: true } };
  refresh(view);
  expect(latest.navigation).toBe('從圖書館到活動中心');
  expect(prior.isCurrent()).toBe(false);
});

test('cancel or dismiss a campus change leaves selected school, draft, cache and storage untouched', async () => {
  const view = await started();
  const writes = jest.mocked(AsyncStorage.setItem).mock.calls.length;
  const clears = jest.mocked(clearCacheExceptSchool).mock.calls.length;
  let decision!: Promise<boolean>;
  act(() => { decision = selection.setSelection({ schoolId: 'nthu', code: 'NTHU' }); });
  expect(selection.school.id).toBe('pu');
  expect(AsyncStorage.setItem).toHaveBeenCalledTimes(writes);
  expect(clearCacheExceptSchool).toHaveBeenCalledTimes(clears);
  await act(async () => { fireEvent.press(view.getByRole('button', { name: '取消' })); expect(await decision).toBe(false); });
  expect(latest.navigation).toBe('從圖書館到活動中心');
  expect(view.getByText('pu')).toBeTruthy();
  act(() => { decision = selection.setSelection({ schoolId: 'nthu', code: 'NTHU' }); });
  await act(async () => { view.UNSAFE_getByType(NativeModal).props.onRequestClose(); expect(await decision).toBe(false); });
  expect(AsyncStorage.setItem).toHaveBeenCalledTimes(writes);
  expect(clearCacheExceptSchool).toHaveBeenCalledTimes(clears);
});

test('confirmed campus change commits once after confirmation, clearing drafts and late callbacks', async () => {
  const view = await started();
  const old = latest;
  const writes = jest.mocked(AsyncStorage.setItem).mock.calls.length;
  let first!: Promise<boolean>; let duplicate!: Promise<boolean>;
  act(() => {
    first = selection.setSelection({ schoolId: 'nthu', code: 'NTHU' });
    duplicate = selection.setSelection({ schoolId: 'nthu', code: 'NTHU' });
  });
  expect(duplicate).toBe(first);
  expect(view.getAllByText('切換校園？')).toHaveLength(1);
  expect(AsyncStorage.setItem).toHaveBeenCalledTimes(writes);
  await act(async () => { fireEvent.press(view.getByRole('button', { name: '清除草稿並切換' })); expect(await first).toBe(true); });
  expect(selection.school.id).toBe('nthu');
  expect(latest.navigation).toBe('');
  expect(clearCacheExceptSchool).toHaveBeenCalledWith('nthu');
  act(() => old.setDraft('navigation', 'late old campus'));
  expect(latest.navigation).toBe('');
});

test('an account change while confirmation is open invalidates its acceptance', async () => {
  const view = await started();
  let decision!: Promise<boolean>;
  act(() => { decision = selection.setSelection({ schoolId: 'nthu', code: 'NTHU' }); });
  mockAuth = { ...mockAuth, user: { uid: 'B' } };
  refresh(view);
  await act(async () => { expect(await decision).toBe(false); });
  expect(view.queryByText('切換校園？')).toBeNull();
  expect(selection.school.id).toBe('pu');
  expect(latest.navigation).toBe('');
});

test('a route entry is consumed once and cannot overwrite newer text or survive an owner ABA', async () => {
  const view = await started();
  act(() => latest.consumePrompt('route-key-1', 'old route text'));
  expect(latest.navigation).toBe('從圖書館到活動中心');
  mockAuth = { ...mockAuth, user: { uid: 'B' } }; refresh(view);
  mockAuth = { ...mockAuth, user: { uid: 'A' } }; refresh(view);
  act(() => latest.consumePrompt('route-key-1', 'old route text'));
  expect(latest.navigation).toBe('');
  act(() => latest.consumePrompt('route-key-2', 'new explicit entry'));
  expect(latest.navigation).toBe('new explicit entry');
});

test('overlay owner changes close old entries; new opens have a new generation and binding', async () => {
  const view = await started();
  act(() => aiOverlay.open({ prompt: 'A prompt' }));
  const first = aiOverlay.getState();
  expect(first.scopeOwner).toBe(latest.ownerKey);
  mockAuth = { ...mockAuth, user: { uid: 'B' } }; refresh(view);
  expect(aiOverlay.getState().visible).toBe(false);
  expect(aiOverlay.getState().initialPrompt).toBeUndefined();
  act(() => aiOverlay.open({ prompt: 'B prompt' }));
  expect(aiOverlay.getState().entryId).not.toBe(first.entryId);
  expect(aiOverlay.getState().scopeOwner).toBe(latest.ownerKey);
});

test('an old provider callback is inert after its provider is unmounted', async () => {
  const view = await started();
  const old = latest;
  view.unmount();
  expect(old.isCurrent()).toBe(false);
  act(() => { old.setDraft('navigation', 'late unmounted'); old.retainQuota(Date.now() + 30_000); });
  const next = await started();
  expect(latest.retryReadyAt).toBeNull();
  expect(latest.navigation).toBe('從圖書館到活動中心');
  next.unmount();
});

test('a newer campus request replaces the old confirmation without committing it', async () => {
  const view = await started();
  let first!: Promise<boolean>; let second!: Promise<boolean>;
  act(() => {
    first = selection.setSelection({ schoolId: 'nthu', code: 'NTHU' });
    second = selection.setSelection({ schoolId: 'ncku', code: 'NCKU' });
  });
  await act(async () => { expect(await first).toBe(false); });
  expect(selection.school.id).toBe('pu');
  await act(async () => { fireEvent.press(view.getByRole('button', { name: '清除草稿並切換' })); expect(await second).toBe(true); });
  expect(selection.school.id).toBe('ncku');
});


test('overlay host never renders the former principal prompt in the next owner scope', async () => {
  const view = await started();
  act(() => aiOverlay.open({ prompt: '只有 A 的文字' }));
  expect(view.getByText('只有 A 的文字')).toBeTruthy();
  const oldKey = aiOverlay.getState().entryId;
  mockAuth = { ...mockAuth, user: { uid: 'B' } };
  refresh(view);
  const nextOwner = latest.ownerKey;
  expect(view.queryByText('只有 A 的文字')).toBeNull();
  expect(mockOverlayRenders.some((entry) => entry.owner === nextOwner && entry.prompt === '只有 A 的文字')).toBe(false);
  act(() => aiOverlay.open({ prompt: 'B 的新需求' }));
  expect(view.getByText('B 的新需求')).toBeTruthy();
  expect(aiOverlay.getState().entryId).not.toBe(oldKey);
});

test('overlay same-account background refresh hides its active screen and retains the draft', async () => {
  const view = await started();
  act(() => aiOverlay.open({ prompt: '預覽用提示' }));
  const before = aiOverlay.getState();
  mockNuni = { ...mockNuni, session: null, loading: true };
  refresh(view);
  expect(view.queryByText('預覽用提示')).toBeNull();
  mockNuni = { ...mockNuni, loading: false, session: { platformAccountId: 'nuni-A', context: 'a2' } };
  refresh(view);
  expect(view.getByText('預覽用提示')).toBeTruthy();
  expect(latest.navigation).toBe('從圖書館到活動中心');
  expect(aiOverlay.getState().entryId).toBe(before.entryId);
});

test('a real product modal offers a usable campus decision even when native Alert is unavailable', async () => {
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const view = await started();
  let decision!: Promise<boolean>;
  act(() => { decision = selection.setSelection({ schoolId: 'nthu', code: 'NTHU' }); });
  expect(view.getByText('切換校園？')).toBeTruthy();
  await act(async () => { fireEvent.press(view.getByRole('button', { name: '取消' })); expect(await decision).toBe(false); });
  expect(selection.school.id).toBe('pu');
});

test('unmounting the confirmation provider resolves the requested switch as canceled', async () => {
  const view = await started();
  let decision!: Promise<boolean>;
  act(() => { decision = selection.setSelection({ schoolId: 'nthu', code: 'NTHU' }); });
  view.unmount();
  expect(await decision).toBe(false);
  expect(clearCacheExceptSchool).not.toHaveBeenCalled();
});

test('double confirming a rendered modal commits one school change', async () => {
  const view = await started();
  let decision!: Promise<boolean>;
  act(() => { decision = selection.setSelection({ schoolId: 'nthu', code: 'NTHU' }); });
  const confirm = view.getByRole('button', { name: '清除草稿並切換' });
  await act(async () => { fireEvent.press(confirm); fireEvent.press(confirm); expect(await decision).toBe(true); });
  expect(clearCacheExceptSchool).toHaveBeenCalledTimes(1);
  expect(selection.school.id).toBe('nthu');
});

test('a pending route prompt cannot move to another account or return through ABA', async () => {
  const view = await started();
  act(() => { latest.setDraft('navigation', ''); latest.setDraft('saved', ''); });
  mockNuni = { ...mockNuni, session: null, loading: true }; refresh(view);
  act(() => latest.consumePrompt('delayed-route-A', 'A 尚未顯示的提示'));
  mockNuni = { ...mockNuni, session: { platformAccountId: 'nuni-B', context: 'b1' }, loading: false }; refresh(view);
  expect(latest.navigation).toBe('');
  mockNuni = { ...mockNuni, session: { platformAccountId: 'nuni-A', context: 'a2' } }; refresh(view);
  act(() => latest.consumePrompt('delayed-route-A', 'A 尚未顯示的提示'));
  expect(latest.navigation).toBe('');
});


test.each(['close', 'backdrop', 'request-close'])('%s cancels the product modal before any campus storage or cache mutation', async (action) => {
  const view = await started();
  const writes = jest.mocked(AsyncStorage.setItem).mock.calls.length;
  let decision!: Promise<boolean>;
  act(() => { decision = selection.setSelection({ schoolId: 'nthu', code: 'NTHU' }); });
  await act(async () => {
    if (action === 'close') fireEvent.press(view.getByRole('button', { name: '關閉' }));
    else if (action === 'backdrop') fireEvent.press(view.UNSAFE_getByType(TouchableWithoutFeedback));
    else view.UNSAFE_getByType(NativeModal).props.onRequestClose();
    expect(await decision).toBe(false);
  });
  expect(selection.school.id).toBe('pu');
  expect(latest.navigation).toBe('從圖書館到活動中心');
  expect(AsyncStorage.setItem).toHaveBeenCalledTimes(writes);
  expect(clearCacheExceptSchool).not.toHaveBeenCalled();
});

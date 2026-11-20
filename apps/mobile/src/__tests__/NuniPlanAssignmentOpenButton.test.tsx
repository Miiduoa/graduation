import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { NuniPlanAssignmentOpenButton } from '../screens/NuniPlanAssignmentOpenButton';
import type {
  NuniPlanAssignmentSource, NuniPlanAssignmentTargetInput, NuniPlanAssignmentTargetResult,
} from '../services/nuniPlanAssignmentTarget';
import { safeNavigate } from '../utils/safeNavigate';

jest.mock('../utils/safeNavigate', () => ({ safeNavigate: jest.fn(() => true) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

const source: NuniPlanAssignmentSource = {
  accountId: 'student-a', schoolId: 'pu', academicYear: '115', semester: '1',
  workspaceId: 'database-course', assignmentId: 'term-report',
};
function ready(locator = source): NuniPlanAssignmentTargetResult {
  return { kind: 'ready', params: { tab: 'courses', workspaceId: locator.workspaceId,
    assignmentId: locator.assignmentId, assistantAccountId: locator.accountId } };
}
function props() {
  return {
    assignment: { title: '期末報告', groupName: '資料庫', dueAt: null, nuniSource: { ...source } },
    context: {
      accountId: source.accountId, schoolId: source.schoolId, isCurrent: jest.fn(() => true),
      request: jest.fn(async () => ({})), bffRequest: jest.fn(async () => ({})),
      readTarget: jest.fn(async (_input: NuniPlanAssignmentTargetInput): Promise<NuniPlanAssignmentTargetResult> => ready()),
    },
    navigation: { navigate: jest.fn() }, disabled: false,
  };
}
function deferred() {
  let resolve!: (result: NuniPlanAssignmentTargetResult) => void;
  const promise = new Promise<NuniPlanAssignmentTargetResult>((yes) => { resolve = yes; });
  return { promise, resolve };
}

function focusNavigation() {
  let focused = true;
  const listeners = { focus: new Set<() => void>(), blur: new Set<() => void>() };
  const unsubscribe: jest.Mock[] = [];
  const navigation = {
    navigate: jest.fn(), isFocused: jest.fn(() => focused),
    addListener: jest.fn((event: 'focus' | 'blur', listener: () => void) => {
      listeners[event].add(listener);
      const remove = jest.fn(() => { listeners[event].delete(listener); });
      unsubscribe.push(remove);
      return remove;
    }),
  };
  return { navigation, unsubscribe, listeners, emit: (event: 'focus' | 'blur') => {
    focused = event === 'focus';
    listeners[event].forEach((listener) => listener());
  } };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(safeNavigate).mockReset().mockReturnValue(true);
});

test.each([
  undefined,
  { ...source, accountId: 'student-b' },
  { ...source, schoolId: 'nthu' },
  { ...source, workspaceId: '' },
  { ...source, assignmentId: '   ' },
  { ...source, academicYear: '' },
  { ...source, semester: null as never },
])('missing, incomplete or foreign live locators expose no assignment action: %j', (nuniSource) => {
  const input = props();
  const view = render(<NuniPlanAssignmentOpenButton {...input} assignment={{ ...input.assignment, nuniSource }} />);
  expect(view.queryByRole('button')).toBeNull();
  expect(input.context.readTarget).not.toHaveBeenCalled();
  expect(safeNavigate).not.toHaveBeenCalled();
});

test('an expired context or missing navigator never exposes an unusable direct action', () => {
  const input = props();
  input.context.isCurrent.mockReturnValue(false);
  const view = render(<NuniPlanAssignmentOpenButton {...input} />);
  expect(view.queryByRole('button')).toBeNull();
  input.context.isCurrent.mockReturnValue(true);
  view.rerender(<NuniPlanAssignmentOpenButton {...input} navigation={undefined} />);
  expect(view.queryByRole('button')).toBeNull();
  expect(input.context.readTarget).not.toHaveBeenCalled();
});

test('a disabled action cannot start a source read', () => {
  const input = props();
  const view = render(<NuniPlanAssignmentOpenButton {...input} disabled />);
  fireEvent.press(view.getByRole('button', { name: '查看這份作業' }));
  expect(input.context.readTarget).not.toHaveBeenCalled();
  expect(safeNavigate).not.toHaveBeenCalled();
});

test('only a press starts verification, repeated presses share one read, and only the exact result navigates', async () => {
  const input = props();
  const pending = deferred();
  input.context.readTarget.mockReturnValueOnce(pending.promise);
  const view = render(<NuniPlanAssignmentOpenButton {...input} />);
  expect(input.context.readTarget).not.toHaveBeenCalled();
  const button = view.getByRole('button', { name: '查看這份作業' });
  act(() => { fireEvent.press(button); fireEvent.press(button); });
  expect(input.context.readTarget).toHaveBeenCalledTimes(1);
  expect(view.getByRole('button', { name: '正在核對作業…' }).props.accessibilityState.disabled).toBe(true);
  expect(safeNavigate).not.toHaveBeenCalled();
  const capture = input.context.readTarget.mock.calls[0][0];
  expect(capture).toMatchObject({ source, accountId: source.accountId, schoolId: source.schoolId,
    request: input.context.request, bffRequest: input.context.bffRequest });
  expect(capture.source).not.toBe(input.assignment.nuniSource);
  expect(capture.signal?.aborted).toBe(false);
  expect(capture.isCurrent()).toBe(true);

  await act(async () => pending.resolve(ready()));
  expect(safeNavigate).toHaveBeenCalledTimes(1);
  expect(safeNavigate).toHaveBeenCalledWith(input.navigation, 'NuniWorkspace', {
    tab: 'courses', workspaceId: source.workspaceId, assignmentId: source.assignmentId,
    assistantAccountId: source.accountId,
  }, { fallbackMessage: null });
  expect(view.getByRole('button', { name: '查看這份作業' })).toBeTruthy();
  expect(view.queryByRole('alert')).toBeNull();
});

test.each([
  ['changed', '作業來源或課程連結已變更，請重新核對，或從課程與作業入口確認。'],
  ['unavailable', '暫時無法核對這份作業，請稍後重試，或從課程與作業入口確認。'],
  ['session-changed', '登入狀態已變更，請重新登入後核對這份作業。'],
  ['cancelled', '已取消核對，可重新確認這份作業。'],
] as const)('a %s result stays on this row and allows a fresh retry of the same locator', async (kind, message) => {
  const input = props();
  input.context.readTarget.mockResolvedValueOnce({ kind });
  const view = render(<NuniPlanAssignmentOpenButton {...input} />);
  await act(async () => fireEvent.press(view.getByRole('button', { name: '查看這份作業' })));
  expect(view.getByRole('alert').props.children).toBe(message);
  expect(safeNavigate).not.toHaveBeenCalled();
  await act(async () => fireEvent.press(view.getByRole('button', { name: '重新核對這份作業' })));
  expect(input.context.readTarget).toHaveBeenCalledTimes(2);
  expect(input.context.readTarget.mock.calls[1][0].source).toEqual(source);
  expect(safeNavigate).toHaveBeenCalledTimes(1);
  expect(view.queryByRole('alert')).toBeNull();
});

test('a rejected request has an inline retry instead of an unhandled rejection or a false open', async () => {
  const input = props();
  input.context.readTarget.mockRejectedValueOnce(new Error('network unavailable'));
  const view = render(<NuniPlanAssignmentOpenButton {...input} />);
  await act(async () => fireEvent.press(view.getByRole('button', { name: '查看這份作業' })));
  expect(view.getByText('暫時無法核對這份作業，請稍後重試，或從課程與作業入口確認。')).toBeTruthy();
  expect(safeNavigate).not.toHaveBeenCalled();
  await act(async () => fireEvent.press(view.getByRole('button', { name: '重新核對這份作業' })));
  expect(input.context.readTarget).toHaveBeenCalledTimes(2);
  expect(safeNavigate).toHaveBeenCalledTimes(1);
});

test('a navigation failure is retriable and the retry verifies again instead of caching permission', async () => {
  const input = props();
  jest.mocked(safeNavigate).mockReturnValueOnce(false);
  const view = render(<NuniPlanAssignmentOpenButton {...input} />);
  await act(async () => fireEvent.press(view.getByRole('button', { name: '查看這份作業' })));
  expect(view.getByText('目前無法開啟這份作業，請重試，或從課程與作業入口確認。')).toBeTruthy();
  await act(async () => fireEvent.press(view.getByRole('button', { name: '重新核對這份作業' })));
  expect(input.context.readTarget).toHaveBeenCalledTimes(2);
  expect(safeNavigate).toHaveBeenCalledTimes(2);
  expect(view.queryByRole('alert')).toBeNull();
});

test.each([
  { assignmentId: 'another-assignment' }, { workspaceId: 'another-course' },
  { assistantAccountId: 'student-b' }, { tab: 'students' as never },
])('even a ready result cannot redirect the selected locator: %j', async (patch) => {
  const input = props();
  const result = ready();
  if (result.kind !== 'ready') throw new Error('fixture');
  input.context.readTarget.mockResolvedValueOnce({ ...result, params: { ...result.params, ...patch } });
  const view = render(<NuniPlanAssignmentOpenButton {...input} />);
  await act(async () => fireEvent.press(view.getByRole('button', { name: '查看這份作業' })));
  expect(safeNavigate).not.toHaveBeenCalled();
  expect(view.getByText('作業來源或課程連結已變更，請重新核對，或從課程與作業入口確認。')).toBeTruthy();
});

test.each([
  { accountId: 'student-b' }, { schoolId: 'nthu' },
  { workspaceId: 'another-course' }, { assignmentId: 'another-assignment' },
])('changing scope or locator aborts the prior attempt and permits the new row: %j', async (patch) => {
  const input = props();
  const pending = deferred();
  const changed = { ...source, ...patch };
  input.context.readTarget.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(ready(changed));
  const view = render(<NuniPlanAssignmentOpenButton {...input} />);
  act(() => fireEvent.press(view.getByRole('button', { name: '查看這份作業' })));
  const capture = input.context.readTarget.mock.calls[0][0];
  view.rerender(<NuniPlanAssignmentOpenButton {...input}
    assignment={{ ...input.assignment, nuniSource: changed }}
    context={{ ...input.context, accountId: changed.accountId, schoolId: changed.schoolId }} />);
  expect(capture.signal?.aborted).toBe(true);
  expect(capture.isCurrent()).toBe(false);
  await act(async () => pending.resolve(ready()));
  expect(safeNavigate).not.toHaveBeenCalled();
  await act(async () => fireEvent.press(view.getByRole('button', { name: '查看這份作業' })));
  expect(input.context.readTarget).toHaveBeenCalledTimes(2);
  expect(safeNavigate).toHaveBeenCalledWith(input.navigation, 'NuniWorkspace', expect.objectContaining({
    workspaceId: changed.workspaceId, assignmentId: changed.assignmentId, assistantAccountId: changed.accountId,
  }), { fallbackMessage: null });
});

test('a revoked session blocks a late ready response even before the parent rerenders', async () => {
  const input = props();
  const pending = deferred();
  input.context.readTarget.mockReturnValueOnce(pending.promise);
  const view = render(<NuniPlanAssignmentOpenButton {...input} />);
  act(() => fireEvent.press(view.getByRole('button', { name: '查看這份作業' })));
  const capture = input.context.readTarget.mock.calls[0][0];
  input.context.isCurrent.mockReturnValue(false);
  expect(capture.isCurrent()).toBe(false);
  await act(async () => pending.resolve(ready()));
  expect(safeNavigate).not.toHaveBeenCalled();
  expect(view.queryByRole('button')).toBeNull();
});

test.each(['disabled', 'unmount', 'expired'] as const)('%s aborts a pending verification and discards its late response', async (change) => {
  const input = props();
  const pending = deferred();
  input.context.readTarget.mockReturnValueOnce(pending.promise);
  const view = render(<NuniPlanAssignmentOpenButton {...input} />);
  act(() => fireEvent.press(view.getByRole('button', { name: '查看這份作業' })));
  const capture = input.context.readTarget.mock.calls[0][0];
  if (change === 'unmount') view.unmount();
  else {
    if (change === 'expired') input.context.isCurrent.mockReturnValue(false);
    view.rerender(<NuniPlanAssignmentOpenButton {...input} disabled={change === 'disabled'} />);
  }
  expect(capture.signal?.aborted).toBe(true);
  expect(capture.isCurrent()).toBe(false);
  await act(async () => pending.resolve(ready()));
  expect(safeNavigate).not.toHaveBeenCalled();
});

test.each([false, true])('leaving the still-mounted assistant revokes the old tap, including returning before ready: %s', async (returnBeforeReady) => {
  const input = props();
  const nav = focusNavigation();
  const pending = deferred();
  input.context.readTarget.mockReturnValueOnce(pending.promise);
  const view = render(<NuniPlanAssignmentOpenButton {...input} navigation={nav.navigation} />);
  act(() => fireEvent.press(view.getByRole('button', { name: '查看這份作業' })));
  const capture = input.context.readTarget.mock.calls[0][0];
  act(() => nav.emit('blur'));
  expect(capture.signal?.aborted).toBe(true);
  expect(capture.isCurrent()).toBe(false);
  expect(view.queryByRole('button', { name: '正在核對作業…' })).toBeNull();
  fireEvent.press(view.getByRole('button', { name: '查看這份作業' }));
  expect(input.context.readTarget).toHaveBeenCalledTimes(1);
  if (returnBeforeReady) act(() => nav.emit('focus'));
  await act(async () => pending.resolve(ready()));
  expect(capture.isCurrent()).toBe(false);
  expect(safeNavigate).not.toHaveBeenCalled();
});

test('returning allows a new tap, and the retired response cannot navigate or clear the newer pending state', async () => {
  const input = props();
  const nav = focusNavigation();
  const oldRead = deferred();
  const newRead = deferred();
  input.context.readTarget.mockReturnValueOnce(oldRead.promise).mockReturnValueOnce(newRead.promise);
  const view = render(<NuniPlanAssignmentOpenButton {...input} navigation={nav.navigation} />);
  act(() => fireEvent.press(view.getByRole('button', { name: '查看這份作業' })));
  const oldCapture = input.context.readTarget.mock.calls[0][0];
  act(() => { nav.emit('blur'); nav.emit('focus'); });
  act(() => fireEvent.press(view.getByRole('button', { name: '查看這份作業' })));
  expect(input.context.readTarget).toHaveBeenCalledTimes(2);
  const newCapture = input.context.readTarget.mock.calls[1][0];
  expect(oldCapture.signal?.aborted).toBe(true);
  expect(newCapture.signal?.aborted).toBe(false);
  await act(async () => oldRead.resolve(ready()));
  expect(safeNavigate).not.toHaveBeenCalled();
  expect(newCapture.isCurrent()).toBe(true);
  expect(view.getByRole('button', { name: '正在核對作業…' })).toBeTruthy();
  await act(async () => newRead.resolve(ready()));
  expect(safeNavigate).toHaveBeenCalledTimes(1);
  expect(safeNavigate).toHaveBeenCalledWith(nav.navigation, 'NuniWorkspace', expect.objectContaining({
    assignmentId: source.assignmentId, assistantAccountId: source.accountId,
  }), { fallbackMessage: null });
});

test('isFocused blocks start and late completion even when the navigator has no event subscription API', async () => {
  const input = props();
  const navigation = { ...input.navigation, isFocused: jest.fn(() => false) };
  const pending = deferred();
  input.context.readTarget.mockReturnValueOnce(pending.promise);
  const view = render(<NuniPlanAssignmentOpenButton {...input} navigation={navigation} />);
  fireEvent.press(view.getByRole('button', { name: '查看這份作業' }));
  expect(input.context.readTarget).not.toHaveBeenCalled();
  navigation.isFocused.mockReturnValue(true);
  act(() => fireEvent.press(view.getByRole('button', { name: '查看這份作業' })));
  navigation.isFocused.mockReturnValue(false);
  await act(async () => pending.resolve(ready()));
  expect(safeNavigate).not.toHaveBeenCalled();
  navigation.isFocused.mockReturnValue(true);
  await act(async () => fireEvent.press(view.getByRole('button', { name: '查看這份作業' })));
  expect(input.context.readTarget).toHaveBeenCalledTimes(2);
  expect(safeNavigate).toHaveBeenCalledTimes(1);
});

test('blur alone cancels the intent when only event listeners are available', async () => {
  const input = props();
  const nav = focusNavigation();
  const pending = deferred();
  input.context.readTarget.mockReturnValueOnce(pending.promise);
  const view = render(<NuniPlanAssignmentOpenButton {...input} navigation={{ ...nav.navigation, isFocused: undefined }} />);
  act(() => fireEvent.press(view.getByRole('button', { name: '查看這份作業' })));
  act(() => { nav.emit('blur'); nav.emit('focus'); });
  await act(async () => pending.resolve(ready()));
  expect(safeNavigate).not.toHaveBeenCalled();
});

test('changing navigator or unmounting removes both listeners and aborts their pending attempt', async () => {
  const input = props();
  const first = focusNavigation();
  const second = focusNavigation();
  const pending = deferred();
  input.context.readTarget.mockReturnValueOnce(pending.promise);
  const view = render(<NuniPlanAssignmentOpenButton {...input} navigation={first.navigation} />);
  act(() => fireEvent.press(view.getByRole('button', { name: '查看這份作業' })));
  const capture = input.context.readTarget.mock.calls[0][0];
  view.rerender(<NuniPlanAssignmentOpenButton {...input} navigation={second.navigation} />);
  expect(capture.signal?.aborted).toBe(true);
  expect(first.listeners.blur.size).toBe(0);
  expect(first.listeners.focus.size).toBe(0);
  for (const unsubscribe of first.unsubscribe) expect(unsubscribe).toHaveBeenCalledTimes(1);
  expect(second.listeners.blur.size).toBe(1);
  expect(second.listeners.focus.size).toBe(1);
  await act(async () => pending.resolve(ready()));
  expect(safeNavigate).not.toHaveBeenCalled();
  view.unmount();
  expect(second.listeners.blur.size).toBe(0);
  expect(second.listeners.focus.size).toBe(0);
  for (const unsubscribe of second.unsubscribe) expect(unsubscribe).toHaveBeenCalledTimes(1);
});

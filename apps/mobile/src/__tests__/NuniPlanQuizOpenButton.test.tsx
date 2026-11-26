import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { NuniPlanAssignmentOpenButton } from '../screens/NuniPlanAssignmentOpenButton';
import type {
  NuniPlanAssignmentTargetInput, NuniPlanAssignmentTargetResult, NuniPlanQuizSource, NuniPlanQuizTargetInput,
} from '../services/nuniPlanAssignmentTarget';
import { safeNavigate } from '../utils/safeNavigate';

jest.mock('../utils/safeNavigate', () => ({ safeNavigate: jest.fn(() => true) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const source: NuniPlanQuizSource = {
  accountId: 'pa_' + uuid(1), schoolId: 'pu', academicYear: '115', semester: '1',
  workspaceId: 'cw_' + uuid(1), quizId: 'cwq_' + uuid(1),
};
function ready(locator = source): NuniPlanAssignmentTargetResult {
  return { kind: 'ready', params: { tab: 'courses', workspaceId: locator.workspaceId,
    assignmentId: locator.quizId, assistantAccountId: locator.accountId } };
}
function props() {
  return {
    assignment: { kind: 'quiz' as const, title: '關聯模型練習', groupName: '資料庫管理', dueAt: null,
      nuniQuizSource: { ...source } },
    context: {
      accountId: source.accountId, schoolId: source.schoolId, isCurrent: jest.fn(() => true),
      request: jest.fn(async () => ({})), bffRequest: jest.fn(async () => ({})),
      readTarget: jest.fn(async (_input: NuniPlanAssignmentTargetInput): Promise<NuniPlanAssignmentTargetResult> => {
        throw new Error('A quiz must not use the assignment reader');
      }),
      readQuizTarget: jest.fn(async (_input: NuniPlanQuizTargetInput): Promise<NuniPlanAssignmentTargetResult> => ready()),
    },
    navigation: { navigate: jest.fn() }, disabled: false,
  };
}
function deferred() {
  let resolve!: (result: NuniPlanAssignmentTargetResult) => void;
  const promise = new Promise<NuniPlanAssignmentTargetResult>((accept) => { resolve = accept; });
  return { promise, resolve };
}
function focusNavigation() {
  let focused = true;
  const listeners = { focus: new Set<() => void>(), blur: new Set<() => void>() };
  return {
    navigation: {
      navigate: jest.fn(), isFocused: () => focused,
      addListener: (event: 'focus' | 'blur', listener: () => void) => {
        listeners[event].add(listener);
        return () => { listeners[event].delete(listener); };
      },
    },
    emit(event: 'focus' | 'blur') {
      focused = event === 'focus';
      listeners[event].forEach((listener) => listener());
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(safeNavigate).mockReset().mockReturnValue(true);
});

test('a quiz uses its own reader, ignores an assignment locator and verifies only once for repeated taps', async () => {
  const input = props();
  const pending = deferred();
  input.context.readQuizTarget.mockReturnValueOnce(pending.promise);
  const view = render(<NuniPlanAssignmentOpenButton {...input} assignment={{ ...input.assignment,
    nuniSource: { ...source, assignmentId: 'cwa_' + uuid(1) },
  }} />);
  expect(input.context.readQuizTarget).not.toHaveBeenCalled();
  expect(view.queryByRole('button', { name: '查看這份作業' })).toBeNull();
  const button = view.getByRole('button', { name: '查看這份測驗' });
  act(() => { fireEvent.press(button); fireEvent.press(button); });
  expect(input.context.readQuizTarget).toHaveBeenCalledTimes(1);
  expect(input.context.readTarget).not.toHaveBeenCalled();
  expect(view.getByRole('button', { name: '正在核對測驗…' })).toBeDisabled();
  const capture = input.context.readQuizTarget.mock.calls[0][0];
  expect(capture).toMatchObject({ source, accountId: source.accountId, schoolId: 'pu' });
  expect(capture.source).not.toBe(input.assignment.nuniQuizSource);
  await act(async () => pending.resolve(ready()));
  expect(safeNavigate).toHaveBeenCalledTimes(1);
  expect(safeNavigate).toHaveBeenCalledWith(input.navigation, 'NuniWorkspace', {
    tab: 'courses', workspaceId: source.workspaceId, assignmentId: source.quizId,
    assistantAccountId: source.accountId,
  }, { fallbackMessage: null });
  expect(view.getByText('開啟前會重新核對帳號、課程與測驗；作答與交卷由你決定。')).toBeTruthy();
  expect(input.context.request).not.toHaveBeenCalled();
  expect(input.context.bffRequest).not.toHaveBeenCalled();
});

test('an unavailable quiz reader or missing quiz locator never falls back to an assignment action', () => {
  const input = props();
  const view = render(<NuniPlanAssignmentOpenButton {...input}
    context={{ ...input.context, readQuizTarget: undefined }} />);
  expect(view.queryByRole('button')).toBeNull();
  view.rerender(<NuniPlanAssignmentOpenButton {...input} assignment={{ ...input.assignment,
    nuniQuizSource: undefined, nuniSource: { ...source, assignmentId: 'cwa_' + uuid(1) },
  }} />);
  expect(view.queryByRole('button')).toBeNull();
  expect(input.context.readQuizTarget).not.toHaveBeenCalled();
  expect(input.context.readTarget).not.toHaveBeenCalled();
});

test.each([{ accountId: 'pa_' + uuid(2) }, { schoolId: 'nthu' }])(
  'a quiz from another active scope has no opening action: %j', (patch) => {
    const input = props();
    const view = render(<NuniPlanAssignmentOpenButton {...input}
      assignment={{ ...input.assignment, nuniQuizSource: { ...source, ...patch } }} />);
    expect(view.queryByRole('button')).toBeNull();
    expect(input.context.readQuizTarget).not.toHaveBeenCalled();
  },
);

test.each([
  { assignmentId: 'cwa_' + uuid(1) },
  { assignmentId: 'cwq_' + uuid(2) },
  { workspaceId: 'cw_' + uuid(2) },
  { assistantAccountId: 'pa_' + uuid(2) },
])('a ready result cannot redirect the selected quiz to another activity or owner: %j', async (patch) => {
  const input = props();
  const result = ready();
  if (result.kind !== 'ready') throw new Error('Invalid fixture');
  input.context.readQuizTarget.mockResolvedValueOnce({ ...result, params: { ...result.params, ...patch } });
  const view = render(<NuniPlanAssignmentOpenButton {...input} />);
  await act(async () => fireEvent.press(view.getByRole('button', { name: '查看這份測驗' })));
  expect(safeNavigate).not.toHaveBeenCalled();
  expect(view.getByRole('alert').props.children).toBe('測驗來源或課程連結已變更，請重新核對，或從課程與作業入口確認。');
  expect(input.context.readTarget).not.toHaveBeenCalled();
});

test('a source failure stays on the quiz and retry performs a fresh check of the same quiz', async () => {
  const input = props();
  input.context.readQuizTarget.mockRejectedValueOnce(new Error('network unavailable'));
  const view = render(<NuniPlanAssignmentOpenButton {...input} />);
  await act(async () => fireEvent.press(view.getByRole('button', { name: '查看這份測驗' })));
  expect(view.getByRole('alert').props.children).toBe('暫時無法核對這份測驗，請稍後重試，或從課程與作業入口確認。');
  expect(safeNavigate).not.toHaveBeenCalled();
  await act(async () => fireEvent.press(view.getByRole('button', { name: '重新核對這份測驗' })));
  expect(input.context.readQuizTarget).toHaveBeenCalledTimes(2);
  expect(input.context.readQuizTarget.mock.calls.map(([lookup]) => lookup.source)).toEqual([source, source]);
  expect(safeNavigate).toHaveBeenCalledTimes(1);
  expect(view.queryByRole('alert')).toBeNull();
});

test('navigation failure does not cache quiz authority for the next tap', async () => {
  const input = props();
  jest.mocked(safeNavigate).mockReturnValueOnce(false);
  const view = render(<NuniPlanAssignmentOpenButton {...input} />);
  await act(async () => fireEvent.press(view.getByRole('button', { name: '查看這份測驗' })));
  expect(view.getByRole('alert').props.children).toBe('目前無法開啟這份測驗，請重試，或從課程與作業入口確認。');
  await act(async () => fireEvent.press(view.getByRole('button', { name: '重新核對這份測驗' })));
  expect(input.context.readQuizTarget).toHaveBeenCalledTimes(2);
  expect(safeNavigate).toHaveBeenCalledTimes(2);
});

test('switching to a namesake quiz revokes the old tap without clearing the new pending check', async () => {
  const input = props();
  const oldRead = deferred();
  const newRead = deferred();
  const next = { ...source, quizId: 'cwq_' + uuid(2) };
  input.context.readQuizTarget.mockReturnValueOnce(oldRead.promise).mockReturnValueOnce(newRead.promise);
  const view = render(<NuniPlanAssignmentOpenButton {...input} />);
  act(() => fireEvent.press(view.getByRole('button', { name: '查看這份測驗' })));
  const oldCapture = input.context.readQuizTarget.mock.calls[0][0];
  view.rerender(<NuniPlanAssignmentOpenButton {...input}
    assignment={{ ...input.assignment, nuniQuizSource: next }} />);
  expect(oldCapture.signal?.aborted).toBe(true);
  act(() => fireEvent.press(view.getByRole('button', { name: '查看這份測驗' })));
  await act(async () => oldRead.resolve(ready()));
  expect(safeNavigate).not.toHaveBeenCalled();
  expect(view.getByRole('button', { name: '正在核對測驗…' })).toBeTruthy();
  await act(async () => newRead.resolve(ready(next)));
  expect(safeNavigate).toHaveBeenCalledTimes(1);
  expect(safeNavigate).toHaveBeenCalledWith(input.navigation, 'NuniWorkspace', expect.objectContaining({
    assignmentId: next.quizId, assistantAccountId: source.accountId,
  }), { fallbackMessage: null });
});

test('switching account during a quiz check discards the late result', async () => {
  const input = props();
  const pending = deferred();
  input.context.readQuizTarget.mockReturnValueOnce(pending.promise);
  const view = render(<NuniPlanAssignmentOpenButton {...input} />);
  act(() => fireEvent.press(view.getByRole('button', { name: '查看這份測驗' })));
  const capture = input.context.readQuizTarget.mock.calls[0][0];
  view.rerender(<NuniPlanAssignmentOpenButton {...input}
    context={{ ...input.context, accountId: 'pa_' + uuid(2) }} />);
  expect(capture.signal?.aborted).toBe(true);
  expect(capture.isCurrent()).toBe(false);
  expect(view.queryByRole('button')).toBeNull();
  await act(async () => pending.resolve(ready()));
  expect(safeNavigate).not.toHaveBeenCalled();
});

test('blur revokes a still-mounted quiz check even after focus returns and a new check starts', async () => {
  const input = props();
  const nav = focusNavigation();
  const oldRead = deferred();
  const newRead = deferred();
  input.context.readQuizTarget.mockReturnValueOnce(oldRead.promise).mockReturnValueOnce(newRead.promise);
  const view = render(<NuniPlanAssignmentOpenButton {...input} navigation={nav.navigation} />);
  act(() => fireEvent.press(view.getByRole('button', { name: '查看這份測驗' })));
  const oldCapture = input.context.readQuizTarget.mock.calls[0][0];
  act(() => nav.emit('blur'));
  expect(oldCapture.signal?.aborted).toBe(true);
  fireEvent.press(view.getByRole('button', { name: '查看這份測驗' }));
  expect(input.context.readQuizTarget).toHaveBeenCalledTimes(1);
  act(() => nav.emit('focus'));
  act(() => fireEvent.press(view.getByRole('button', { name: '查看這份測驗' })));
  const newCapture = input.context.readQuizTarget.mock.calls[1][0];
  await act(async () => oldRead.resolve(ready()));
  expect(oldCapture.isCurrent()).toBe(false);
  expect(newCapture.isCurrent()).toBe(true);
  expect(safeNavigate).not.toHaveBeenCalled();
  expect(view.getByRole('button', { name: '正在核對測驗…' })).toBeTruthy();
  await act(async () => newRead.resolve(ready()));
  expect(safeNavigate).toHaveBeenCalledTimes(1);
  expect(safeNavigate).toHaveBeenCalledWith(nav.navigation, 'NuniWorkspace', expect.objectContaining({
    assignmentId: source.quizId,
  }), { fallbackMessage: null });
});

test('an unmounted quiz action cannot navigate when its source read eventually succeeds', async () => {
  const input = props();
  const pending = deferred();
  input.context.readQuizTarget.mockReturnValueOnce(pending.promise);
  const view = render(<NuniPlanAssignmentOpenButton {...input} />);
  act(() => fireEvent.press(view.getByRole('button', { name: '查看這份測驗' })));
  const capture = input.context.readQuizTarget.mock.calls[0][0];
  view.unmount();
  expect(capture.signal?.aborted).toBe(true);
  await act(async () => pending.resolve(ready()));
  expect(safeNavigate).not.toHaveBeenCalled();
});

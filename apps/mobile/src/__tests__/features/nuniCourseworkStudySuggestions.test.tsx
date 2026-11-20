import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAssistantCalendarReceipt } from '@campus/shared/src/assistantExecution';
import { NuniCourseworkStudyAction, type NuniCourseworkStudyActionProps } from '../../screens/NuniCourseworkStudyAction';
import {
  confirmCourseworkStudyDraft, findCourseworkStudyDrafts, prepareCourseworkStudyDraft,
  type CourseworkStudyDraft, type CourseworkStudySource,
} from '../../features/nuniCourseworkStudy';
import type { CourseworkRead } from '../../features/nuniCourseworkFollowUp';
import type { AssistantCalendarTask } from '../../services/assistantCalendarExecution';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../../firebase', () => ({
  getAuthInstance: () => ({ currentUser: null }), isFirebaseMockMode: () => false,
}));
jest.mock('../../features/nuniCourseworkStudy', () => {
  const actual = jest.requireActual<typeof import('../../features/nuniCourseworkStudy')>('../../features/nuniCourseworkStudy');
  return {
    ...actual,
    findCourseworkStudyDrafts: jest.fn(),
    confirmCourseworkStudyDraft: jest.fn(),
    prepareCourseworkStudyDraft: jest.fn(actual.prepareCourseworkStudyDraft),
  };
});

const find = jest.mocked(findCourseworkStudyDrafts);
const confirm = jest.mocked(confirmCourseworkStudyDraft);
const prepare = jest.mocked(prepareCourseworkStudyDraft);
const now = Date.parse('2026-11-08T02:00:00Z');
const checkedAt = '2026-11-08T02:00:00.000Z';
const availabilitySummary = '依已存課表與個人行程核對，這段時間可安排 30 分鐘準備。';
const finderLabel = '幫我找 30 分鐘空堂';
type FindResult = Awaited<ReturnType<typeof findCourseworkStudyDrafts>>;

function read(): CourseworkRead {
  return {
    anchor: { uid: '', owner: 'nuni:student-a', schoolId: 'pu', updatedAt: checkedAt, classes: [{
      courseId: 'db', name: '資料庫', date: '2026-11-08', term: '115|1', room: '305', startTime: '08:10', endTime: '10:00',
    }] },
    checkedAt,
    result: { kind: 'assignments', workspace: { id: 'workspace-a', title: '資料庫 A 班' }, limited: false,
      assignments: [{ id: 'assignment-a', title: '資料模型', dueAt: '2026-11-12T10:00:00Z', state: 'open', submittedAt: null }],
    },
  };
}
function props(overrides: Partial<NuniCourseworkStudyActionProps> = {}): NuniCourseworkStudyActionProps {
  return {
    read: read(), assignmentIds: ['assignment-a'], latest: true,
    context: { uid: '', schoolId: 'pu', platformTimetable: { accountId: 'student-a', isCurrent: () => true }, isCurrent: () => true },
    onTask: jest.fn(), onBusyChange: jest.fn(), onRefresh: jest.fn(), ...overrides,
  };
}
function suggestion(index = 0, source: Partial<CourseworkStudySource> = {}): CourseworkStudyDraft {
  const hour = 10 + index;
  return Object.freeze({
    source: Object.freeze({ owner: 'nuni:student-a', schoolId: 'pu', workspaceId: 'workspace-a', assignmentId: 'assignment-a',
      title: '資料模型', courseName: '資料庫 A 班', dueAt: '2026-11-12T10:00:00Z', checkedAt, ...source }),
    event: Object.freeze({ title: '準備：資料模型', date: '2026-11-09', allDay: false,
      startTime: `${hour}:00`, endTime: `${hour}:30` }),
    availability: Object.freeze({ checkedAt, summary: availabilitySummary }),
  });
}
function available(drafts: readonly CourseworkStudyDraft[] = [suggestion()]): FindResult {
  return { kind: 'available', drafts, checkedAt, message: '已找到可核對的準備時段，請選擇一個。' };
}
function unknownTask(draft: CourseworkStudyDraft): AssistantCalendarTask {
  return { state: 'unknown', reason: 'unavailable', message: '請核對原操作。', proposal: {
    owner: draft.source.owner, schoolId: draft.source.schoolId, mutationId: 'aev_original_attempt',
    createdAt: checkedAt, event: draft.event,
  } };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function findTimes(view: ReturnType<typeof render>) {
  await act(async () => fireEvent.press(view.getByRole('button', { name: finderLabel })));
}
async function choose(view: ReturnType<typeof render>, ordinal = 1) {
  await act(async () => fireEvent.press(view.getByRole('button', { name: new RegExp(`^時段 ${ordinal}：`) })));
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Date, 'now').mockReturnValue(now);
  find.mockReset().mockResolvedValue(available());
  confirm.mockReset().mockResolvedValue({ kind: 'blocked', message: '請重新核對原作業。' });
});
afterEach(() => jest.restoreAllMocks());

test('an explicit suggestion request starts one read and still requires choosing a slot and confirming it', async () => {
  const pending = deferred<FindResult>(); find.mockReturnValueOnce(pending.promise);
  const input = props({ suggestTime: true }); const view = render(<NuniCourseworkStudyAction {...input} />);
  expect(find).toHaveBeenCalledTimes(1);
  expect(view.getByRole('button', { name: '停止尋找空堂' })).toBeTruthy();
  view.rerender(<NuniCourseworkStudyAction {...input} onRefresh={jest.fn()} />);
  expect(find).toHaveBeenCalledTimes(1);
  await act(async () => pending.resolve(available([suggestion(), suggestion(1)])));
  expect(view.getAllByRole('button', { name: /^時段 \d：/ })).toHaveLength(2);
  expect(view.queryByRole('button', { name: '確認建立準備行程' })).toBeNull();
  expect(find).toHaveBeenCalledTimes(1);
  expect(prepare).not.toHaveBeenCalled(); expect(confirm).not.toHaveBeenCalled();
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});

test('an automatic request waits for the exact choice when assignments share the same name', async () => {
  const snapshot = read();
  if (snapshot.result.kind !== 'assignments') throw new Error('fixture');
  snapshot.result.assignments.push({ ...snapshot.result.assignments[0]!, id: 'assignment-b' });
  find.mockResolvedValueOnce(available([suggestion(1, { assignmentId: 'assignment-b' })]));
  const input = props({ suggestTime: true, read: snapshot, assignmentIds: ['assignment-a', 'assignment-b'] });
  const view = render(<NuniCourseworkStudyAction {...input} />);
  expect(find).not.toHaveBeenCalled();
  await act(async () => fireEvent.press(view.getByRole('button', { name: /^第 2 份：資料模型/ })));
  expect(find).toHaveBeenCalledTimes(1);
  expect(find.mock.calls[0]![1]).toBe('assignment-b');
  expect(view.getByRole('button', { name: /11:00–11:30/ })).toBeTruthy();
  expect(view.queryByRole('button', { name: '確認建立準備行程' })).toBeNull();
  expect(confirm).not.toHaveBeenCalled();
});

test('a stopped automatic search stays stopped across edits and rerenders until an explicit retry', async () => {
  const pending = deferred<FindResult>(); find.mockReturnValueOnce(pending.promise);
  const input = props({ suggestTime: true }); const view = render(<NuniCourseworkStudyAction {...input} />);
  const signal = find.mock.calls[0]![3]!.signal!;
  await act(async () => fireEvent.press(view.getByRole('button', { name: '停止尋找空堂' })));
  expect(signal.aborted).toBe(true);
  expect(input.onBusyChange).toHaveBeenLastCalledWith(false);
  fireEvent.changeText(view.getByLabelText('準備行程日期'), '2026-11-10');
  view.rerender(<NuniCourseworkStudyAction {...input} disabled={false} />);
  await act(async () => pending.resolve(available()));
  expect(find).toHaveBeenCalledTimes(1);
  expect(view.getByLabelText('準備行程日期')).toHaveProp('value', '2026-11-10');
  expect(view.queryByRole('button', { name: /^時段 \d：/ })).toBeNull();
  await findTimes(view);
  expect(find).toHaveBeenCalledTimes(2);
  expect(view.getByRole('button', { name: /^時段 1：/ })).toBeTruthy();
  expect(confirm).not.toHaveBeenCalled();
});

test('a disabled automatic request starts only after busy clears and does not repeat on later busy changes', async () => {
  const input = props({ suggestTime: true, disabled: true });
  const view = render(<NuniCourseworkStudyAction {...input} />);
  expect(find).not.toHaveBeenCalled();
  await act(async () => view.rerender(<NuniCourseworkStudyAction {...input} disabled={false} />));
  expect(find).toHaveBeenCalledTimes(1);
  view.rerender(<NuniCourseworkStudyAction {...input} disabled />);
  view.rerender(<NuniCourseworkStudyAction {...input} disabled={false} />);
  expect(find).toHaveBeenCalledTimes(1);
  expect(view.getByRole('button', { name: /^時段 1：/ })).toBeTruthy();
  expect(confirm).not.toHaveBeenCalled();
});

test('an automatic no-slot result keeps manual editing without starting a retry loop', async () => {
  find.mockResolvedValueOnce({ kind: 'no-slot', message: '沒有足夠的 30 分鐘空堂。' });
  const input = props({ suggestTime: true }); const view = render(<NuniCourseworkStudyAction {...input} />);
  await act(async () => { await Promise.resolve(); });
  expect(view.getByRole('alert')).toHaveTextContent('沒有足夠的 30 分鐘空堂。');
  fireEvent.changeText(view.getByLabelText('準備行程日期'), '2026-11-10');
  view.rerender(<NuniCourseworkStudyAction {...input} />);
  expect(find).toHaveBeenCalledTimes(1);
  expect(view.getByRole('button', { name: finderLabel })).toBeTruthy();
  expect(input.onBusyChange).toHaveBeenCalledTimes(2);
});

test.each(['stale', 'task', 'invalid-source'] as const)('a %s source never starts an automatic read', (condition) => {
  const input = props({ suggestTime: true });
  if (condition === 'stale') input.latest = false;
  if (condition === 'task') input.task = unknownTask(suggestion());
  if (condition === 'invalid-source') input.read = { ...input.read, checkedAt: undefined };
  render(<NuniCourseworkStudyAction {...input} />);
  expect(find).not.toHaveBeenCalled();
  expect(input.onBusyChange).not.toHaveBeenCalled();
  expect(confirm).not.toHaveBeenCalled();
});

test('an explicit clock keeps its manual preview even if a suggestion flag is also present', () => {
  const input = props({ suggestTime: true, initialTime: { date: '2026-11-09', startTime: '15:00', endTime: '15:30' } });
  const view = render(<NuniCourseworkStudyAction {...input} />);
  expect(view.getByText('2026-11-09 · 15:00–15:30（台灣時間）')).toBeTruthy();
  expect(find).not.toHaveBeenCalled();
  fireEvent.press(view.getByRole('button', { name: '修改日期與時間' }));
  expect(view.getByLabelText('準備行程開始時間')).toHaveProp('value', '15:00');
  expect(find).not.toHaveBeenCalled();
});

test('changing the suggestion request creates a new source instance and revokes its earlier pending read', async () => {
  const pending = deferred<FindResult>(); find.mockReturnValueOnce(pending.promise);
  const input = props(); const view = render(<NuniCourseworkStudyAction {...input} />);
  expect(find).not.toHaveBeenCalled();
  await act(async () => view.rerender(<NuniCourseworkStudyAction {...input} suggestTime />));
  expect(find).toHaveBeenCalledTimes(1);
  const signal = find.mock.calls[0]![3]!.signal!;
  await act(async () => view.rerender(<NuniCourseworkStudyAction {...input} suggestTime={false} />));
  expect(signal.aborted).toBe(true);
  await act(async () => pending.resolve(available()));
  expect(view.queryByRole('button', { name: /^時段 \d：/ })).toBeNull();
  expect(view.getByRole('button', { name: finderLabel })).toBeTruthy();
  expect(find).toHaveBeenCalledTimes(1);
});

test('finding is explicit, coalesces repeated taps, and keeps the selected draft identity until a separate confirmation', async () => {
  const first = suggestion(); const second = suggestion(1);
  const pending = deferred<FindResult>(); find.mockReturnValueOnce(pending.promise);
  const input = props(); const view = render(<NuniCourseworkStudyAction {...input} />);
  expect(find).not.toHaveBeenCalled();
  const button = view.getByRole('button', { name: finderLabel });
  await act(async () => { fireEvent.press(button); fireEvent.press(button); });
  expect(find).toHaveBeenCalledTimes(1);
  expect(find.mock.calls[0]![0]).toBe(input.read);
  expect(find.mock.calls[0]![1]).toBe('assignment-a');
  expect(input.onBusyChange).toHaveBeenLastCalledWith(true);
  expect(view.queryByRole('button', { name: '確認建立準備行程' })).toBeNull();
  await act(async () => pending.resolve(available([first, second])));
  expect(input.onBusyChange).toHaveBeenLastCalledWith(false);
  expect(view.queryByRole('button', { name: '確認建立準備行程' })).toBeNull();
  expect(prepare).not.toHaveBeenCalled(); expect(confirm).not.toHaveBeenCalled();
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  await choose(view, 2);
  expect(view.getByText('2026-11-09 · 11:00–11:30（台灣時間）')).toBeTruthy();
  expect(view.getByText(availabilitySummary)).toBeTruthy();
  expect(view.getByText(/^空堂核對時間：/)).toBeTruthy();
  expect(prepare).not.toHaveBeenCalled(); expect(confirm).not.toHaveBeenCalled();
  const task = unknownTask(second);
  confirm.mockResolvedValueOnce({ kind: 'calendar', task, sourceCheckedAt: checkedAt });
  await act(async () => fireEvent.press(view.getByRole('button', { name: '確認建立準備行程' })));
  expect(confirm.mock.calls[0]![0]).toBe(second);
  expect(input.onTask).toHaveBeenCalledWith(task, checkedAt, 'assignment-a');
  expect(view.queryByRole('button', { name: finderLabel })).toBeNull();
  expect(view.queryByRole('button', { name: '確認建立準備行程' })).toBeNull();
});

test('editing a suggested time creates a manual draft without the original availability claim', async () => {
  const original = suggestion(); find.mockResolvedValueOnce(available([original]));
  const view = render(<NuniCourseworkStudyAction {...props()} />);
  await findTimes(view); await choose(view);
  fireEvent.press(view.getByRole('button', { name: '修改日期與時間' }));
  expect(view.getByLabelText('準備行程日期')).toHaveProp('value', '2026-11-09');
  expect(view.getByLabelText('準備行程開始時間')).toHaveProp('value', '10:00');
  fireEvent.changeText(view.getByLabelText('準備行程開始時間'), '15:00');
  fireEvent.changeText(view.getByLabelText('準備行程結束時間'), '15:30');
  fireEvent.press(view.getByRole('button', { name: '預覽準備行程' }));
  expect(view.queryByText(availabilitySummary)).toBeNull();
  expect(view.queryByText(/^空堂核對時間：/)).toBeNull();
  expect(view.getByText(/這裡沒有判定課表空堂/)).toBeTruthy();
  await act(async () => fireEvent.press(view.getByRole('button', { name: '確認建立準備行程' })));
  const manual = confirm.mock.calls[0]![0];
  expect(manual).not.toBe(original);
  expect(manual.availability).toBeUndefined();
  expect(manual.event).toMatchObject({ startTime: '15:00', endTime: '15:30' });
  expect(prepare).toHaveBeenCalledTimes(1);
});

test('at most three suggestions are shown and none is selected automatically', async () => {
  find.mockResolvedValueOnce(available([suggestion(), suggestion(1), suggestion(2), suggestion(3)]));
  const view = render(<NuniCourseworkStudyAction {...props()} />);
  await findTimes(view);
  expect(view.getAllByRole('button', { name: /^時段 \d：/ })).toHaveLength(3);
  expect(view.queryByRole('button', { name: /^時段 4：/ })).toBeNull();
  expect(view.queryByRole('button', { name: '確認建立準備行程' })).toBeNull();
  fireEvent.press(view.getByRole('button', { name: '自行輸入日期與時間' }));
  expect(view.getByLabelText('準備行程日期')).toBeTruthy();
  expect(confirm).not.toHaveBeenCalled(); expect(prepare).not.toHaveBeenCalled();
});

test('same-name assignments require an exact source choice before finding time', async () => {
  const snapshot = read();
  if (snapshot.result.kind !== 'assignments') throw new Error('fixture');
  snapshot.result.assignments.push({ ...snapshot.result.assignments[0]!, id: 'assignment-b' });
  const selected = suggestion(1, { assignmentId: 'assignment-b' });
  find.mockResolvedValueOnce(available([selected]));
  const input = props({ read: snapshot, assignmentIds: ['assignment-a', 'assignment-b'] });
  const view = render(<NuniCourseworkStudyAction {...input} />);
  expect(view.queryByRole('button', { name: finderLabel })).toBeNull();
  expect(find).not.toHaveBeenCalled();
  fireEvent.press(view.getByRole('button', { name: /^第 2 份：資料模型/ }));
  await findTimes(view);
  expect(find.mock.calls[0]![1]).toBe('assignment-b');
  await choose(view);
  await act(async () => fireEvent.press(view.getByRole('button', { name: '確認建立準備行程' })));
  expect(confirm.mock.calls[0]![0]).toBe(selected);
});

test('a final write guard rejection offers a fresh source query without restoring the attempted draft', async () => {
  const draft = suggestion();
  const task: AssistantCalendarTask = { proposal: unknownTask(draft).proposal, state: 'blocked',
    message: '課表或個人行程已更新，請重新尋找並核對準備時段。' };
  find.mockResolvedValueOnce(available([draft]));
  confirm.mockResolvedValueOnce({ kind: 'calendar', task, sourceCheckedAt: checkedAt });
  const input = props(); const view = render(<NuniCourseworkStudyAction {...input} />);
  await findTimes(view); await choose(view);
  await act(async () => fireEvent.press(view.getByRole('button', { name: '確認建立準備行程' })));
  expect(input.onTask).toHaveBeenCalledWith(task, checkedAt, 'assignment-a');
  view.rerender(<NuniCourseworkStudyAction {...input} task={task} />);
  fireEvent.press(view.getByRole('button', { name: '重新查詢作業' }));
  expect(input.onRefresh).toHaveBeenCalledTimes(1);
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(find).toHaveBeenCalledTimes(1);
  expect(prepare).not.toHaveBeenCalled();
  expect(view.queryByRole('button', { name: finderLabel })).toBeNull();
  expect(view.queryByRole('button', { name: '確認建立準備行程' })).toBeNull();
});

test.each(['older', 'busy'] as const)('a %s blocked source card cannot start a refresh', (state) => {
  const task: AssistantCalendarTask = { proposal: unknownTask(suggestion()).proposal, state: 'blocked', message: '請重新核對。' };
  const input = props({ task, latest: state !== 'older', disabled: state === 'busy' });
  const view = render(<NuniCourseworkStudyAction {...input} />);
  const refresh = view.queryByRole('button', { name: '重新查詢作業' });
  if (state === 'older') expect(refresh).toBeNull();
  else { expect(refresh).toBeDisabled(); fireEvent.press(refresh!); }
  expect(input.onRefresh).not.toHaveBeenCalled();
  expect(view.queryByRole('button', { name: finderLabel })).toBeNull();
  expect(confirm).not.toHaveBeenCalled();
});

test.each(['unknown', 'verified'] as const)('a %s operation keeps its read-only handoff without a new source action', (state) => {
  const original = unknownTask(suggestion());
  const { proposal } = original;
  const task: AssistantCalendarTask = state === 'unknown' ? original : {
    proposal, state: 'verified', receipt: createAssistantCalendarReceipt({
      schoolId: proposal.schoolId, mutationId: proposal.mutationId, event: proposal.event,
      storage: 'device', verifiedAt: checkedAt,
      record: { ...proposal.event, id: proposal.mutationId, batchId: proposal.mutationId, kind: 'events',
        schoolId: proposal.schoolId, academicYear: '', semester: '', importedAt: checkedAt,
        source: { type: 'paste', line: 1, rawText: '' } },
    }),
  };
  const view = render(<NuniCourseworkStudyAction {...props({ task })} />);
  expect(view.queryByRole('button', { name: '重新查詢作業' })).toBeNull();
  expect(view.queryByRole('button', { name: finderLabel })).toBeNull();
  expect(view.queryByRole('button', { name: '確認建立準備行程' })).toBeNull();
  expect(find).not.toHaveBeenCalled(); expect(prepare).not.toHaveBeenCalled(); expect(confirm).not.toHaveBeenCalled();
});

test.each(['no-slot', 'unavailable'] as const)('%s keeps entered times available for manual review', async (kind) => {
  find.mockResolvedValueOnce({ kind, message: '這次沒有可核對的空堂建議。' });
  const view = render(<NuniCourseworkStudyAction {...props()} />);
  fireEvent.changeText(view.getByLabelText('準備行程日期'), '2026-11-10');
  fireEvent.changeText(view.getByLabelText('準備行程開始時間'), '17:00');
  fireEvent.changeText(view.getByLabelText('準備行程結束時間'), '17:30');
  await findTimes(view);
  expect(view.getByRole('alert')).toHaveTextContent('這次沒有可核對的空堂建議。');
  expect(view.getByLabelText('準備行程日期')).toHaveProp('value', '2026-11-10');
  fireEvent.press(view.getByRole('button', { name: '預覽準備行程' }));
  expect(view.getByText('2026-11-10 · 17:00–17:30（台灣時間）')).toBeTruthy();
  expect(view.getByRole('button', { name: '確認建立準備行程' })).toBeTruthy();
  expect(confirm).not.toHaveBeenCalled();
});

test('an unexpected read failure returns to editing and releases the shared busy state', async () => {
  find.mockRejectedValueOnce(new Error('native read unavailable'));
  const input = props(); const view = render(<NuniCourseworkStudyAction {...input} />);
  await findTimes(view);
  expect(view.getByRole('alert')).toHaveTextContent(/目前無法完整核對空堂/);
  expect(view.getByLabelText('準備行程日期')).toBeTruthy();
  expect(input.onBusyChange).toHaveBeenNthCalledWith(1, true);
  expect(input.onBusyChange).toHaveBeenNthCalledWith(2, false);
  expect(confirm).not.toHaveBeenCalled();
});

test.each(['resolve', 'reject'] as const)('stopping releases the read wait and ignores a late %s after a new search', async (completion) => {
  const pending = deferred<FindResult>(); find.mockReturnValueOnce(pending.promise);
  const input = props(); const view = render(<NuniCourseworkStudyAction {...input} />);
  await findTimes(view);
  const signal = find.mock.calls[0]![3]!.signal!;
  await act(async () => fireEvent.press(view.getByRole('button', { name: '停止尋找空堂' })));
  expect(signal.aborted).toBe(true);
  expect(input.onBusyChange).toHaveBeenLastCalledWith(false);
  expect(view.getByRole('alert')).toHaveTextContent(/已停止尋找空堂/);
  find.mockResolvedValueOnce(available([suggestion(1)]));
  await findTimes(view);
  expect(view.getByRole('button', { name: /11:00–11:30/ })).toBeTruthy();
  await act(async () => {
    if (completion === 'resolve') pending.resolve(available([suggestion()]));
    else pending.reject(new Error('late transport failure'));
  });
  expect(view.queryByRole('button', { name: /10:00–10:30/ })).toBeNull();
  expect(view.getByRole('button', { name: /11:00–11:30/ })).toBeTruthy();
  expect(input.onBusyChange).toHaveBeenCalledTimes(4);
  expect(confirm).not.toHaveBeenCalled(); expect(input.onTask).not.toHaveBeenCalled();
});

test.each(['latest', 'source', 'notification', 'account', 'school', 'session', 'task'] as const)(
  'a %s change cancels finding and cannot revive a late suggestion', async (change) => {
    const pending = deferred<FindResult>(); find.mockReturnValueOnce(pending.promise);
    let sessionCurrent = true;
    const input = props(); input.context.isCurrent = () => sessionCurrent;
    const view = render(<NuniCourseworkStudyAction {...input} />);
    await findTimes(view);
    const access = find.mock.calls[0]![2]; const signal = find.mock.calls[0]![3]!.signal!;
    const next = { ...input };
    if (change === 'latest') next.latest = false;
    if (change === 'source') next.read = { ...read(), checkedAt: '2026-11-08T02:01:00.000Z' };
    if (change === 'notification') next.read = { ...read(), changedAssignmentId: 'assignment-a' };
    if (change === 'account') next.context = { ...input.context, platformTimetable: { accountId: 'student-b', isCurrent: () => true } };
    if (change === 'school') next.context = { ...input.context, schoolId: 'ncku' };
    if (change === 'session') sessionCurrent = false;
    if (change === 'task') next.task = unknownTask(suggestion());
    await act(async () => view.rerender(<NuniCourseworkStudyAction {...next} />));
    expect(signal.aborted).toBe(true);
    expect(access.isCurrent()).toBe(false);
    expect(input.onBusyChange).toHaveBeenLastCalledWith(false);
    await act(async () => pending.resolve(available()));
    expect(view.queryByRole('button', { name: /^時段 \d：/ })).toBeNull();
    expect(view.queryByRole('button', { name: '確認建立準備行程' })).toBeNull();
    expect(confirm).not.toHaveBeenCalled(); expect(input.onTask).not.toHaveBeenCalled();
    expect(input.onBusyChange).toHaveBeenCalledTimes(2);
  },
);

test('unmount aborts finding and releases busy once even when the read finishes later', async () => {
  const pending = deferred<FindResult>(); find.mockReturnValueOnce(pending.promise);
  const input = props(); const view = render(<NuniCourseworkStudyAction {...input} />);
  await findTimes(view);
  const signal = find.mock.calls[0]![3]!.signal!;
  await act(async () => view.unmount());
  expect(signal.aborted).toBe(true);
  expect(input.onBusyChange).toHaveBeenLastCalledWith(false);
  await act(async () => pending.resolve(available()));
  expect(input.onBusyChange).toHaveBeenCalledTimes(2);
  expect(input.onTask).not.toHaveBeenCalled(); expect(confirm).not.toHaveBeenCalled();
});

test('finding is disabled while another task is busy and is absent from an existing manual preview', () => {
  const input = props({ disabled: true }); const view = render(<NuniCourseworkStudyAction {...input} />);
  fireEvent.press(view.getByRole('button', { name: finderLabel }));
  expect(find).not.toHaveBeenCalled();
  view.rerender(<NuniCourseworkStudyAction {...input} disabled={false}
    initialTime={{ date: '2026-11-09', startTime: '15:00', endTime: '15:30' }} />);
  expect(view.getByRole('button', { name: '確認建立準備行程' })).toBeTruthy();
  expect(view.queryByRole('button', { name: finderLabel })).toBeNull();
});

test.each(['closed', 'submitted', 'deadline', 'checkedAt'] as const)('invalid %s evidence cannot offer finding', (problem) => {
  const snapshot = read();
  if (snapshot.result.kind !== 'assignments') throw new Error('fixture');
  const row = snapshot.result.assignments[0]!;
  if (problem === 'closed') row.state = 'closed';
  if (problem === 'submitted') row.submittedAt = checkedAt;
  if (problem === 'deadline') row.dueAt = '2026-11-12';
  if (problem === 'checkedAt') snapshot.checkedAt = '2026-11-08';
  const view = render(<NuniCourseworkStudyAction {...props({ read: snapshot })} />);
  expect(view.getByRole('alert')).toBeTruthy();
  expect(view.queryByRole('button', { name: finderLabel })).toBeNull();
  expect(find).not.toHaveBeenCalled(); expect(confirm).not.toHaveBeenCalled();
});

test.each(['owner', 'assignment', 'workspace', 'availability', 'empty'] as const)(
  'an unexpected %s in the result never becomes a reviewable source', async (problem) => {
    let draft = suggestion();
    if (problem === 'owner') draft = suggestion(0, { owner: 'nuni:student-b' });
    if (problem === 'assignment') draft = suggestion(0, { assignmentId: 'assignment-b' });
    if (problem === 'workspace') draft = suggestion(0, { workspaceId: 'workspace-b' });
    if (problem === 'availability') draft = { source: draft.source, event: draft.event };
    find.mockResolvedValueOnce(available(problem === 'empty' ? [] : [draft]));
    const view = render(<NuniCourseworkStudyAction {...props()} />);
    await findTimes(view);
    expect(view.getByRole('alert')).toHaveTextContent(/目前無法完整核對空堂/);
    expect(view.queryByRole('button', { name: /^時段 \d：/ })).toBeNull();
    expect(view.queryByRole('button', { name: '確認建立準備行程' })).toBeNull();
    expect(confirm).not.toHaveBeenCalled(); expect(prepare).not.toHaveBeenCalled();
  },
);

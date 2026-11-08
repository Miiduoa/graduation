import React, { useState } from 'react';
import { Linking } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AssistantCalendarBatchAction } from '../screens/AssistantCalendarBatchAction';
import { prepareAssistantCalendarBatch, restoreAssistantCalendarBatches,
  type AssistantCalendarBatchView } from '../services/assistantCalendarBatchExecution';
import { personalImportStorageKey } from '../services/personalImports';
import type { ServiceScreenProps } from '../screens/UnavailableFeatureScreen';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../firebase', () => ({ getAuthInstance: () => ({ currentUser: { uid: 'A' } }), isFirebaseMockMode: () => false }));
const originalGet = jest.mocked(AsyncStorage.getItem).getMockImplementation()!;
const originalSet = jest.mocked(AsyncStorage.setItem).getMockImplementation()!;
const context = { uid: 'A', schoolId: 'pu', isCurrent: () => true };
const key = personalImportStorageKey({ owner: 'firebase:A', schoolId: 'pu' });
const events = [
  { title: '英文讀書', date: '2099-01-02', allDay: false, startTime: '19:00', endTime: '20:00' },
  { title: '資料庫複習', date: '2099-01-03', allDay: false, startTime: '18:00', endTime: '19:00' },
];
const writes = () => jest.mocked(AsyncStorage.setItem).mock.calls.filter(([storageKey]) => storageKey === key);
const navigation = () => ({ navigate: jest.fn(), getState: () => ({ routeNames: ['PersonalCalendar'] }) });
function deferred() {
  let resolve!: () => void;
  return { promise: new Promise<void>((done) => { resolve = done; }), resolve: () => resolve() };
}
function Harness({ initial, access = context, nav = navigation(), changed = () => undefined }: {
  initial: AssistantCalendarBatchView; access?: typeof context; nav?: ServiceScreenProps['navigation'];
  changed?: (view: AssistantCalendarBatchView) => void;
}) {
  const [batch, setBatch] = useState(initial);
  const disabled = batch.state === 'running' || !!batch.checking;
  return <AssistantCalendarBatchAction batch={batch} context={access} navigation={nav} disabled={disabled}
    onChange={(next) => { changed(next); setBatch(next); }} />;
}
beforeEach(async () => {
  jest.mocked(AsyncStorage.getItem).mockReset().mockImplementation(originalGet);
  jest.mocked(AsyncStorage.setItem).mockReset().mockImplementation(originalSet);
  await AsyncStorage.clear();
  jest.clearAllMocks();
});
afterEach(() => jest.restoreAllMocks());

test('the complete preview needs one explicit confirmation, repeated taps run once and each receipt opens its exact event', async () => {
  const initial = await prepareAssistantCalendarBatch(events, context);
  const nav = navigation();
  const view = render(<Harness initial={initial} nav={nav} />);
  expect(view.getByText('1. 英文讀書')).toBeTruthy();
  expect(view.getByText('2. 資料庫複習')).toBeTruthy();
  expect(view.getAllByText('尚未開始')).toHaveLength(2);
  expect(writes()).toHaveLength(0);
  const confirm = view.getByRole('button', { name: '確認加入 2 筆行程' });
  await act(async () => { fireEvent.press(confirm); fireEvent.press(confirm); });
  expect(view.getByText('已逐筆保存並核對 2 筆行程。')).toBeTruthy();
  expect(writes()).toHaveLength(2);
  const saved = JSON.parse(await originalGet(key) ?? '{}');
  for (const event of events) {
    fireEvent.press(view.getByRole('button', { name: `查看行程：${event.title}` }));
    expect(nav.navigate).toHaveBeenLastCalledWith('PersonalCalendar', {
      eventId: saved.records.find((row: { title: string }) => row.title === event.title).id,
    });
  }
});

test('cancelling an unstarted batch persists the decision without claiming to delete events', async () => {
  const initial = await prepareAssistantCalendarBatch(events, context);
  const view = render(<Harness initial={initial} />);
  await act(async () => fireEvent.press(view.getByRole('button', { name: '取消尚未開始的行程' })));
  expect(view.getAllByText('已取消，尚未開始')).toHaveLength(2);
  expect(view.queryByRole('button', { name: '確認加入 2 筆行程' })).toBeNull();
  expect(writes()).toHaveLength(0);
  expect((await restoreAssistantCalendarBatches(context))[0]).toMatchObject({ state: 'cancelled',
    plan: { id: initial.plan.id, cancelledAt: expect.any(String) } });
});

test('stop remains enabled during an in-flight native write and prevents the next operation', async () => {
  const initial = await prepareAssistantCalendarBatch(events, context);
  const held = deferred();
  jest.mocked(AsyncStorage.setItem).mockImplementation(async (storageKey, value) => {
    await originalSet(storageKey, value);
    if (storageKey === key) await held.promise;
  });
  const view = render(<Harness initial={initial} />);
  act(() => fireEvent.press(view.getByRole('button', { name: '確認加入 2 筆行程' })));
  await waitFor(() => expect(writes()).toHaveLength(1));
  const stop = view.getByRole('button', { name: '停止後續行程' });
  expect(stop).toBeEnabled();
  fireEvent.press(stop);
  expect(view.getByText('正在停止後續安排；已送出的操作仍會保留並核對。')).toBeTruthy();
  await act(async () => held.resolve());
  await waitFor(() => expect(view.queryByRole('button', { name: '停止後續行程' })).toBeNull());
  expect(writes()).toHaveLength(1);
  expect(view.queryByText('已逐筆保存並核對 2 筆行程。')).toBeNull();
  await act(async () => fireEvent.press(view.getByRole('button', { name: '重新核對整份行程' })));
  expect(view.getByRole('button', { name: '確認接續剩餘 1 筆行程' })).toBeTruthy();
  expect(writes()).toHaveLength(1);
});

test('unmount aborts subsequent steps and drops late callbacks without deleting the first result', async () => {
  const initial = await prepareAssistantCalendarBatch(events, context);
  const held = deferred();
  jest.mocked(AsyncStorage.setItem).mockImplementation(async (storageKey, value) => {
    await originalSet(storageKey, value);
    if (storageKey === key) await held.promise;
  });
  const changed = jest.fn();
  const view = render(<Harness initial={initial} changed={changed} />);
  act(() => fireEvent.press(view.getByRole('button', { name: '確認加入 2 筆行程' })));
  await waitFor(() => expect(writes()).toHaveLength(1));
  view.unmount();
  const callbacks = changed.mock.calls.length;
  await act(async () => held.resolve());
  const restored = await restoreAssistantCalendarBatches(context);
  expect(changed).toHaveBeenCalledTimes(callbacks);
  expect(writes()).toHaveLength(1);
  expect(restored[0].progress).toMatchObject({ verified: 1, notStarted: 1 });
});

test('old account controls do not start or cancel a plan after the scope changes', async () => {
  let active = true;
  const access = { ...context, isCurrent: () => active };
  const initial = await prepareAssistantCalendarBatch(events, access);
  const view = render(<Harness initial={initial} access={access} />);
  jest.clearAllMocks();
  active = false;
  await act(async () => {
    fireEvent.press(view.getByRole('button', { name: '確認加入 2 筆行程' }));
    fireEvent.press(view.getByRole('button', { name: '取消尚未開始的行程' }));
  });
  expect(AsyncStorage.getItem).not.toHaveBeenCalled();
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});

test('completed device events never navigate to a website when the local calendar is unavailable', async () => {
  const initial = await prepareAssistantCalendarBatch(events, context);
  const nav = { navigate: jest.fn(), getState: () => ({ routeNames: ['NuniWorkspace'] }) };
  const web = jest.spyOn(Linking, 'openURL');
  const view = render(<Harness initial={initial} nav={nav} />);
  await act(async () => fireEvent.press(view.getByRole('button', { name: '確認加入 2 筆行程' })));
  fireEvent.press(view.getByRole('button', { name: '查看行程：英文讀書' }));
  expect(view.getByText('目前無法從此頁開啟行事曆。已核對的行程可從個人行事曆查看。')).toBeTruthy();
  expect(nav.navigate).not.toHaveBeenCalled();
  expect(web).not.toHaveBeenCalled();
});

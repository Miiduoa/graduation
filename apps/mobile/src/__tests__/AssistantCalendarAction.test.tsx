import React, { useState } from 'react';
import { Linking } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AssistantCalendarAction } from '../screens/AssistantCalendarAction';
import { createAssistantCalendarTask, type AssistantCalendarContext, type AssistantCalendarTask } from '../services/assistantCalendarExecution';
import type { ServiceScreenProps } from '../screens/UnavailableFeatureScreen';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../firebase', () => ({
  getAuthInstance: () => ({ currentUser: { uid: 'A' } }), isFirebaseMockMode: () => false,
}));
const originalGet = jest.mocked(AsyncStorage.getItem).getMockImplementation()!;
const originalSet = jest.mocked(AsyncStorage.setItem).getMockImplementation()!;
const context: AssistantCalendarContext = { uid: 'A', schoolId: 'pu', isCurrent: () => true };
const event = { title: '英文讀書', date: '2099-01-02', allDay: false, startTime: '19:00', endTime: '20:00' };
const navigation = () => ({ navigate: jest.fn(), getState: () => ({ routeNames: ['PersonalCalendar'] }) });
function Harness({ initial, access = context, nav, changed = () => undefined }: {
  initial: AssistantCalendarTask; access?: AssistantCalendarContext;
  nav: ServiceScreenProps['navigation']; changed?: (task: AssistantCalendarTask) => void;
}) {
  const [task, setTask] = useState(initial);
  return <AssistantCalendarAction task={task} context={access} navigation={nav} disabled={false}
    onChange={(next) => { changed(next); setTask(next); }} />;
}
beforeEach(async () => {
  jest.mocked(AsyncStorage.getItem).mockReset().mockImplementation(originalGet);
  jest.mocked(AsyncStorage.setItem).mockReset().mockImplementation(originalSet);
  await AsyncStorage.clear();
  jest.clearAllMocks();
});
afterEach(() => jest.restoreAllMocks());

test('review requires an explicit click, duplicate taps create once, and the verified receipt opens the exact stored event', async () => {
  const task = createAssistantCalendarTask(event, context);
  const nav = navigation();
  const changed = jest.fn();
  const view = render(<Harness initial={task} nav={nav} changed={changed} />);
  expect(view.getByText('英文讀書')).toBeTruthy();
  expect(view.getByText(/2099-01-02.*19:00–20:00.*台灣時間/)).toBeTruthy();
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  const confirm = view.getByRole('button', { name: '確認加入個人行事曆' });
  await act(async () => { fireEvent.press(confirm); fireEvent.press(confirm); });
  expect(AsyncStorage.setItem).toHaveBeenCalledTimes(1);
  expect(changed.mock.calls.map(([next]) => next.state)).toEqual(['saving', 'verified']);
  expect(view.getByText('已在這台手機保存並核對行程。')).toBeTruthy();
  expect(view.getByText(/沒有排程手機通知/)).toBeTruthy();
  fireEvent.press(view.getByRole('button', { name: '查看已建立的行程' }));
  expect(nav.navigate).toHaveBeenCalledWith('PersonalCalendar', { eventId: task.proposal.mutationId });
});

test('cancelling an unconfirmed draft never writes or offers a misleading success', () => {
  const view = render(<Harness initial={createAssistantCalendarTask(event, context)} nav={navigation()} />);
  fireEvent.press(view.getByRole('button', { name: '先不要' }));
  expect(view.getByText('已取消這份草稿，尚未建立行程。')).toBeTruthy();
  expect(view.queryByRole('button', { name: '確認加入個人行事曆' })).toBeNull();
  expect(AsyncStorage.getItem).not.toHaveBeenCalled();
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});

test('an unknown result offers only same-ID checking and can verify a late native commit', async () => {
  const task = createAssistantCalendarTask(event, context);
  let lateKey = ''; let lateValue = '';
  jest.mocked(AsyncStorage.setItem).mockImplementationOnce(async (key, value) => {
    lateKey = key; lateValue = value; throw new Error('lost native response');
  });
  const view = render(<Harness initial={task} nav={navigation()} />);
  await act(async () => fireEvent.press(view.getByRole('button', { name: '確認加入個人行事曆' })));
  expect(view.queryByRole('button', { name: '確認加入個人行事曆' })).toBeNull();
  expect(view.queryByRole('button', { name: '先不要' })).toBeNull();
  expect(view.queryByText('已在這台手機保存並核對行程。')).toBeNull();
  await originalSet(lateKey, lateValue);
  await act(async () => fireEvent.press(view.getByRole('button', { name: '重新核對行程' })));
  expect(view.getByText('已在這台手機保存並核對行程。')).toBeTruthy();
  expect(AsyncStorage.setItem).toHaveBeenCalledTimes(1);
});

test('a device receipt never opens an unavailable native route or a website that lacks the local record', async () => {
  const nav = { navigate: jest.fn(), getState: () => ({ routeNames: ['NuniWorkspace'] }) };
  const web = jest.spyOn(Linking, 'openURL');
  const view = render(<Harness initial={createAssistantCalendarTask(event, context)} nav={nav} />);
  await act(async () => fireEvent.press(view.getByRole('button', { name: '確認加入個人行事曆' })));
  fireEvent.press(view.getByRole('button', { name: '查看已建立的行程' }));
  expect(view.getByRole('alert')).toHaveTextContent(/目前無法從此頁開啟行事曆/);
  expect(nav.navigate).not.toHaveBeenCalled();
  expect(web).not.toHaveBeenCalled();
});

test('buttons from an old account or school stop before storage or navigation', async () => {
  let current = true;
  const access = { ...context, isCurrent: () => current };
  const nav = navigation();
  const view = render(<Harness initial={createAssistantCalendarTask(event, access)} access={access} nav={nav} />);
  current = false;
  await act(async () => fireEvent.press(view.getByRole('button', { name: '確認加入個人行事曆' })));
  expect(AsyncStorage.getItem).not.toHaveBeenCalled();
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  expect(nav.navigate).not.toHaveBeenCalled();
});

test('rechecking a completed card keeps its original proof and timestamp when reading is temporarily unavailable', async () => {
  const changed = jest.fn();
  const view = render(<Harness initial={createAssistantCalendarTask(event, context)} nav={navigation()} changed={changed} />);
  await act(async () => fireEvent.press(view.getByRole('button', { name: '確認加入個人行事曆' })));
  const before = changed.mock.calls.at(-1)![0];
  jest.mocked(AsyncStorage.getItem).mockRejectedValueOnce(new Error('temporary storage read failure'));
  await act(async () => fireEvent.press(view.getByRole('button', { name: '重新核對行程' })));
  expect(view.getByText('已在這台手機保存並核對行程。')).toBeTruthy();
  expect(view.getByRole('alert')).toHaveTextContent(/仍保留先前已核對的回執與時間/);
  const after = changed.mock.calls.at(-1)![0];
  expect(after.state).toBe('verified');
  expect(after.receipt).toEqual(before.receipt);
  expect(AsyncStorage.setItem).toHaveBeenCalledTimes(1);
});

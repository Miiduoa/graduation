import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { WorkspaceStart } from '../components/WorkspaceStart';
import { safeNavigate } from '../utils/safeNavigate';

jest.mock('../utils/safeNavigate', () => ({ safeNavigate: jest.fn(() => true) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
const navigation = { navigate: jest.fn() };
beforeEach(() => jest.clearAllMocks());

test('the composer does not become a nested vertical scroller', () => {
  const view = render(<WorkspaceStart navigation={navigation} scope="student-a:pu" />);
  expect(view.getByLabelText('想交給 nuni 的事').props.scrollEnabled).toBe(false);
});

test('choosing an example only fills the draft until the user continues', () => {
  const view = render(<WorkspaceStart navigation={navigation} scope="student-a:pu" />);
  fireEvent.press(view.getByLabelText('填入問題：下一堂課在哪裡'));
  expect(view.getByLabelText('想交給 nuni 的事').props.value).toBe('下一堂課在哪裡');
  expect(safeNavigate).not.toHaveBeenCalled();
  fireEvent.press(view.getByLabelText('帶著問題開啟 nuni'));
  expect(safeNavigate).toHaveBeenCalledWith(navigation, 'AIChat', expect.objectContaining({
    prompt: '下一堂課在哪裡', taskProfile: 'student', draftEntryId: expect.any(String),
  }));
});

test('account or campus changes discard a typed draft before it can be carried onward', () => {
  const view = render(<WorkspaceStart navigation={navigation} scope="student-a:pu" />);
  fireEvent.changeText(view.getByLabelText('想交給 nuni 的事'), '這是 A 的私人安排');
  view.rerender(<WorkspaceStart navigation={navigation} scope="student-b:pu" />);
  expect(view.getByLabelText('想交給 nuni 的事').props.value).toBe('');
  fireEvent.changeText(view.getByLabelText('想交給 nuni 的事'), '另一所學校的安排');
  view.rerender(<WorkspaceStart navigation={navigation} scope="student-b:nthu" />);
  expect(view.getByLabelText('想交給 nuni 的事').props.value).toBe('');
  expect(view.getByLabelText('帶著問題開啟 nuni').props.accessibilityState.disabled).toBe(true);
  expect(safeNavigate).not.toHaveBeenCalled();
});

test('professional examples preserve the real native work context without requesting data', () => {
  const view = render(<WorkspaceStart navigation={navigation} scope="platform-a:pu"
    assistantRoute="NuniTimetableAssistant" workContext="merchant" />);
  fireEvent.press(view.getByLabelText('填入問題：安排明天下午半小時盤點'));
  expect(safeNavigate).not.toHaveBeenCalled();
  fireEvent.press(view.getByLabelText('帶著問題開啟 nuni'));
  expect(safeNavigate).toHaveBeenCalledWith(navigation, 'NuniTimetableAssistant', expect.objectContaining({
    prompt: '安排明天下午半小時盤點', taskProfile: 'merchant',
  }));
  fireEvent.press(view.getByLabelText('探索更多 nuni 用法'));
  expect(safeNavigate).toHaveBeenLastCalledWith(navigation, 'Explore', { workContext: 'merchant' });
});

import React, { useState } from 'react';
import * as Native from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import type { NuniFoodLocationSummary } from '@campus/shared/src/nuniFoodTypes';
import { PickupTimePicker } from '../screens/nuni/PickupTimePicker';

jest.mock('../state/theme', () => ({ useTheme: () => require('../ui/theme').theme }));
jest.mock('../state/nuniSession', () => ({ useNuniSession: jest.fn() }));

const now = Date.parse('2026-11-01T15:50:00.000Z');
const location: NuniFoodLocationSummary = {
  id: 'one',
  campusId: 'main',
  name: '餐坊',
  description: '',
  zoneLabel: '',
  timeZone: 'Asia/Taipei',
  state: 'open',
  merchantMode: 'full',
  sourceLabel: '門市',
  sourceUpdatedAt: null,
  allowedActions: ['view-menu'],
};

function Picker() {
  const [value, onChange] = useState('30');
  return <PickupTimePicker {...{ value, onChange, location, now }} />;
}

afterEach(() => jest.restoreAllMocks());

test('快捷立即更新選取狀態與跨午夜預覽，也能改填分鐘', () => {
  const view = render(<Picker />);
  for (const [minutes, time] of [
    [15, '00:05'],
    [30, '00:20'],
    [60, '00:50'],
  ] as const) {
    fireEvent.press(view.getByRole('button', { name: `${minutes} 分鐘後` }));
    expect(view.getByRole('button', { name: `${minutes} 分鐘後`, selected: true })).toBeTruthy();
    expect(view.getByLabelText('幾分鐘後取餐')).toHaveProp('value', String(minutes));
    expect(view.getByText(`預計取餐 2026/11/02 ${time}（台灣時間）`)).toBeTruthy();
  }
  fireEvent.changeText(view.getByLabelText('幾分鐘後取餐'), '45');
  expect(view.queryByRole('button', { selected: true })).toBeNull();
  expect(view.getByText('預計取餐 2026/11/02 00:35（台灣時間）')).toBeTruthy();
  expect(view.getByText(/並非門市保留的時段/)).toBeTruthy();
  expect(view.getByText(/門市尚未提供取餐時間範圍/)).toBeTruthy();
});

test.each(['', '0', '1441', '1.5', '15.0', '-1', '文字'])('輸入「%s」後能用快捷修正', (value) => {
  const view = render(<Picker />);
  fireEvent.changeText(view.getByLabelText('幾分鐘後取餐'), value);
  expect(view.getByRole('alert')).toHaveTextContent(/請.*1–1,440/);
  expect(view.queryByText(/^預計取餐 /)).toBeNull();
  expect(view.queryByRole('button', { selected: true })).toBeNull();
  fireEvent.press(view.getByRole('button', { name: '15 分鐘後' }));
  expect(view.queryByRole('alert')).toBeNull();
  expect(view.getByText('預計取餐 2026/11/02 00:05（台灣時間）')).toBeTruthy();
});

test('待確認時不能更改時間，畫面保留原本送出的時間', () => {
  const onChange = jest.fn();
  const view = render(
    <PickupTimePicker
      value="15"
      {...{ location, onChange }}
      now={now + 60 * 60_000}
      disabled
      pendingPickupAt="2026-11-01T16:05:00.000Z"
    />,
  );
  for (const minutes of [15, 30, 60]) {
    const button = view.getByRole('button', { name: `${minutes} 分鐘後` });
    expect(button).toBeDisabled();
    fireEvent.press(button);
  }
  expect(onChange).not.toHaveBeenCalled();
  expect(view.getByLabelText('幾分鐘後取餐')).toHaveProp('editable', false);
  expect(view.getByText('這次取餐時間 2026/11/02 00:05（台灣時間）')).toBeTruthy();
});

test.each([
  [320, 1],
  [390, 2],
  [320, 2],
])('寬度 %s、字級倍率 %s 時快捷直排且保留完整文字', (width, fontScale) => {
  jest
    .spyOn(Native, 'useWindowDimensions')
    .mockReturnValue({ width, height: 844, scale: 1, fontScale });
  const view = render(<Picker />);
  const button = view.getByRole('button', { name: '60 分鐘後' });
  expect(view.getByTestId('pickup-time-options')).toHaveStyle({ flexDirection: 'column' });
  expect(view.getByText('60 分鐘後').props.numberOfLines).toBeUndefined();
  expect(
    view.getByText('預計取餐 2026/11/02 00:20（台灣時間）').props.numberOfLines,
  ).toBeUndefined();
  fireEvent.press(button);
  expect(view.getByLabelText('幾分鐘後取餐')).toHaveProp('value', '60');
});

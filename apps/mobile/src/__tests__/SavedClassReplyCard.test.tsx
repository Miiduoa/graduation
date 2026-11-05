import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { SavedClassReplyCard } from '../screens/SavedClassReplyCard';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
const first = {
  term: '115|1', courseId: 'a', name: '資訊管理專題', room: '主顧 210', date: '2026-11-05',
  startTime: '09:10', endTime: '10:00',
};
const second = { ...first, courseId: 'b', room: '研教 303' };

test('distinguishes simultaneous classes by room and opens only the pressed occurrence', () => {
  const open = jest.fn();
  const view = render(<SavedClassReplyCard classes={[first, second]} updatedAt="2026-11-04T16:20:00Z" disabled={false} onOpen={open} />);
  expect(view.getByText(/手機儲存課表.*2026\/11\/5 上午12:20/)).toBeTruthy();
  const chosen = view.getByRole('button', { name: /在課表中查看資訊管理專題.*週四.*09:10–10:00.*研教 303/ });
  expect(view.getAllByRole('button')).toHaveLength(2);
  expect(open).not.toHaveBeenCalled();
  fireEvent.press(chosen);
  expect(open).toHaveBeenCalledTimes(1);
  expect(open).toHaveBeenCalledWith(second);
});

test('shows missing room and save time, and blocks disabled navigation', () => {
  const open = jest.fn();
  const view = render(<SavedClassReplyCard classes={[{ ...first, room: ' ' }]} updatedAt={null} disabled onOpen={open} />);
  expect(view.getByText('教室未填')).toBeTruthy();
  expect(view.getByText(/儲存時間未知/)).toBeTruthy();
  const row = view.getByRole('button', { name: /教室未填/, disabled: true });
  fireEvent.press(row);
  expect(open).not.toHaveBeenCalled();
});

test('renders no card without a matched class', () => {
  const view = render(<SavedClassReplyCard classes={[]} updatedAt={null} disabled={false} onOpen={jest.fn()} />);
  expect(view.toJSON()).toBeNull();
});

test.each(['room', 'time'] as const)('puts the requested %s first and keeps the other class details visible', (focus) => {
  const view = render(<SavedClassReplyCard classes={[first]} updatedAt={null} disabled={false} focus={focus} onOpen={jest.fn()} />);
  expect(view.getAllByText(/^(主顧 210|09:10–10:00|資訊管理專題)$/)[0].props.children).toBe(focus === 'room' ? '主顧 210' : '09:10–10:00');
  expect(view.getByText(first.room)).toBeTruthy();
  expect(view.getByText(first.name)).toBeTruthy();
  expect(view.getByText('09:10–10:00')).toBeTruthy();
  expect(view.getByText(/週四/)).toBeTruthy();
});

test('labels an overnight class end on the following day', () => {
  const overnight = { ...first, startTime: '23:10', endTime: '00:20' };
  const view = render(<SavedClassReplyCard classes={[overnight]} updatedAt={null} disabled={false} onOpen={jest.fn()} />);
  expect(view.getByText('23:10–隔日 00:20')).toBeTruthy();
  expect(view.getByRole('button', { name: /23:10–隔日 00:20/ })).toBeTruthy();
});

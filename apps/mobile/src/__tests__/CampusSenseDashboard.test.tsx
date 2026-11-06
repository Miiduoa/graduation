import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { CampusSenseDashboard } from '../screens/CampusSenseDashboard';
import type { CampusSenseSnapshot } from '../services/campusSenseSnapshot';

jest.mock('../screens/CampusAssignmentWorkbench', () => ({ CampusAssignmentWorkbench: () => null }));

const snapshot: CampusSenseSnapshot = {
  userId: 'a', schoolId: 'pu', checkedAt: '2026-11-05T10:00:00Z',
  assignments: { status: 'available', count: 0, items: [] },
  schedule: { status: 'available', count: 0 },
  announcements: { status: 'available', items: [
    { title: '圖書館開館時間', publishedAt: '2026-11-04T16:15:00Z', source: { kind: 'school-announcement', id: 'a1' } },
    { title: '圖書館開館時間', publishedAt: '2026-11-04T16:15:00Z', source: { kind: 'school-announcement', id: 'a2' } },
    { title: '體育館維修', publishedAt: null },
    { title: '明天才發布', publishedAt: '2026-11-06T09:00:00Z' },
  ] },
};
const props = {
  expired: false, authenticated: true, busy: false, syncBusy: false, error: '',
  onSync: jest.fn(), onClear: jest.fn(), onBrief: jest.fn(), onWeekBrief: jest.fn(),
};

test('discloses only the observed announcements and opens the selected source even with identical titles and dates', () => {
  const open = jest.fn();
  const overview = jest.fn();
  const view = render(<CampusSenseDashboard {...props} snapshot={snapshot}
    onOpenAnnouncement={open} onOpenAnnouncements={overview} />);
  const toggle = () => view.getByRole('button', { name: '本次同步的公告' });
  expect(toggle().props.accessibilityState.expanded).toBe(false);
  expect(view.getByText('查看本次同步的 3 則公告')).toBeTruthy();
  expect(view.queryByText('體育館維修')).toBeNull();
  fireEvent.press(toggle());
  expect(toggle().props.accessibilityState.expanded).toBe(true);
  expect(view.getAllByText('2026/11/5 發布')).toHaveLength(2);
  expect(view.getByText('未提供發布日期')).toBeTruthy();
  expect(view.queryByText('明天才發布')).toBeNull();
  expect(view.queryByRole('button', { name: /體育館維修/ })).toBeNull();
  fireEvent.press(view.getByRole('button', { name: /開啟公告，第 2 則，圖書館開館時間/ }));
  expect(open).toHaveBeenCalledWith(snapshot.announcements.items[1]);
  fireEvent.press(view.getByRole('button', { name: '前往公告總覽' }));
  expect(overview).toHaveBeenCalledTimes(1);
  fireEvent.press(toggle());
  expect(view.queryByText('未提供發布日期')).toBeNull();
});

test.each([
  { userId: 'b' }, { schoolId: 'nthu' }, { checkedAt: '2026-11-05T11:00:00Z' },
])('a different observation starts collapsed (%j)', (changes) => {
  const view = render(<CampusSenseDashboard {...props} snapshot={snapshot} />);
  fireEvent.press(view.getByRole('button', { name: '本次同步的公告' }));
  expect(view.getByText('體育館維修')).toBeTruthy();
  view.rerender(<CampusSenseDashboard {...props} snapshot={{ ...snapshot, ...changes }} />);
  expect(view.queryByText('體育館維修')).toBeNull();
  expect(view.getByRole('button', { name: '本次同步的公告' }).props.accessibilityState.expanded).toBe(false);
});

test('a refresh hides expanded details immediately and cancellation does not reopen them', () => {
  const view = render(<CampusSenseDashboard {...props} snapshot={snapshot} />);
  fireEvent.press(view.getByRole('button', { name: '本次同步的公告' }));
  view.rerender(<CampusSenseDashboard {...props} syncBusy snapshot={snapshot} />);
  expect(view.queryByText('體育館維修')).toBeNull();
  view.rerender(<CampusSenseDashboard {...props} snapshot={snapshot} />);
  expect(view.queryByText('體育館維修')).toBeNull();
});

test('distinguishes an empty source, unavailable announcements, partial assignments, and no sources', () => {
  const view = render(<CampusSenseDashboard {...props} snapshot={{
    ...snapshot, announcements: { status: 'available', items: [] },
  }} />);
  expect(view.getByText('已同步')).toBeTruthy();
  expect(view.getByText('這次同步沒有可顯示的公告。')).toBeTruthy();
  view.rerender(<CampusSenseDashboard {...props} snapshot={{
    ...snapshot, announcements: { status: 'unavailable', items: snapshot.announcements.items },
  }} />);
  expect(view.getByText('部分資料')).toBeTruthy();
  expect(view.getByText('本次未取得公告來源，無法確認有幾則公告。')).toBeTruthy();
  expect(view.queryByText('體育館維修')).toBeNull();
  expect(view.queryByRole('button', { name: '本次同步的公告' })).toBeNull();
  view.rerender(<CampusSenseDashboard {...props} snapshot={{
    ...snapshot, assignments: { status: 'available', count: 1, items: [] },
  }} />);
  expect(view.getByText('部分資料')).toBeTruthy();
  view.rerender(<CampusSenseDashboard {...props} snapshot={{
    ...snapshot, announcements: { status: 'unavailable', items: [] },
    assignments: { status: 'unavailable', count: null, items: [] }, schedule: { status: 'unavailable', count: null },
  }} />);
  expect(view.getByText('未取得資料')).toBeTruthy();
  expect(view.queryByText('已取得本次授權資料')).toBeNull();
});

test('disables opening an announcement or the overview while another assistant operation is running', () => {
  const open = jest.fn();
  const overview = jest.fn();
  const base = { ...props, snapshot, onOpenAnnouncement: open, onOpenAnnouncements: overview };
  const view = render(<CampusSenseDashboard {...base} />);
  fireEvent.press(view.getByRole('button', { name: '本次同步的公告' }));
  view.rerender(<CampusSenseDashboard {...base} busy />);
  fireEvent.press(view.getByRole('button', { name: /開啟公告，第 1 則/ }));
  fireEvent.press(view.getByRole('button', { name: '前往公告總覽' }));
  expect(open).not.toHaveBeenCalled();
  expect(overview).not.toHaveBeenCalled();
});

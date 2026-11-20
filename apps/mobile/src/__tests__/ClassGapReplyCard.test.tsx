import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { ClassGapReplyCard } from '../screens/ClassGapReplyCard';
import type { SavedClassGapQuery } from '../services/savedClassGapQuery';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

const content = '13:30–15:30（120 分鐘）\n依手機課表計算，儲存時間不詳。';
const query: SavedClassGapQuery = { day: 'today', minMinutes: 0 };

test.each([
  ['today', '今日空堂', '改查今天', [['改查明天', '那明天呢？'], ['改查後天', '那後天呢？']]],
  ['tomorrow', '明日空堂', '改查明天', [['改查今天', '那今天呢？'], ['改查後天', '那後天呢？']]],
  ['day-after-tomorrow', '後天空堂', '改查後天', [['改查今天', '那今天呢？'], ['改查明天', '那明天呢？']]],
] as const)('offers only the other dates for a %s result', (day, title, current, choices) => {
  const ask = jest.fn();
  const view = render(<ClassGapReplyCard query={{ ...query, day }} content={content} latest busy={false} onAsk={ask} />);
  expect(view.getByText(title)).toBeTruthy();
  expect(view.getByText(content).props.selectable).toBe(true);
  expect(view.queryByRole('button', { name: current })).toBeNull();
  expect(ask).not.toHaveBeenCalled();
  choices.forEach(([label, question], index) => {
    fireEvent.press(view.getByRole('button', { name: label }));
    expect(ask).toHaveBeenNthCalledWith(index + 1, question);
  });
  expect(ask).toHaveBeenCalledTimes(2);
});

test('sends a separate follow-up for each duration and time filter', () => {
  const ask = jest.fn();
  const filtered: SavedClassGapQuery = { ...query, minMinutes: 30, part: 'morning', fromMinute: 600 };
  const view = render(<ClassGapReplyCard query={filtered} content={content} latest busy={false} onAsk={ask} />);
  fireEvent.press(view.getByRole('button', { name: '只看一小時以上' }));
  fireEvent.press(view.getByRole('button', { name: '不限長度' }));
  fireEvent.press(view.getByRole('button', { name: '查看全天' }));
  fireEvent.press(view.getByRole('button', { name: '只看下午' }));
  expect(ask.mock.calls).toEqual([['至少一小時呢？'], ['不限長度'], ['全天'], ['只看下午']]);
});

test.each([60, 120])('does not offer a redundant afternoon filter or shorten a %i minute minimum', (minMinutes) => {
  const view = render(<ClassGapReplyCard query={{ ...query, minMinutes, part: 'afternoon' }}
    content={content} latest busy={false} onAsk={jest.fn()} />);
  expect(view.queryByRole('button', { name: '只看一小時以上' })).toBeNull();
  expect(view.queryByRole('button', { name: '只看下午' })).toBeNull();
  expect(view.getByRole('button', { name: '不限長度' })).toBeTruthy();
  expect(view.getByRole('button', { name: '查看全天' })).toBeTruthy();
});

test.each([{ fromMinute: 0 }, { untilMinute: 1440 }])('allows clearing a clock bound without a named day part: %j', (bounds) => {
  const ask = jest.fn();
  const view = render(<ClassGapReplyCard query={{ ...query, ...bounds }} content={content} latest busy={false} onAsk={ask} />);
  fireEvent.press(view.getByRole('button', { name: '查看全天' }));
  expect(ask).toHaveBeenCalledWith('全天');
});

test('does not offer reset buttons when there are no corresponding filters', () => {
  const view = render(<ClassGapReplyCard query={query} content={content} latest busy={false} onAsk={jest.fn()} />);
  expect(view.queryByRole('button', { name: '查看全天' })).toBeNull();
  expect(view.queryByRole('button', { name: '不限長度' })).toBeNull();
  expect(view.queryByRole('button', { name: '開啟我的課表' })).toBeNull();
});

test('removes filter controls when a newer reply arrives, while keeping the answer and source navigation', () => {
  const ask = jest.fn();
  const open = jest.fn();
  const props = { query: { ...query, minMinutes: 30, part: 'evening' as const }, content, busy: false, onAsk: ask, onOpenTimetable: open };
  const view = render(<ClassGapReplyCard {...props} latest />);
  expect(view.getByRole('button', { name: '查看全天' })).toBeTruthy();
  view.rerender(<ClassGapReplyCard {...props} latest={false} />);
  expect(view.getByText(content).props.selectable).toBe(true);
  expect(view.getAllByRole('button')).toHaveLength(1);
  fireEvent.press(view.getByRole('button', { name: '開啟我的課表' }));
  expect(open).toHaveBeenCalledTimes(1);
  expect(ask).not.toHaveBeenCalled();
});

test('blocks every action while busy and enables the current actions when the request finishes', () => {
  const ask = jest.fn();
  const open = jest.fn();
  const props = { query: { ...query, minMinutes: 30, fromMinute: 600 }, content, latest: true, onAsk: ask, onOpenTimetable: open };
  const view = render(<ClassGapReplyCard {...props} busy />);
  const buttons = view.getAllByRole('button');
  expect(view.getAllByRole('button', { disabled: true })).toHaveLength(buttons.length);
  buttons.forEach((button) => fireEvent.press(button));
  expect(ask).not.toHaveBeenCalled();
  expect(open).not.toHaveBeenCalled();
  view.rerender(<ClassGapReplyCard {...props} busy={false} />);
  fireEvent.press(view.getByRole('button', { name: '改查後天' }));
  fireEvent.press(view.getByRole('button', { name: '開啟我的課表' }));
  expect(ask).toHaveBeenCalledWith('那後天呢？');
  expect(open).toHaveBeenCalledTimes(1);
});

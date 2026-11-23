import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { Animated, Text } from 'react-native';
import { AnimatedCard, Button, Card } from '../../ui/components';

let mockReducedMotion = false;
jest.mock('../../hooks/useReducedMotion', () => ({
  useReducedMotion: () => mockReducedMotion,
}));

beforeEach(() => {
  mockReducedMotion = false;
});
afterEach(() => {
  jest.restoreAllMocks();
});

test('a pending action preserves its label, icon and contrast while preventing another submission', () => {
  const press = jest.fn();
  const view = render(
    <Button text="儲存這門課程的提醒" icon="calendar-outline" onPress={press} kind="primary" />,
  );
  const label = view.getByText('儲存這門課程的提醒');
  const color = label.props.style.color;
  const button = view.getByRole('button', { name: '儲存這門課程的提醒' });
  fireEvent.press(button);
  expect(press).toHaveBeenCalledTimes(1);

  view.rerender(
    <Button
      text="儲存這門課程的提醒"
      icon="calendar-outline"
      onPress={press}
      kind="primary"
      loading
    />,
  );
  expect(view.getByText('儲存這門課程的提醒')).toBe(label);
  expect(label).toHaveStyle({ color, flexShrink: 1 });
  expect(view.getByRole('button')).toBe(button);
  expect(button).toHaveAccessibilityState({ disabled: true, busy: true });
  expect(button.props.accessibilityValue).toEqual({ text: '處理中' });
  fireEvent.press(button);
  expect(press).toHaveBeenCalledTimes(1);

  view.rerender(
    <Button text="儲存這門課程的提醒" icon="calendar-outline" onPress={press} kind="primary" />,
  );
  expect(button).toHaveAccessibilityState({ disabled: false, busy: false });
  fireEvent.press(button);
  expect(press).toHaveBeenCalledTimes(2);
});

test('reducing motion stops an active progress animation and retains visible pending feedback', () => {
  const stop = jest.fn();
  const loop = jest.spyOn(Animated, 'loop').mockReturnValue({
    start: jest.fn(),
    stop,
    reset: jest.fn(),
  });
  const view = render(<Button text="同步資料" loading />);
  expect(loop).toHaveBeenCalledTimes(1);
  mockReducedMotion = true;
  view.rerender(<Button text="同步資料" loading />);
  expect(stop).toHaveBeenCalledTimes(1);
  expect(view.getByRole('button', { name: '同步資料' })).toHaveAccessibilityState({ busy: true });
  expect(loop).toHaveBeenCalledTimes(1);
  view.unmount();
});

test('progress animation is cancelled when its button leaves the screen', () => {
  const stop = jest.fn();
  jest.spyOn(Animated, 'loop').mockReturnValue({ start: jest.fn(), stop, reset: jest.fn() });
  const view = render(<Button text="同步資料" loading />);
  view.unmount();
  expect(stop).toHaveBeenCalledTimes(1);
});

test('a delayed card immediately becomes readable when motion is reduced and never replays', () => {
  const stop = jest.fn();
  const parallel = jest.spyOn(Animated, 'parallel').mockReturnValue({
    start: jest.fn(),
    stop,
    reset: jest.fn(),
  });
  const view = render(
    <AnimatedCard delay={8000} title="下一份作業">
      <Text>下週繳交</Text>
    </AnimatedCard>,
  );
  expect(parallel).toHaveBeenCalledTimes(1);
  mockReducedMotion = true;
  view.rerender(
    <AnimatedCard delay={8000} title="下一份作業">
      <Text>下週繳交</Text>
    </AnimatedCard>,
  );
  expect(stop).toHaveBeenCalledTimes(1);
  expect(view.getByText('下一份作業')).toBeVisible();
  expect(view.getByText('下週繳交')).toBeVisible();
  mockReducedMotion = false;
  view.rerender(
    <AnimatedCard delay={8000} title="下一份作業">
      <Text>下週繳交</Text>
    </AnimatedCard>,
  );
  expect(parallel).toHaveBeenCalledTimes(1);
});

test('reduced motion keeps a new card readable without waiting for a stagger', () => {
  mockReducedMotion = true;
  const parallel = jest.spyOn(Animated, 'parallel');
  const view = render(
    <AnimatedCard title="課程教材" delay={8000}>
      <Button text="開啟教材" />
    </AnimatedCard>,
  );
  expect(parallel).not.toHaveBeenCalled();
  expect(view.getByText('課程教材')).toBeVisible();
  expect(view.getByRole('button', { name: '開啟教材' })).toBeVisible();
});

test('leaving a card cancels the pending entrance animation', () => {
  const stop = jest.fn();
  let complete: ((result: { finished: boolean }) => void) | undefined;
  jest.spyOn(Animated, 'parallel').mockReturnValue({
    start: jest.fn((callback) => {
      complete = callback;
    }),
    stop,
    reset: jest.fn(),
  });
  const view = render(<AnimatedCard title="課程教材" />);
  view.unmount();
  expect(stop).toHaveBeenCalledTimes(1);
  act(() => complete?.({ finished: true }));
});

test('a card remains operable when press movement is disabled', () => {
  mockReducedMotion = true;
  const press = jest.fn();
  const view = render(<Card title="查看課程" onPress={press} />);
  fireEvent.press(view.getByText('查看課程'));
  expect(press).toHaveBeenCalledTimes(1);
});

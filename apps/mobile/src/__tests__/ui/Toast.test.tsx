import React from 'react';
import {
  AccessibilityInfo,
  Animated,
  AppState,
  Platform,
  ScrollView,
  type AppStateStatus,
} from 'react-native';
import { act, cleanup, fireEvent, render } from '@testing-library/react-native/pure';
import { ThemeProvider } from '../../state/theme';
import { ToastProvider, SnackbarProvider, useToast, useSnackbar } from '../../ui/Toast';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('expo-blur', () => ({
  BlurView: ({ children, ...props }: { children: React.ReactNode }) => {
    const { View } = require('react-native');
    return <View {...props}>{children}</View>;
  },
}));
let mockReducedMotion = true;
jest.mock('../../hooks/useReducedMotion', () => ({ useReducedMotion: () => mockReducedMotion }));

let api: ReturnType<typeof useToast>;
let snackbar: ReturnType<typeof useSnackbar>;
let appChange: (state: AppStateStatus) => void;
let readerChange: (enabled: boolean) => void;
let removals: jest.Mock[];

function Consumer() {
  api = useToast();
  return null;
}
function SnackbarConsumer() {
  snackbar = useSnackbar();
  return null;
}
function fixture(maxToasts?: number) {
  return (
    <ThemeProvider>
      <ToastProvider maxToasts={maxToasts}>
        <Consumer />
      </ToastProvider>
    </ThemeProvider>
  );
}
function snackbarFixture() {
  return (
    <ThemeProvider>
      <SnackbarProvider>
        <SnackbarConsumer />
      </SnackbarProvider>
    </ThemeProvider>
  );
}
function advance(ms: number) {
  act(() => jest.advanceTimersByTime(ms));
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers({ doNotFake: ['setImmediate'] });
  mockReducedMotion = true;
  removals = [];
  Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'active' });
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    appChange = listener as (state: AppStateStatus) => void;
    const remove = jest.fn();
    removals.push(remove);
    return { remove };
  });
  jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation((_event, listener) => {
    readerChange = listener as (enabled: boolean) => void;
    const remove = jest.fn();
    removals.push(remove);
    return { remove };
  });
  jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(false);
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
});
afterEach(() => {
  // This suite intentionally owns the expiry clock. Unmount before restoring it;
  // the auto-cleanup setImmediate polyfill otherwise waits on that frozen clock.
  cleanup();
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

test('background time does not consume the remaining reading time', async () => {
  const view = render(fixture());
  await act(async () => {});
  act(() => api.success('已儲存安排'));
  advance(2500);
  act(() => appChange('background'));
  advance(60000);
  expect(view.getByText('已儲存安排')).toBeTruthy();
  act(() => appChange('active'));
  advance(999);
  expect(view.getByText('已儲存安排')).toBeTruthy();
  advance(1);
  expect(view.queryByText('已儲存安排')).toBeNull();
});

test('a notification received in the background has its whole duration after returning', async () => {
  Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'background' });
  const view = render(fixture());
  await act(async () => {});
  act(() => api.info('資料已更新', { duration: 1000 }));
  advance(10000);
  expect(view.getByText('資料已更新')).toBeTruthy();
  act(() => appChange('active'));
  advance(999);
  expect(view.getByText('資料已更新')).toBeTruthy();
  advance(1);
  expect(view.queryByText('資料已更新')).toBeNull();
});

test('a live screen-reader change wins over a delayed initial reading and pauses expiry', async () => {
  const initial = deferred<boolean>();
  jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockReturnValue(initial.promise);
  const view = render(fixture());
  act(() => api.info('保留通知供閱讀', { duration: 1000 }));
  advance(5000);
  expect(view.getByText('保留通知供閱讀')).toBeTruthy();
  act(() => readerChange(true));
  await act(async () => initial.resolve(false));
  advance(5000);
  expect(view.getByText('保留通知供閱讀')).toBeTruthy();
  act(() => readerChange(false));
  advance(999);
  expect(view.getByText('保留通知供閱讀')).toBeTruthy();
  advance(1);
  expect(view.queryByText('保留通知供閱讀')).toBeNull();
});

test('a touch or keyboard focus preserves the remaining reading time', async () => {
  const view = render(fixture());
  await act(async () => {});
  act(() => api.info('正在閱讀的通知', { duration: 1000 }));
  advance(400);
  const close = view.getByRole('button', { name: '關閉通知' });
  fireEvent(close, 'focus');
  fireEvent(view.getByText('正在閱讀的通知'), 'touchStart');
  fireEvent(view.getByText('正在閱讀的通知'), 'touchEnd');
  advance(5000);
  expect(view.getByText('正在閱讀的通知')).toBeTruthy();
  fireEvent(close, 'blur');
  advance(599);
  expect(view.getByText('正在閱讀的通知')).toBeTruthy();
  advance(1);
  expect(view.queryByText('正在閱讀的通知')).toBeNull();
});

test('queued notifications do not expire before reaching the front of the stack', async () => {
  const view = render(fixture());
  await act(async () => {});
  let first!: string;
  act(() => {
    first = api.info('仍在閱讀第一則長訊息', { duration: 0 });
    api.info('稍後才看得到的第二則', { duration: 1000 });
  });
  advance(60000);
  expect(view.getByText('稍後才看得到的第二則')).toBeTruthy();
  act(() => api.dismiss(first));
  advance(999);
  expect(view.getByText('稍後才看得到的第二則')).toBeTruthy();
  advance(1);
  expect(view.queryByText('稍後才看得到的第二則')).toBeNull();
});

test('scrolling the stack pauses expiry and a fresh stack starts with a fresh reading clock', async () => {
  const view = render(fixture());
  await act(async () => {});
  act(() => api.info('正在捲動的通知', { duration: 1000 }));
  advance(300);
  const stack = view
    .UNSAFE_getAllByType(ScrollView)
    .find((node) => node.props.scrollEventThrottle === 16)!;
  fireEvent.scroll(stack, { nativeEvent: { contentOffset: { y: 120 } } });
  advance(10000);
  expect(view.getByText('正在捲動的通知')).toBeTruthy();
  fireEvent.scroll(stack, { nativeEvent: { contentOffset: { y: 0 } } });
  advance(699);
  expect(view.getByText('正在捲動的通知')).toBeTruthy();
  advance(1);
  expect(view.queryByText('正在捲動的通知')).toBeNull();
  act(() => api.info('下一次通知', { duration: 1000 }));
  advance(1000);
  expect(view.queryByText('下一次通知')).toBeNull();
});

test('text requiring its own scroll stays available until the person closes it', async () => {
  const view = render(fixture());
  await act(async () => {});
  act(() => api.info('完整閱讀內容', { duration: 1000 }));
  const body = view.UNSAFE_getAllByType(ScrollView).find((node) => node.props.onContentSizeChange)!;
  fireEvent(body, 'contentSizeChange', 180, 1600);
  advance(10000);
  expect(view.getByText('完整閱讀內容')).toBeTruthy();
  fireEvent.press(view.getByRole('button', { name: '關閉通知' }));
  expect(view.queryByText('完整閱讀內容')).toBeNull();
});

test('actionable notifications remain available and rapid presses execute the action once', async () => {
  const perform = jest.fn();
  const view = render(fixture());
  await act(async () => {});
  act(() =>
    api.success('已移除課程，可復原這次操作', { action: { text: '復原', onPress: perform } }),
  );
  advance(60000);
  const button = view.getByRole('button', { name: '復原' });
  expect(button).toHaveStyle({ minHeight: 44 });
  act(() => {
    fireEvent.press(button);
    fireEvent.press(button);
  });
  expect(perform).toHaveBeenCalledTimes(1);
  expect(view.queryByText('已移除課程，可復原這次操作')).toBeNull();
});

test('an explicitly timed action retains its configured expiry', async () => {
  const perform = jest.fn();
  const view = render(fixture());
  await act(async () => {});
  act(() =>
    api.show({ message: '限時提示', action: { text: '查看', onPress: perform }, duration: 500 }),
  );
  advance(500);
  expect(view.queryByText('限時提示')).toBeNull();
  expect(perform).not.toHaveBeenCalled();
});

test('long messages remain complete and the close control is discoverable at large text sizes', async () => {
  const message = '已儲存課程提醒。'.repeat(45) + '下一步請核對期末報告截止時間。';
  const view = render(fixture());
  await act(async () => {});
  act(() => api.warning(message, { duration: 0 }));
  expect(view.getByText(message).props.numberOfLines).toBeUndefined();
  expect(view.getByRole('button', { name: '關閉通知' })).toHaveStyle({ width: 44, height: 44 });
  advance(60000);
  fireEvent.press(view.getByRole('button', { name: '關閉通知' }));
  expect(view.queryByText(message)).toBeNull();
});

test('unknown reader state keeps the notification readable and manually dismissible', async () => {
  jest
    .spyOn(AccessibilityInfo, 'isScreenReaderEnabled')
    .mockRejectedValue(new Error('unavailable'));
  const view = render(fixture());
  await act(async () => {});
  act(() => api.error('連線失敗，稍後可以重試', { duration: 1000 }));
  advance(60000);
  expect(view.getByText('連線失敗，稍後可以重試')).toBeTruthy();
  fireEvent.press(view.getByRole('button', { name: '關閉通知' }));
  expect(view.queryByText('連線失敗，稍後可以重試')).toBeNull();
});

test('VoiceOver announcement waits for foreground and runs once per notification', async () => {
  const os = Platform.OS;
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' });
  Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'background' });
  jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(true);
  try {
    const view = render(fixture());
    await act(async () => {});
    act(() => api.success('附件上傳完成'));
    expect(AccessibilityInfo.announceForAccessibility).not.toHaveBeenCalled();
    act(() => appChange('active'));
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledTimes(1);
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith('附件上傳完成');
    act(() => appChange('background'));
    act(() => appChange('active'));
    advance(60000);
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledTimes(1);
    expect(view.getByText('附件上傳完成')).toBeTruthy();
  } finally {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: os });
  }
});

test('dismissAll and unmount release countdowns and native subscriptions', async () => {
  const view = render(fixture());
  await act(async () => {});
  act(() => {
    api.info('第一則通知');
    api.info('第二則通知');
  });
  act(() => jest.runAllTicks());
  expect(jest.getTimerCount()).toBe(1);
  act(() => api.dismissAll());
  act(() => jest.runAllTicks());
  expect(jest.getTimerCount()).toBe(0);
  act(() => api.info('離開頁面前的通知'));
  act(() => jest.runAllTicks());
  expect(jest.getTimerCount()).toBe(1);
  view.unmount();
  act(() => jest.runAllTicks());
  expect(jest.getTimerCount()).toBe(0);
  expect(removals).toHaveLength(2);
  for (const remove of removals) expect(remove).toHaveBeenCalledTimes(1);
});

test('evicting an older toast cannot dismiss the newer one', async () => {
  const view = render(fixture(1));
  await act(async () => {});
  act(() => api.info('舊通知', { duration: 1000 }));
  advance(900);
  act(() => api.info('新通知', { duration: 1000 }));
  advance(100);
  expect(view.queryByText('舊通知')).toBeNull();
  expect(view.getByText('新通知')).toBeTruthy();
  advance(900);
  expect(view.queryByText('新通知')).toBeNull();
});

function captureTransitions() {
  const transitions: { finish: (result: { finished: boolean }) => void; stop: jest.Mock }[] = [];
  jest.spyOn(Animated, 'parallel').mockImplementation(() => {
    const transition = { finish: (_result: { finished: boolean }) => {}, stop: jest.fn() };
    transitions.push(transition);
    return {
      start: (callback) => {
        transition.finish = callback!;
      },
      stop: transition.stop,
      reset: jest.fn(),
    };
  });
  return transitions;
}

test('switching to reduced motion during exit completes dismissal without an old callback affecting a later toast', async () => {
  mockReducedMotion = false;
  const transitions = captureTransitions();
  const view = render(fixture());
  await act(async () => {});
  act(() => api.info('即將關閉', { duration: 0 }));
  fireEvent.press(view.getByRole('button', { name: '關閉通知' }));
  const oldExit = transitions[transitions.length - 1];
  mockReducedMotion = true;
  view.rerender(fixture());
  expect(view.queryByText('即將關閉')).toBeNull();
  expect(oldExit.stop).toHaveBeenCalledTimes(1);
  act(() => api.info('新的結果', { duration: 0 }));
  act(() => oldExit.finish({ finished: true }));
  expect(view.getByText('新的結果')).toBeTruthy();
});

test('an interrupted snackbar exit cannot remove its replacement', async () => {
  mockReducedMotion = false;
  const transitions = captureTransitions();
  const view = render(snackbarFixture());
  await act(async () => {});
  act(() => snackbar.show({ message: '第一個結果', duration: 1000 }));
  advance(1000);
  const oldExit = transitions[transitions.length - 1];
  act(() => snackbar.show({ message: '第二個結果', duration: 0 }));
  expect(oldExit.stop).toHaveBeenCalledTimes(1);
  act(() => oldExit.finish({ finished: true }));
  expect(view.getByText('第二個結果')).toBeTruthy();
  expect(view.queryByText('第一個結果')).toBeNull();
  act(() => snackbar.dismiss());
  expect(view.queryByText('第二個結果')).toBeNull();
});

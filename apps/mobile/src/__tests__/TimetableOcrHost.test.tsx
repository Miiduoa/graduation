import React from 'react';
import { act, render, waitFor } from '@testing-library/react-native';
import { TimetableOcrHost, type TimetableOcrHandle } from '../components/TimetableOcrHost';

const mockInject = jest.fn();
let mockProps: Record<string, any>;
jest.mock('react-native-webview', () => ({
  WebView: require('react').forwardRef((props: Record<string, any>, ref: unknown) => {
    mockProps = props;
    require('react').useImperativeHandle(ref, () => ({ injectJavaScript: mockInject }));
    return null;
  }),
}));
jest.mock('../services/ocrLocalBase', () => ({ prepareOcrBaseUrl: async () => 'file:///ocr/' }));

beforeEach(() => {
  mockInject.mockClear();
});
it.each(['onError', 'onContentProcessDidTerminate', 'onRenderProcessGone'])(
  'recovers from %s without accepting stale host messages',
  async (event) => {
    const ref = React.createRef<TimetableOcrHandle>();
    render(<TimetableOcrHost ref={ref} />);
    await waitFor(() => expect(mockProps).toBeTruthy());
    act(() => mockProps.onMessage({ nativeEvent: { data: JSON.stringify({ ready: true }) } }));
    const first = ref.current!.recognize('a', 'image/png').catch((error: Error) => error.message);
    const oldProps = mockProps;
    act(() => oldProps[event]());
    expect(await first).toContain('記憶體不足');
    let next!: Promise<string>;
    await act(async () => {
      next = ref.current!.recognize('b', 'image/png');
    });
    let done = false;
    let staleError: string | undefined;
    void next.then(
      () => {
        done = true;
      },
      (error: Error) => {
        staleError = error.message;
      },
    );
    act(() => {
      mockProps.onMessage({ nativeEvent: { data: JSON.stringify({ ready: true }) } });
      oldProps.onError();
      oldProps.onContentProcessDidTerminate();
      oldProps.onRenderProcessGone();
    });
    act(() =>
      oldProps.onMessage({
        nativeEvent: { data: JSON.stringify({ id: 2, ok: true, text: '舊頁面' }) },
      }),
    );
    await Promise.resolve();
    expect(done).toBe(false);
    expect(staleError).toBeUndefined();
    act(() => {
      mockProps.onMessage({ nativeEvent: { data: JSON.stringify({ ready: true }) } });
      mockProps.onMessage({
        nativeEvent: { data: JSON.stringify({ id: 2, ok: true, text: '重試成功' }) },
      });
    });
    expect(await next).toBe('重試成功');
    expect(mockInject).toHaveBeenCalledWith(expect.stringContaining('recognizeTimetable(2'));
  },
);

import React from 'react';
import { Platform } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import { CampusCloudNavigationTask } from '../screens/CampusCloudNavigationTask';
import {
  createCloudNavigationRequestId,
  getCloudNavigationPreview,
  runCloudNavigationTask,
  type CloudNavigationPreview,
  type CloudNavigationResult,
} from '../features/cloudNavigation';

jest.mock('../features/cloudNavigation', () => ({
  createCloudNavigationRequestId: jest.fn(() => 'request-1'),
  getCloudNavigationPreview: jest.fn(),
  runCloudNavigationTask: jest.fn(),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

const previewRequest = jest.mocked(getCloudNavigationPreview);
const executeRequest = jest.mocked(runCloudNavigationTask);
const requestId = jest.mocked(createCloudNavigationRequestId);
const query = '從圖書館走到活動中心';
const checkedAt = '2026-11-01T12:00:00.000Z';
const preview: CloudNavigationPreview = {
  status: 'preview',
  provider: 'groq',
  model: 'openai/gpt-oss-120b',
  schoolId: 'pu',
  query,
  checkedAt,
  sourceUpdatedAt: null,
  fingerprint: 'a'.repeat(64),
  cloudReady: true,
  places: [
    { ref: 'p0', name: '圖書館', category: 'library', aliases: ['圖館'] },
    { ref: 'p1', name: '活動中心', category: 'student-center', aliases: [] },
  ],
};
const completed: CloudNavigationResult = {
  status: 'completed',
  provider: 'groq',
  model: 'openai/gpt-oss-120b',
  schoolId: 'pu',
  checkedAt,
  sourceUpdatedAt: null,
  route: {
    from: { id: 'library', name: '圖書館', schoolId: 'pu', lat: 24.2, lng: 120.5 },
    to: { id: 'center', name: '活動中心', schoolId: 'pu', lat: 24.21, lng: 120.51 },
    navigationUrl:
      'https://www.google.com/maps/dir/?api=1&origin=24.2%2C120.5&destination=24.21%2C120.51&travelmode=walking',
  },
};
const baseProps = {
  uid: 'fixture-user',
  schoolId: 'pu',
  schoolName: '靜宜大學',
  initialPrompt: query,
  isScopeCurrent: () => true,
};
type View = ReturnType<typeof render>;
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (value: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function showPreview(view: View) {
  await act(async () => fireEvent.press(view.getByText('預覽傳送內容')));
}
function consent(view: View) {
  fireEvent.press(view.getByRole('checkbox'));
}
function expectConsentState(view: View, checked: boolean) {
  // Native Pressable projects aria-checked into the host accessibilityState.
  expect(
    view.UNSAFE_getAllByProps({
      accessibilityRole: 'checkbox',
      'aria-checked': checked,
    }).length,
  ).toBeGreaterThan(0);
  expect(view.getByRole('checkbox').props.accessibilityState.checked).toBe(checked);
}
async function execute(view: View) {
  consent(view);
  await act(async () => fireEvent.press(view.getByText('確認規劃')));
}
beforeEach(() => {
  jest.clearAllMocks();
  previewRequest.mockReset().mockResolvedValue(preview);
  executeRequest.mockReset().mockResolvedValue(completed);
  requestId.mockReset().mockReturnValue('request-1');
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

test('a current guest can open the manual campus map without previewing or calling cloud execution', () => {
  const navigate = jest.fn();
  const view = render(
    <CampusCloudNavigationTask {...baseProps} uid="" navigation={{ navigate }} />,
  );
  fireEvent.press(view.getByText('自行查地圖'));
  expect(navigate).toHaveBeenCalledTimes(1);
  expect(navigate).toHaveBeenCalledWith('校園', {
    screen: 'MapV2',
    params: { schoolId: 'pu' },
  });
  expect(previewRequest).not.toHaveBeenCalled();
  expect(executeRequest).not.toHaveBeenCalled();
});

test('a revoked guest scope cannot open a manual map for its old campus', () => {
  let current = true;
  const navigate = jest.fn();
  const view = render(
    <CampusCloudNavigationTask
      {...baseProps}
      uid=""
      isScopeCurrent={() => current}
      navigation={{ navigate }}
    />,
  );
  current = false;
  fireEvent.press(view.getByText('自行查地圖'));
  expect(navigate).not.toHaveBeenCalled();
  expect(previewRequest).not.toHaveBeenCalled();
  expect(executeRequest).not.toHaveBeenCalled();
});

test('consent exposes explicit aria state and cancellation returns it to unchecked', async () => {
  const view = render(<CampusCloudNavigationTask {...baseProps} />);
  await showPreview(view);
  expectConsentState(view, false);
  consent(view);
  expectConsentState(view, true);
  fireEvent.press(view.getByText('取消規劃'));
  expectConsentState(view, false);
  expect(view.getByRole('checkbox').props.accessibilityState.checked).toBe(false);
  expect(executeRequest).not.toHaveBeenCalled();
});

test('the web Space handler toggles consent once and ignores held-key repeats', async () => {
  jest.replaceProperty(Platform, 'OS', 'web');
  const view = render(<CampusCloudNavigationTask {...baseProps} />);
  await showPreview(view);
  const preventDefault = jest.fn();
  fireEvent(view.getByRole('checkbox'), 'keyDown', { key: ' ', repeat: false, preventDefault });
  expect(preventDefault).toHaveBeenCalledTimes(1);
  expectConsentState(view, true);
  fireEvent(view.getByRole('checkbox'), 'keyDown', { key: ' ', repeat: true, preventDefault });
  expectConsentState(view, true);
  fireEvent(view.getByRole('checkbox'), 'keyDown', {
    key: 'Spacebar',
    repeat: false,
    preventDefault,
  });
  expectConsentState(view, false);
  expect(preventDefault).toHaveBeenCalledTimes(3);
  expect(executeRequest).not.toHaveBeenCalled();
});

test('a disabled unconfigured web consent handler cannot be invoked to bypass its guard', async () => {
  jest.replaceProperty(Platform, 'OS', 'web');
  previewRequest.mockResolvedValue({ ...preview, cloudReady: false });
  const view = render(<CampusCloudNavigationTask {...baseProps} />);
  await showPreview(view);
  const checkbox = view.getByRole('checkbox');
  expect(checkbox.props.accessibilityState.disabled).toBe(true);
  const preventDefault = jest.fn();
  // Call the supplied callback directly to test its guard independently of
  // React Native's disabled-event filtering; this does not emulate a browser.
  expect(checkbox.props.onKeyDown).toEqual(expect.any(Function));
  act(() => checkbox.props.onKeyDown({ key: ' ', repeat: false, preventDefault }));
  expect(preventDefault).toHaveBeenCalledTimes(1);
  expectConsentState(view, false);
  expect(executeRequest).not.toHaveBeenCalled();
});

test('a retained web Space handler cannot toggle consent during execution or after completion', async () => {
  jest.replaceProperty(Platform, 'OS', 'web');
  const pending = deferred<CloudNavigationResult>();
  executeRequest.mockReturnValueOnce(pending.promise);
  const view = render(<CampusCloudNavigationTask {...baseProps} />);
  await showPreview(view);
  consent(view);
  const keyDown = view.getByRole('checkbox').props.onKeyDown;
  expect(keyDown).toEqual(expect.any(Function));
  const preventDefault = jest.fn();
  act(() => {
    fireEvent.press(view.getByText('確認規劃'));
    keyDown({ key: ' ', repeat: false, preventDefault });
  });
  expect(executeRequest).toHaveBeenCalledTimes(1);
  expect(view.getByRole('checkbox').props.accessibilityState.disabled).toBe(true);
  expectConsentState(view, true);
  await act(async () => pending.resolve(completed));
  act(() => keyDown({ key: ' ', repeat: false, preventDefault }));
  expect(view.getByRole('checkbox').props.accessibilityState.disabled).toBe(true);
  expectConsentState(view, true);
  expect(executeRequest).toHaveBeenCalledTimes(1);
});

test('a completed route still requires a current authorized scope before opening its receipt', async () => {
  let current = true;
  const navigate = jest.fn();
  const view = render(
    <CampusCloudNavigationTask
      {...baseProps}
      isScopeCurrent={() => current}
      navigation={{ navigate }}
    />,
  );
  await showPreview(view);
  await execute(view);
  expect(view.getByText('導航建議已備妥')).toBeTruthy();
  current = false;
  fireEvent.press(view.getByText('開啟校園地圖'));
  expect(navigate).not.toHaveBeenCalled();
  expect(executeRequest).toHaveBeenCalledTimes(1);
});

test('draft entry does not submit; preview lists every provider field before consent', async () => {
  const view = render(<CampusCloudNavigationTask {...baseProps} />);
  expect(view.getByLabelText('出發地與目的地').props.value).toBe(query);
  expect(previewRequest).not.toHaveBeenCalled();
  expect(executeRequest).not.toHaveBeenCalled();
  await showPreview(view);
  expect(view.getByText('雲端服務：Groq')).toBeTruthy();
  expect(view.getByText('模型：openai/gpt-oss-120b')).toBeTruthy();
  expect(view.getByText('校園代碼：pu')).toBeTruthy();
  expect(view.getByText(`你的輸入：${query}`)).toBeTruthy();
  expect(view.getByText('候選 p0：圖書館')).toBeTruthy();
  expect(view.getByText('分類：library')).toBeTruthy();
  expect(view.getByText('別名：圖館')).toBeTruthy();
  expect(view.getByText('候選 p1：活動中心')).toBeTruthy();
  expect(view.getByText('別名：無')).toBeTruthy();
  expect(view.getByText('地點來源未提供更新時間。')).toBeTruthy();
  expect(view.getByText(/公開地點查詢時間：.*20:00:00/)).toBeTruthy();
  expect(view.getByRole('checkbox').props.accessibilityState).toEqual({
    checked: false,
    disabled: false,
  });
  fireEvent.press(view.getByText('確認規劃'));
  expect(executeRequest).not.toHaveBeenCalled();
});

test('explicit consent sends only the exact approved plan and opens the verified internal route', async () => {
  const navigate = jest.fn();
  const view = render(<CampusCloudNavigationTask {...baseProps} navigation={{ navigate }} />);
  await showPreview(view);
  await execute(view);
  expect(executeRequest).toHaveBeenCalledTimes(1);
  expect(executeRequest.mock.calls[0][0]).toEqual({
    scope: { uid: 'fixture-user', schoolId: 'pu' },
    query,
    requestId: 'request-1',
    isCurrent: expect.any(Function),
    consent: {
      provider: 'groq',
      version: 1,
      schoolId: 'pu',
      query,
      fingerprint: preview.fingerprint,
    },
  });
  expect(view.getByText('導航建議已備妥')).toBeTruthy();
  expect(view.getByText('出發地：圖書館')).toBeTruthy();
  expect(view.getByText('目的地：活動中心')).toBeTruthy();
  fireEvent.press(view.getByText('開啟校園地圖'));
  expect(navigate).toHaveBeenCalledWith('校園', {
    screen: 'MapV2',
    params: { schoolId: 'pu', fromPoiId: 'library', toPoiId: 'center' },
  });
  fireEvent.press(view.getByText('確認規劃'));
  expect(executeRequest).toHaveBeenCalledTimes(1);
});

test('unconfigured provider still shows the source preview but cannot accept consent or execute', async () => {
  previewRequest.mockResolvedValue({ ...preview, cloudReady: false });
  const view = render(<CampusCloudNavigationTask {...baseProps} />);
  await showPreview(view);
  expect(view.getByText(/目前只能預覽/)).toBeTruthy();
  consent(view);
  fireEvent.press(view.getByText('確認規劃'));
  expect(view.getByRole('checkbox').props.accessibilityState).toEqual({
    checked: false,
    disabled: true,
  });
  expect(executeRequest).not.toHaveBeenCalled();
});

test('empty public source shows a recovery route without consent or execution controls', async () => {
  previewRequest.mockResolvedValue({
    status: 'clarify',
    provider: 'groq',
    schoolId: 'pu',
    checkedAt,
    reason: 'no_places',
  });
  const view = render(<CampusCloudNavigationTask {...baseProps} />);
  await showPreview(view);
  expect(view.getByText(/目前沒有可用的公開地點資料/)).toBeTruthy();
  expect(view.getByText('自行查地圖')).toBeTruthy();
  expect(view.queryByRole('checkbox')).toBeNull();
  expect(executeRequest).not.toHaveBeenCalled();
});

test('source update time stays distinct from the later query time', async () => {
  previewRequest.mockResolvedValue({ ...preview, sourceUpdatedAt: '2026-10-31T09:30:00.000Z' });
  const view = render(<CampusCloudNavigationTask {...baseProps} />);
  await showPreview(view);
  expect(view.getByText(/公開地點查詢時間：.*20:00:00/)).toBeTruthy();
  expect(view.getByText(/地點資料更新時間：.*17:30:00/)).toBeTruthy();
  expect(view.queryByText('地點來源未提供更新時間。')).toBeNull();
});

test.each(['preview', 'execute'])(
  '%s locks duplicate presses and permits cancellation without late adoption',
  async (phase) => {
    const pendingPreview = deferred<CloudNavigationPreview>();
    const pendingExecution = deferred<CloudNavigationResult>();
    const view = render(<CampusCloudNavigationTask {...baseProps} />);
    if (phase === 'execute') {
      await showPreview(view);
      consent(view);
      executeRequest.mockReturnValue(pendingExecution.promise);
    } else previewRequest.mockReturnValue(pendingPreview.promise);
    const button = view.getByText(phase === 'preview' ? '預覽傳送內容' : '確認規劃');
    act(() => {
      fireEvent.press(button);
      fireEvent.press(button);
    });
    const called = phase === 'preview' ? previewRequest : executeRequest;
    expect(called).toHaveBeenCalledTimes(1);
    const signal = called.mock.calls[0][1];
    fireEvent.press(view.getByText(phase === 'preview' ? '取消讀取' : '取消等待'));
    expect(signal?.aborted).toBe(true);
    expect(view.getByLabelText('出發地與目的地').props.value).toBe(query);
    await act(async () => {
      if (phase === 'preview') pendingPreview.resolve(preview);
      else pendingExecution.resolve(completed);
    });
    expect(view.queryByText('導航建議已備妥')).toBeNull();
    if (phase === 'execute')
      expect(view.getByRole('checkbox').props.accessibilityState.checked).toBe(false);
    else expect(view.queryByRole('checkbox')).toBeNull();
  },
);

test('rejecting a preview preserves the draft and requires a new consent press', async () => {
  const view = render(<CampusCloudNavigationTask {...baseProps} />);
  await showPreview(view);
  consent(view);
  const runButton = view.getByText('確認規劃');
  act(() => {
    fireEvent.press(view.getByText('取消規劃'));
    fireEvent.press(runButton);
  });
  expect(executeRequest).not.toHaveBeenCalled();
  expect(view.getByLabelText('出發地與目的地').props.value).toBe(query);
  expect(view.getByRole('checkbox').props.accessibilityState.checked).toBe(false);
});

test('editing revokes consent, aborts old work, and does not restore it when text returns', async () => {
  const pending = deferred<CloudNavigationResult>();
  executeRequest.mockReturnValue(pending.promise);
  const view = render(<CampusCloudNavigationTask {...baseProps} />);
  await showPreview(view);
  consent(view);
  fireEvent.press(view.getByText('確認規劃'));
  const signal = executeRequest.mock.calls[0][1];
  fireEvent.changeText(view.getByLabelText('出發地與目的地'), '換另一個地點');
  fireEvent.changeText(view.getByLabelText('出發地與目的地'), query);
  expect(signal?.aborted).toBe(true);
  await act(async () => pending.resolve(completed));
  expect(view.queryByRole('checkbox')).toBeNull();
  expect(view.queryByText('導航建議已備妥')).toBeNull();
  await showPreview(view);
  expect(view.getByRole('checkbox').props.accessibilityState.checked).toBe(false);
  fireEvent.press(view.getByText('確認規劃'));
  expect(executeRequest).toHaveBeenCalledTimes(1);
});

test.each(['account', 'school'])(
  '%s A→B→A clears original draft, consent and late results',
  async (change) => {
    const pending = deferred<CloudNavigationResult>();
    executeRequest.mockReturnValue(pending.promise);
    const view = render(<CampusCloudNavigationTask {...baseProps} />);
    await showPreview(view);
    consent(view);
    fireEvent.press(view.getByText('確認規劃'));
    const oldInput = executeRequest.mock.calls[0][0];
    const oldSignal = executeRequest.mock.calls[0][1];
    view.rerender(
      <CampusCloudNavigationTask
        {...baseProps}
        {...(change === 'account' ? { uid: 'other' } : { schoolId: 'other' })}
      />,
    );
    view.rerender(<CampusCloudNavigationTask {...baseProps} />);
    expect(oldSignal?.aborted).toBe(true);
    expect(oldInput.isCurrent()).toBe(false);
    await act(async () => pending.resolve(completed));
    expect(view.getByLabelText('出發地與目的地').props.value).toBe('');
    expect(view.queryByRole('checkbox')).toBeNull();
    expect(view.queryByText('導航建議已備妥')).toBeNull();
  },
);

test('unmount and parent return cancellation abort without requiring the navigator to unmount', async () => {
  const pending = deferred<CloudNavigationResult>();
  executeRequest.mockReturnValue(pending.promise);
  const cancelRef: React.MutableRefObject<(() => void) | null> = { current: null };
  const view = render(<CampusCloudNavigationTask {...baseProps} cancelRef={cancelRef} />);
  await showPreview(view);
  consent(view);
  fireEvent.press(view.getByText('確認規劃'));
  const signal = executeRequest.mock.calls[0][1];
  act(() => cancelRef.current?.());
  expect(signal?.aborted).toBe(true);
  expect(view.getByRole('checkbox').props.accessibilityState.checked).toBe(false);
  await act(async () => pending.resolve(completed));
  expect(view.queryByText('導航建議已備妥')).toBeNull();
  view.unmount();
  expect(cancelRef.current).toBeNull();
  expect(executeRequest.mock.calls[0][0].isCurrent()).toBe(false);
});

test('unmount during preview invalidates its scope and aborts its signal', async () => {
  const pending = deferred<CloudNavigationPreview>();
  previewRequest.mockReturnValue(pending.promise);
  const view = render(<CampusCloudNavigationTask {...baseProps} />);
  fireEvent.press(view.getByText('預覽傳送內容'));
  view.unmount();
  expect(previewRequest.mock.calls[0][0].isCurrent()).toBe(false);
  expect(previewRequest.mock.calls[0][1]?.aborted).toBe(true);
  await act(async () => pending.resolve(preview));
});

test.each(['empty-uid', 'scope'])('%s prevents any preview transport', (reason) => {
  const view = render(
    <CampusCloudNavigationTask
      {...baseProps}
      uid={reason === 'empty-uid' ? '' : baseProps.uid}
      isScopeCurrent={() => reason !== 'scope'}
    />,
  );
  fireEvent.press(view.getByText('預覽傳送內容'));
  expect(previewRequest).not.toHaveBeenCalled();
  expect(executeRequest).not.toHaveBeenCalled();
});

test('a revoked scope prevents an already-approved plan from executing or opening a receipt', async () => {
  let current = true;
  const navigate = jest.fn();
  const view = render(
    <CampusCloudNavigationTask
      {...baseProps}
      isScopeCurrent={() => current}
      navigation={{ navigate }}
    />,
  );
  await showPreview(view);
  consent(view);
  current = false;
  fireEvent.press(view.getByText('確認規劃'));
  expect(executeRequest).not.toHaveBeenCalled();
  expect(view.queryByRole('checkbox')).toBeNull();
  fireEvent.press(view.getByText('自行查地圖'));
  expect(navigate).not.toHaveBeenCalled();
});

test('transport failure retains the exact plan and retries with the same request id', async () => {
  executeRequest.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(completed);
  const view = render(<CampusCloudNavigationTask {...baseProps} />);
  await showPreview(view);
  await execute(view);
  expect(view.getByText(/這次未能取得導航建議/)).toBeTruthy();
  expect(view.getByLabelText('出發地與目的地').props.value).toBe(query);
  await act(async () => fireEvent.press(view.getByText('重試規劃')));
  expect(executeRequest.mock.calls.map((call) => call[0].requestId)).toEqual([
    'request-1',
    'request-1',
  ]);
  expect(requestId).toHaveBeenCalledTimes(1);
  expect(view.getByText('導航建議已備妥')).toBeTruthy();
});

test('refreshing an unchanged plan keeps its request id but requires consent again', async () => {
  const view = render(<CampusCloudNavigationTask {...baseProps} />);
  await showPreview(view);
  consent(view);
  await showPreview(view);
  expect(requestId).toHaveBeenCalledTimes(1);
  expect(view.getByRole('checkbox').props.accessibilityState.checked).toBe(false);
});

test('429 retry timing cannot be bypassed by editing and previewing again', async () => {
  jest.useFakeTimers();
  executeRequest
    .mockResolvedValueOnce({
      status: 'unavailable',
      provider: 'groq',
      schoolId: 'pu',
      checkedAt,
      reason: 'rate_limited',
      retryAfterSeconds: 30,
    })
    .mockResolvedValueOnce(completed);
  const view = render(<CampusCloudNavigationTask {...baseProps} />);
  await showPreview(view);
  await execute(view);
  expect(view.getByText(/可於臺灣時間.*後重試/)).toBeTruthy();
  fireEvent.press(view.getByText('重試規劃'));
  expect(executeRequest).toHaveBeenCalledTimes(1);
  fireEvent.changeText(view.getByLabelText('出發地與目的地'), query);
  await showPreview(view);
  consent(view);
  fireEvent.press(view.getByText('確認規劃'));
  expect(executeRequest).toHaveBeenCalledTimes(1);
  await act(async () => jest.advanceTimersByTime(30_000));
  await act(async () => fireEvent.press(view.getByText('確認規劃')));
  expect(executeRequest).toHaveBeenCalledTimes(2);
  view.unmount();
  jest.useRealTimers();
});

test.each(['source_changed', 'permission_changed'] as const)(
  '%s discards the old approval and requires a fresh preview',
  async (reason) => {
    executeRequest.mockResolvedValue({
      status: 'stale',
      provider: 'groq',
      schoolId: 'pu',
      checkedAt,
      reason,
    });
    const view = render(<CampusCloudNavigationTask {...baseProps} />);
    await showPreview(view);
    await execute(view);
    expect(view.queryByRole('checkbox')).toBeNull();
    expect(view.queryByText('導航建議已備妥')).toBeNull();
    expect(view.getByLabelText('出發地與目的地').props.value).toBe(query);
    await showPreview(view);
    expect(view.getByRole('checkbox').props.accessibilityState.checked).toBe(false);
  },
);

test('an invalid client response never creates a route or reports success', async () => {
  executeRequest.mockRejectedValue(
    Object.assign(new Error('invalid'), { code: 'invalid-response' }),
  );
  const navigate = jest.fn();
  const view = render(<CampusCloudNavigationTask {...baseProps} navigation={{ navigate }} />);
  await showPreview(view);
  await execute(view);
  expect(view.getByText(/回覆未通過檢查/)).toBeTruthy();
  expect(view.queryByText('導航建議已備妥')).toBeNull();
  expect(view.queryByText('開啟校園地圖')).toBeNull();
  expect(navigate).not.toHaveBeenCalled();
});

test('empty draft and preview failure stay editable and never call execution', async () => {
  const view = render(<CampusCloudNavigationTask {...baseProps} initialPrompt="" />);
  fireEvent.press(view.getByText('預覽傳送內容'));
  expect(view.getByText('請先輸入出發地與目的地。')).toBeTruthy();
  expect(previewRequest).not.toHaveBeenCalled();
  fireEvent.changeText(view.getByLabelText('出發地與目的地'), query);
  previewRequest.mockRejectedValueOnce(new Error('network'));
  await showPreview(view);
  expect(view.getByLabelText('出發地與目的地').props.value).toBe(query);
  expect(view.getByText(/這次未能讀取公開地點/)).toBeTruthy();
  expect(executeRequest).not.toHaveBeenCalled();
});

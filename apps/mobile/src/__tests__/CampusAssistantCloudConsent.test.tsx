import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import { AgentDraftProvider } from '../state/AgentDraftProvider';
import { CampusAssistantScreen } from '../screens/CampusAssistantScreen';
import { CampusCloudNavigationTask } from '../screens/CampusCloudNavigationTask';
import { AIOverlayHost } from '../components/AIOverlayHost';
import { askCampusAssistant, getOnDeviceAssistantReadiness } from '../features/campusAssistant';
import { confirmCampusAgentWrite } from '../features/campusAssistantActions';
import { safeNavigate } from '../utils/safeNavigate';
import {
  getCloudNavigationPreview,
  runCloudNavigationTask,
  type CloudNavigationPreview,
  type CloudNavigationResult,
} from '../features/cloudNavigation';

let mockUid: string | null = 'A';
let mockSchool = 'pu';
let mockLoading = false;
let mockTokenExpired = false;
const mockClose = jest.fn();
let mockOverlay = { visible: true, mode: 'chat', initialPrompt: '從圖書館走到活動中心' };
jest.mock('../app/useAIOverlay', () => ({
  useAIOverlay: () => mockOverlay,
  aiOverlay: { close: () => mockClose() },
}));
jest.mock('../state/auth', () => ({
  useAuth: () => ({
    user: mockUid ? { uid: mockUid } : null,
    loading: mockLoading,
    tokenExpired: mockTokenExpired,
  }),
}));
jest.mock('../state/school', () => ({
  useSchool: () => ({
    school: { id: mockSchool, name: mockSchool === 'pu' ? '靜宜大學' : '另一校園' },
  }),
}));
jest.mock('../features/campusAssistant', () => ({
  askCampusAssistant: jest.fn(),
  getOnDeviceAssistantReadiness: jest.fn(async () => ({ available: true, ready: false })),
  OnDeviceAssistantError: class OnDeviceAssistantError extends Error {},
}));
jest.mock('../features/campusAssistantActions', () => ({ confirmCampusAgentWrite: jest.fn() }));
jest.mock('../features/cloudNavigation', () => ({
  getCloudNavigationPreview: jest.fn(),
  runCloudNavigationTask: jest.fn(),
  createCloudNavigationRequestId: jest.fn(() => 'fixture-navigation-request'),
}));
jest.mock('../services/campusSenseSnapshot', () => ({
  ...jest.requireActual('../services/campusSenseSnapshot'),
  refreshCampusSenseSnapshot: jest.fn(),
}));
jest.mock('../screens/LegacyAssignmentReminders', () => ({
  LegacyAssignmentReminders: () => null,
}));
jest.mock('../services/campusAssignmentReminders', () => ({
  scheduleCampusAssignmentReminder: jest.fn(),
  cancelCampusAssignmentReminder: jest.fn(),
  getCampusAssignmentReminderStatus: jest.fn(async () => []),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

const query = '從圖書館走到活動中心';
const preview: CloudNavigationPreview = {
  status: 'preview',
  provider: 'groq',
  model: 'openai/gpt-oss-120b',
  schoolId: 'pu',
  query,
  checkedAt: '2026-11-01T15:00:00.000Z',
  sourceUpdatedAt: null,
  fingerprint: 'a'.repeat(64),
  cloudReady: true,
  places: [
    { ref: 'p0', name: '圖書館', category: '圖書館', aliases: [] },
    { ref: 'p1', name: '活動中心', category: '', aliases: [] },
  ],
};
const completed: CloudNavigationResult = {
  status: 'completed',
  provider: 'groq',
  model: 'openai/gpt-oss-120b',
  schoolId: 'pu',
  checkedAt: preview.checkedAt,
  sourceUpdatedAt: null,
  route: {
    from: { id: 'library', name: '圖書館', schoolId: 'pu', lat: 24, lng: 120 },
    to: { id: 'hall', name: '活動中心', schoolId: 'pu', lat: 24.1, lng: 120.1 },
    navigationUrl:
      'https://www.google.com/maps/dir/?api=1&origin=24%2C120&destination=24.1%2C120.1&travelmode=walking',
  },
};
const previewRequest = jest.mocked(getCloudNavigationPreview);
const runRequest = jest.mocked(runCloudNavigationTask);
const oldRequest = jest.mocked(askCampusAssistant);
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
async function consentAndRun(view: ReturnType<typeof render>) {
  await act(async () => fireEvent.press(view.getByText('預覽傳送內容')));
  fireEvent.press(view.getByRole('checkbox'));
  await act(async () => {
    fireEvent.press(view.getByText('確認規劃'));
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  previewRequest.mockReset();
  runRequest.mockReset();
  oldRequest.mockReset();
  mockUid = 'A';
  mockSchool = 'pu';
  mockLoading = false;
  mockTokenExpired = false;
  mockOverlay = { visible: true, mode: 'chat', initialPrompt: query };
  previewRequest.mockResolvedValue(preview);
  runRequest.mockResolvedValue(completed);
});

test('the default assistant previews public data and requires provider consent before planning', async () => {
  const navigate = jest.fn();
  const view = render(
    <CampusAssistantScreen navigation={{ navigate }} route={{ params: { prompt: query } }} />,
  );
  expect(view.getByLabelText('出發地與目的地').props.value).toBe(query);
  expect(previewRequest).not.toHaveBeenCalled();
  expect(runRequest).not.toHaveBeenCalled();
  expect(getOnDeviceAssistantReadiness).not.toHaveBeenCalled();
  await act(async () => fireEvent.press(view.getByText('預覽傳送內容')));
  expect(previewRequest).toHaveBeenCalledWith(
    expect.objectContaining({
      scope: { uid: 'A', schoolId: 'pu' },
      query,
      isCurrent: expect.any(Function),
    }),
    expect.any(AbortSignal),
  );
  expect(view.getByText('雲端服務：Groq')).toBeTruthy();
  fireEvent.press(view.getByText('確認規劃'));
  expect(runRequest).not.toHaveBeenCalled();
  fireEvent.press(view.getByRole('checkbox'));
  expect(runRequest).not.toHaveBeenCalled();
  await act(async () => fireEvent.press(view.getByText('確認規劃')));
  expect(runRequest).toHaveBeenCalledTimes(1);
  expect(runRequest).toHaveBeenCalledWith(
    expect.objectContaining({
      scope: { uid: 'A', schoolId: 'pu' },
      query,
      consent: {
        provider: 'groq',
        version: 1,
        schoolId: 'pu',
        query,
        fingerprint: preview.fingerprint,
      },
    }),
    expect.any(AbortSignal),
  );
  expect(view.getByText('導航建議已備妥')).toBeTruthy();
  expect(view.queryByText('檢視任務草稿')).toBeNull();
  expect(oldRequest).not.toHaveBeenCalled();
  expect(confirmCampusAgentWrite).not.toHaveBeenCalled();
  fireEvent.press(view.getByText('開啟校園地圖'));
  expect(navigate).toHaveBeenCalledWith('校園', {
    screen: 'MapV2',
    params: { schoolId: 'pu', fromPoiId: 'library', toPoiId: 'hall' },
  });
});

test('saved data uses tools only without model readiness or cloud fallback', async () => {
  oldRequest.mockResolvedValueOnce({ source: 'device', content: '已存課表', hasActions: false });
  const view = render(<CampusAssistantScreen />);
  fireEvent.press(view.getByText('已存資料'));
  fireEvent.changeText(view.getByLabelText('詢問校園助理'), '今天課表');
  await act(async () => fireEvent.press(view.getByText('送出問題')));
  expect(oldRequest).toHaveBeenCalledWith(
    expect.objectContaining({ mode: 'device', onDevicePolicy: 'tools-only' }),
  );
  expect(getOnDeviceAssistantReadiness).not.toHaveBeenCalled();
  expect(previewRequest).not.toHaveBeenCalled();
  expect(runRequest).not.toHaveBeenCalled();
  expect(confirmCampusAgentWrite).not.toHaveBeenCalled();
});

test.each(['chat', 'quick', 'insights'])(
  'global %s entry keeps the prompt editable until public preview and consent',
  async (mode) => {
    mockOverlay = { visible: true, mode, initialPrompt: query };
    const view = render(<AIOverlayHost />);
    expect(view.getByLabelText('出發地與目的地').props.value).toBe(query);
    expect(previewRequest).not.toHaveBeenCalled();
    expect(runRequest).not.toHaveBeenCalled();
    await consentAndRun(view);
    expect(view.getByText('導航建議已備妥')).toBeTruthy();
    expect(oldRequest).not.toHaveBeenCalled();
    expect(confirmCampusAgentWrite).not.toHaveBeenCalled();
    fireEvent.press(view.getByLabelText('返回'));
    expect(mockClose).toHaveBeenCalledTimes(1);
  },
);

test('a failed public preview retains the editable draft and retry never calls generic chat', async () => {
  previewRequest.mockRejectedValueOnce(new Error('fixture offline'));
  const view = render(<CampusAssistantScreen route={{ params: { prompt: query } }} />);
  await act(async () => fireEvent.press(view.getByText('預覽傳送內容')));
  expect(view.getByLabelText('出發地與目的地').props.value).toBe(query);
  expect(view.getByText(/你的輸入已保留，請重新預覽/)).toBeTruthy();
  expect(runRequest).not.toHaveBeenCalled();
  await act(async () => fireEvent.press(view.getByText('預覽傳送內容')));
  expect(previewRequest).toHaveBeenCalledTimes(2);
  expect(previewRequest.mock.calls.map(([input]) => input.query)).toEqual([query, query]);
  expect(view.getByRole('checkbox').props.accessibilityState.checked).toBe(false);
  expect(runRequest).not.toHaveBeenCalled();
  expect(oldRequest).not.toHaveBeenCalled();
});

test('quota failure keeps the same confirmed request for retry without a fallback or success claim', async () => {
  runRequest.mockResolvedValueOnce({
    status: 'unavailable',
    reason: 'rate_limited',
    provider: 'groq',
    schoolId: 'pu',
    checkedAt: preview.checkedAt,
  });
  const view = render(<CampusAssistantScreen route={{ params: { prompt: query } }} />);
  await consentAndRun(view);
  expect(view.getByText(/目前查詢較多/)).toBeTruthy();
  expect(view.queryByText('導航建議已備妥')).toBeNull();
  expect(view.getByLabelText('出發地與目的地').props.value).toBe(query);
  await act(async () => fireEvent.press(view.getByText('重試規劃')));
  expect(runRequest).toHaveBeenCalledTimes(2);
  expect(runRequest.mock.calls[1][0]).toMatchObject({
    requestId: runRequest.mock.calls[0][0].requestId,
    consent: runRequest.mock.calls[0][0].consent,
    query,
  });
  expect(view.getByText('導航建議已備妥')).toBeTruthy();
  expect(oldRequest).not.toHaveBeenCalled();
  expect(getOnDeviceAssistantReadiness).not.toHaveBeenCalled();
  expect(confirmCampusAgentWrite).not.toHaveBeenCalled();
});

test.each(['account', 'school', 'account-back', 'loading', 'expired', 'logout'])(
  '%s changes cancel in-flight navigation while retaining same-owner text',
  async (change) => {
    const late = deferred<CloudNavigationResult>();
    runRequest.mockReturnValueOnce(late.promise);
    const route = { params: { prompt: query } };
    const view = render(<CampusAssistantScreen route={route} />);
    await consentAndRun(view);
    const [input, signal] = runRequest.mock.calls[0];
    expect(input.isCurrent()).toBe(true);
    if (change === 'school') mockSchool = 'other';
    else if (change === 'loading') mockLoading = true;
    else if (change === 'expired') mockTokenExpired = true;
    else mockUid = change === 'logout' ? null : 'B';
    view.rerender(<CampusAssistantScreen route={route} />);
    expect(signal?.aborted).toBe(true);
    expect(input.isCurrent()).toBe(false);
    expect(view.getByLabelText('出發地與目的地').props.value).toBe('');
    expect(view.queryByRole('checkbox')).toBeNull();
    if (change === 'account-back' || change === 'loading' || change === 'expired') {
      mockUid = 'A';
      mockLoading = false;
      mockTokenExpired = false;
      view.rerender(<CampusAssistantScreen route={route} />);
      expect(view.getByLabelText('出發地與目的地').props.value).toBe(change === 'account-back' ? '' : query);
      expect(input.isCurrent()).toBe(false);
    }
    await act(async () => late.resolve(completed));
    expect(view.queryByText('導航建議已備妥')).toBeNull();
    expect(view.queryByRole('checkbox')).toBeNull();
    expect(runRequest).toHaveBeenCalledTimes(1);
    expect(oldRequest).not.toHaveBeenCalled();
    expect(confirmCampusAgentWrite).not.toHaveBeenCalled();
  },
);

test('a late preview after switching school cannot expose the old plan or consent', async () => {
  const late = deferred<CloudNavigationPreview>();
  previewRequest.mockReturnValueOnce(late.promise);
  const route = { params: { prompt: query } };
  const view = render(<CampusAssistantScreen route={route} />);
  fireEvent.press(view.getByText('預覽傳送內容'));
  const [input, signal] = previewRequest.mock.calls[0];
  mockSchool = 'other';
  view.rerender(<CampusAssistantScreen route={route} />);
  expect(signal?.aborted).toBe(true);
  expect(input.isCurrent()).toBe(false);
  await act(async () => late.resolve(preview));
  expect(view.queryByRole('checkbox')).toBeNull();
  expect(view.queryByText('確認這次傳送的內容')).toBeNull();
  expect(view.getByLabelText('出發地與目的地').props.value).toBe('');
  expect(runRequest).not.toHaveBeenCalled();
});

test.each(['guest', 'loading', 'expired'])(
  '%s cannot preview or send cloud data even when a prompt is present',
  async (state) => {
    if (state === 'guest') mockUid = null;
    else if (state === 'loading') mockLoading = true;
    else mockTokenExpired = true;
    const view = render(<CampusAssistantScreen route={{ params: { prompt: query } }} />);
    await act(async () => fireEvent.press(view.getByText('預覽傳送內容')));
    expect(previewRequest).not.toHaveBeenCalled();
    expect(runRequest).not.toHaveBeenCalled();
    expect(oldRequest).not.toHaveBeenCalled();
    expect(confirmCampusAgentWrite).not.toHaveBeenCalled();
  },
);

test('back cancels a pending cloud task immediately even before navigation unmounts the screen', async () => {
  const late = deferred<CloudNavigationResult>();
  runRequest.mockReturnValueOnce(late.promise);
  const goBack = jest.fn();
  const view = render(
    <CampusAssistantScreen navigation={{ goBack }} route={{ params: { prompt: query } }} />,
  );
  await consentAndRun(view);
  const [input, signal] = runRequest.mock.calls[0];
  fireEvent.press(view.getByLabelText('返回'));
  expect(goBack).toHaveBeenCalledTimes(1);
  expect(signal?.aborted).toBe(true);
  expect(input.isCurrent()).toBe(false);
  await act(async () => late.resolve(completed));
  expect(view.queryByText('導航建議已備妥')).toBeNull();
  expect(confirmCampusAgentWrite).not.toHaveBeenCalled();
});

test('switching to saved data cancels cloud work and returning requires fresh consent', async () => {
  const late = deferred<CloudNavigationResult>();
  runRequest.mockReturnValueOnce(late.promise);
  const view = render(<CampusAssistantScreen route={{ params: { prompt: query } }} />);
  await consentAndRun(view);
  const signal = runRequest.mock.calls[0][1];
  fireEvent.press(view.getByText('已存資料'));
  expect(signal?.aborted).toBe(true);
  await act(async () => late.resolve(completed));
  fireEvent.press(view.getByText('校園導航'));
  expect(view.queryByText('導航建議已備妥')).toBeNull();
  expect(view.queryByRole('checkbox')).toBeNull();
  expect(runRequest).toHaveBeenCalledTimes(1);
  expect(oldRequest).not.toHaveBeenCalled();
});

test('navigation blur cancels pending work and focus restores only the scoped draft', async () => {
  const late = deferred<CloudNavigationResult>();
  runRequest.mockReturnValueOnce(late.promise);
  const listeners = new Map<string, () => void>();
  const navigation = {
    navigate: jest.fn(),
    isFocused: () => true,
    addListener: jest.fn((event: 'blur' | 'focus', listener: () => void) => {
      listeners.set(event, listener);
      return () => {
        listeners.delete(event);
      };
    }),
  };
  const view = render(
    <CampusAssistantScreen navigation={navigation} route={{ params: { prompt: query } }} />,
  );
  await consentAndRun(view);
  const [input, signal] = runRequest.mock.calls[0];
  const blur = listeners.get('blur');
  const focus = listeners.get('focus');
  expect(blur).toEqual(expect.any(Function));
  expect(focus).toEqual(expect.any(Function));
  act(() => blur?.());
  expect(signal?.aborted).toBe(true);
  expect(input.isCurrent()).toBe(false);
  await act(async () => late.resolve(completed));
  act(() => focus?.());
  expect(view.getByLabelText('出發地與目的地').props.value).toBe(query);
  expect(view.queryByRole('checkbox')).toBeNull();
  expect(view.queryByText('導航建議已備妥')).toBeNull();
  expect(previewRequest).toHaveBeenCalledTimes(1);
  expect(runRequest).toHaveBeenCalledTimes(1);
  expect(oldRequest).not.toHaveBeenCalled();
  expect(confirmCampusAgentWrite).not.toHaveBeenCalled();
});

test.each(['campus', 'device'])(
  '%s opens the existing assistant permission screen without sending data or granting a write',
  (mode) => {
    const navigate = jest.fn();
    const view = render(<CampusAssistantScreen navigation={{ navigate }} />);
    if (mode === 'device') fireEvent.press(view.getByText('已存資料'));
    fireEvent.press(view.getByText('助理權限'));
    expect(navigate).toHaveBeenCalledWith('我的', { screen: 'AssistantPermissions', params: undefined });
    expect(previewRequest).not.toHaveBeenCalled();
    expect(runRequest).not.toHaveBeenCalled();
    expect(oldRequest).not.toHaveBeenCalled();
    expect(confirmCampusAgentWrite).not.toHaveBeenCalled();
  },
);

test.each(['guest', 'loading', 'expired'])(
  '%s does not offer an authenticated permission shortcut',
  (state) => {
    if (state === 'guest') mockUid = null;
    else if (state === 'loading') mockLoading = true;
    else mockTokenExpired = true;
    const navigate = jest.fn();
    const view = render(<CampusAssistantScreen navigation={{ navigate }} />);
    expect(view.queryByText('助理權限')).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
    expect(confirmCampusAgentWrite).not.toHaveBeenCalled();
  },
);

test.each(['pending', 'quota'])(
  'opening permissions clears %s navigation consent and cannot revive it on return',
  async (state) => {
    const late = deferred<CloudNavigationResult>();
    if (state === 'pending') runRequest.mockReturnValueOnce(late.promise);
    else runRequest.mockResolvedValueOnce({
      status: 'unavailable', reason: 'rate_limited', provider: 'groq',
      schoolId: 'pu', checkedAt: preview.checkedAt,
    });
    const listeners = new Map<string, () => void>();
    const navigation = {
      navigate: jest.fn(),
      isFocused: () => true,
      addListener: jest.fn((event: 'blur' | 'focus', listener: () => void) => {
        listeners.set(event, listener);
        return () => { listeners.delete(event); };
      }),
    };
    const view = render(
      <CampusAssistantScreen navigation={navigation} route={{ params: { prompt: query } }} />,
    );
    await consentAndRun(view);
    const signal = runRequest.mock.calls[0][1];
    fireEvent.press(view.getByText('助理權限'));
    expect(navigation.navigate).toHaveBeenCalledWith('我的', { screen: 'AssistantPermissions', params: undefined });
    if (state === 'pending') expect(signal?.aborted).toBe(true);
    expect(view.getByRole('checkbox').props.accessibilityState.checked).toBe(false);
    const blur = listeners.get('blur');
    const focus = listeners.get('focus');
    act(() => blur?.());
    if (state === 'pending') await act(async () => late.resolve(completed));
    act(() => focus?.());
    expect(view.queryByText('導航建議已備妥')).toBeNull();
    expect(view.queryByText('重試規劃')).toBeNull();
    expect(view.queryByRole('checkbox')).toBeNull();
    expect(view.getByLabelText('出發地與目的地').props.value).toBe(query);
    fireEvent.changeText(view.getByLabelText('出發地與目的地'), query);
    await act(async () => fireEvent.press(view.getByText('預覽傳送內容')));
    fireEvent.press(view.getByText('確認規劃'));
    expect(view.getByRole('checkbox').props.accessibilityState.checked).toBe(false);
    expect(runRequest).toHaveBeenCalledTimes(1);
    expect(confirmCampusAgentWrite).not.toHaveBeenCalled();
    expect(oldRequest).not.toHaveBeenCalled();
  },
);

test('the shared navigator reaches permissions from the campus stack', () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const navigation = {
    navigate: jest.fn(),
    getState: () => ({ routeNames: ['CampusAssistant', 'MapV2'] }),
    getParent: () => ({
      getState: () => ({ routeNames: ['Today', '學習', '校園', '訊息', '我的'] }),
    }),
  };
  try {
    expect(safeNavigate(navigation, 'AssistantPermissions')).toBe(true);
    expect(navigation.navigate).toHaveBeenCalledWith('我的', {
      screen: 'AssistantPermissions', params: undefined,
    });
    expect(alert).not.toHaveBeenCalled();
  } finally {
    alert.mockRestore();
  }
});

test.each(['permissions', 'mode', 'loading'])(
  'keeps the quota deadline across %s return even after fresh preview and consent',
  async (transition) => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-11-02T15:00:00.000Z'));
    let view: ReturnType<typeof render> | undefined;
    try {
      runRequest.mockResolvedValueOnce({
        status: 'unavailable', reason: 'rate_limited', provider: 'groq',
        schoolId: 'pu', checkedAt: preview.checkedAt, retryAfterSeconds: 30,
      });
      const listeners = new Map<string, () => void>();
      const navigation = {
        navigate: jest.fn(),
        getState: () => ({ routeNames: ['CampusAssistant', 'AssistantPermissions'] }),
        isFocused: () => true,
        addListener: (event: 'blur' | 'focus', listener: () => void) => {
          listeners.set(event, listener);
          return () => { listeners.delete(event); };
        },
      };
      view = render(<CampusAssistantScreen navigation={navigation} route={{ params: { prompt: query } }} />);
      await consentAndRun(view);
      expect(view.getByText(/後重試。/)).toBeTruthy();
      if (transition === 'permissions') {
        fireEvent.press(view.getByText('助理權限'));
        expect(navigation.navigate).toHaveBeenCalledWith('AssistantPermissions', undefined);
        const blur = listeners.get('blur');
        const focus = listeners.get('focus');
        act(() => blur?.());
        act(() => focus?.());
      } else if (transition === 'mode') {
        fireEvent.press(view.getByText('已存資料'));
        fireEvent.press(view.getByText('校園導航'));
      } else {
        mockLoading = true;
        view.rerender(<CampusAssistantScreen navigation={navigation} route={{ params: { prompt: query } }} />);
        await act(async () => fireEvent.press(view!.getByText('預覽傳送內容')));
        expect(runRequest).toHaveBeenCalledTimes(1);
        expect(previewRequest).toHaveBeenCalledTimes(1);
        mockLoading = false;
        view.rerender(<CampusAssistantScreen navigation={navigation} route={{ params: { prompt: query } }} />);
      }
      fireEvent.changeText(view.getByLabelText('出發地與目的地'), query);
      await act(async () => fireEvent.press(view!.getByText('預覽傳送內容')));
      fireEvent.press(view.getByRole('checkbox'));
      await act(async () => fireEvent.press(view!.getByText('確認規劃')));
      expect(runRequest).toHaveBeenCalledTimes(1);
      act(() => jest.advanceTimersByTime(29_999));
      await act(async () => fireEvent.press(view!.getByText('確認規劃')));
      expect(runRequest).toHaveBeenCalledTimes(1);
      act(() => jest.advanceTimersByTime(1));
      await act(async () => fireEvent.press(view!.getByText('確認規劃')));
      expect(runRequest).toHaveBeenCalledTimes(2);
      expect(confirmCampusAgentWrite).not.toHaveBeenCalled();
    } finally {
      view?.unmount();
      jest.useRealTimers();
    }
  },
);

test.each(['account', 'school', 'account-back'])(
  'clears quota ownership after %s changes without restoring old consent',
  async (change) => {
    jest.useFakeTimers();
    let view: ReturnType<typeof render> | undefined;
    try {
      runRequest.mockResolvedValueOnce({
        status: 'unavailable', reason: 'rate_limited', provider: 'groq',
        schoolId: 'pu', checkedAt: preview.checkedAt, retryAfterSeconds: 30,
      });
      view = render(<CampusAssistantScreen route={{ params: { prompt: query } }} />);
      await consentAndRun(view);
      if (change === 'school') mockSchool = 'other';
      else mockUid = 'B';
      view.rerender(<CampusAssistantScreen />);
      if (change === 'account-back') {
        mockUid = 'A';
        view.rerender(<CampusAssistantScreen />);
      }
      expect(view.queryByRole('checkbox')).toBeNull();
      expect(view.getByLabelText('出發地與目的地').props.value).toBe('');
      previewRequest.mockResolvedValue({ ...preview, schoolId: mockSchool });
      runRequest.mockResolvedValue({ ...completed, schoolId: mockSchool });
      fireEvent.changeText(view.getByLabelText('出發地與目的地'), query);
      await consentAndRun(view);
      expect(runRequest).toHaveBeenCalledTimes(2);
      expect(view.getByText('導航建議已備妥')).toBeTruthy();
      expect(confirmCampusAgentWrite).not.toHaveBeenCalled();
    } finally {
      view?.unmount();
      jest.useRealTimers();
    }
  },
);

test('a late quota result from a previous owner cannot delay the returned account', async () => {
  const late = deferred<CloudNavigationResult>();
  runRequest.mockReturnValueOnce(late.promise);
  const view = render(<CampusAssistantScreen route={{ params: { prompt: query } }} />);
  await consentAndRun(view);
  mockUid = 'B';
  view.rerender(<CampusAssistantScreen />);
  mockUid = 'A';
  view.rerender(<CampusAssistantScreen />);
  await act(async () => late.resolve({
    status: 'unavailable', reason: 'rate_limited', provider: 'groq',
    schoolId: 'pu', checkedAt: preview.checkedAt, retryAfterSeconds: 30,
  }));
  fireEvent.changeText(view.getByLabelText('出發地與目的地'), query);
  await consentAndRun(view);
  expect(runRequest).toHaveBeenCalledTimes(2);
  expect(view.getByText('導航建議已備妥')).toBeTruthy();
  expect(view.queryByText(/後重試。/)).toBeNull();
});

test('a shorter same-owner cooldown report cannot advance the retained deadline', async () => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-11-02T15:00:00.000Z'));
  let view: ReturnType<typeof render> | undefined;
  try {
    view = render(<CampusAssistantScreen />);
    const report = view.UNSAFE_getByType(CampusCloudNavigationTask).props.onRateLimited;
    act(() => {
      report(Date.now() + 30_000);
      report(Date.now() + 10_000);
    });
    fireEvent.press(view.getByText('已存資料'));
    fireEvent.press(view.getByText('校園導航'));
    fireEvent.changeText(view.getByLabelText('出發地與目的地'), query);
    await consentAndRun(view);
    expect(runRequest).not.toHaveBeenCalled();
    act(() => jest.advanceTimersByTime(10_000));
    await act(async () => fireEvent.press(view!.getByText('確認規劃')));
    expect(runRequest).not.toHaveBeenCalled();
    act(() => jest.advanceTimersByTime(20_000));
    await act(async () => fireEvent.press(view!.getByText('確認規劃')));
    expect(runRequest).toHaveBeenCalledTimes(1);
  } finally {
    view?.unmount();
    jest.useRealTimers();
  }
});

test('an old cooldown callback cannot write a deadline after an owner ABA change', async () => {
  const view = render(<CampusAssistantScreen />);
  const oldReport = view.UNSAFE_getByType(CampusCloudNavigationTask).props.onRateLimited;
  mockUid = 'B';
  view.rerender(<CampusAssistantScreen />);
  mockUid = 'A';
  view.rerender(<CampusAssistantScreen />);
  act(() => oldReport(Date.now() + 30_000));
  fireEvent.press(view.getByText('已存資料'));
  fireEvent.press(view.getByText('校園導航'));
  fireEvent.changeText(view.getByLabelText('出發地與目的地'), query);
  await consentAndRun(view);
  expect(runRequest).toHaveBeenCalledTimes(1);
  expect(view.getByText('導航建議已備妥')).toBeTruthy();
});

 test('returning from another screen keeps edited navigation text but discards consent', async () => {
  const listeners = new Map<string, () => void>();
  const navigation = {
    isFocused: () => true,
    addListener: (event: 'blur' | 'focus', listener: () => void) => {
      listeners.set(event, listener); return () => { listeners.delete(event); };
    },
  };
  const view = render(<CampusAssistantScreen navigation={navigation} />);
  fireEvent.changeText(view.getByLabelText('出發地與目的地'), query);
  await act(async () => fireEvent.press(view.getByText('預覽傳送內容')));
  fireEvent.press(view.getByRole('checkbox'));
  act(() => listeners.get('blur')?.());
  act(() => listeners.get('focus')?.());
  expect(view.getByLabelText('出發地與目的地').props.value).toBe(query);
  expect(view.queryByRole('checkbox')).toBeNull();
  expect(runRequest).not.toHaveBeenCalled();
});

test('mode round trip keeps separate navigation and saved-data drafts', () => {
  const view = render(<CampusAssistantScreen />);
  fireEvent.changeText(view.getByLabelText('出發地與目的地'), query);
  fireEvent.press(view.getByText('已存資料'));
  fireEvent.changeText(view.getByLabelText('詢問校園助理'), '我今天有哪些課');
  fireEvent.press(view.getByText('校園導航'));
  expect(view.getByLabelText('出發地與目的地').props.value).toBe(query);
  fireEvent.press(view.getByText('已存資料'));
  expect(view.getByLabelText('詢問校園助理').props.value).toBe('我今天有哪些課');
});

 test('root-scoped text and quota survive an actual screen unmount without restoring a plan', async () => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-11-02T15:00:00.000Z'));
  const page = (visible: boolean) => <AgentDraftProvider>{visible ? <CampusAssistantScreen /> : null}</AgentDraftProvider>;
  let view: ReturnType<typeof render> | undefined;
  try {
    runRequest.mockResolvedValueOnce({ status: 'unavailable', reason: 'rate_limited', provider: 'groq', schoolId: 'pu', checkedAt: preview.checkedAt, retryAfterSeconds: 30 });
    view = render(page(true));
    fireEvent.changeText(view.getByLabelText('出發地與目的地'), query);
    await consentAndRun(view);
    view.rerender(page(false));
    view.rerender(page(true));
    expect(view.getByLabelText('出發地與目的地').props.value).toBe(query);
    expect(view.queryByRole('checkbox')).toBeNull();
    await consentAndRun(view);
    expect(runRequest).toHaveBeenCalledTimes(1);
    act(() => jest.advanceTimersByTime(30_000));
    await act(async () => fireEvent.press(view!.getByText('確認規劃')));
    expect(runRequest).toHaveBeenCalledTimes(2);
  } finally { view?.unmount(); jest.useRealTimers(); }
});

test('a back-stack route prompt cannot reappear after an account ABA and actual remount', () => {
  const route = { key: 'assistant-route-A', params: { prompt: query } };
  const setParams = jest.fn();
  const page = (visible: boolean) => <AgentDraftProvider>{visible ? <CampusAssistantScreen route={route} navigation={{ setParams } as React.ComponentProps<typeof CampusAssistantScreen>['navigation']} /> : null}</AgentDraftProvider>;
  const view = render(page(true));
  expect(view.getByLabelText('出發地與目的地').props.value).toBe(query);
  expect(setParams).toHaveBeenCalledWith({ prompt: undefined });
  fireEvent.changeText(view.getByLabelText('出發地與目的地'), '較新的草稿');
  view.rerender(page(false));
  view.rerender(page(true));
  expect(view.getByLabelText('出發地與目的地').props.value).toBe('較新的草稿');
  view.rerender(page(false));
  mockUid = 'B'; view.rerender(page(false));
  mockUid = 'A'; view.rerender(page(false));
  view.rerender(page(true));
  expect(view.getByLabelText('出發地與目的地').props.value).toBe('');
  expect(runRequest).not.toHaveBeenCalled();
});

test('a first route prompt waits for the same owner background check instead of being consumed and lost', () => {
  const route = { key: 'pending-route-A', params: { prompt: query } };
  const page = (visible: boolean) => <AgentDraftProvider>{visible ? <CampusAssistantScreen route={route} /> : null}</AgentDraftProvider>;
  const view = render(page(false));
  mockLoading = true;
  view.rerender(page(true));
  expect(view.getByLabelText('出發地與目的地').props.value).toBe('');
  mockLoading = false;
  view.rerender(page(true));
  expect(view.getByLabelText('出發地與目的地').props.value).toBe(query);
  expect(previewRequest).not.toHaveBeenCalled();
  expect(runRequest).not.toHaveBeenCalled();
});

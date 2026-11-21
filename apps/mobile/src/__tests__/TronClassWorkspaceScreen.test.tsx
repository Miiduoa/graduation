import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NuniError } from '@campus/shared/src/nuni';
import { TronClassWorkspaceScreen } from '../screens/TronClassWorkspaceScreen';
import {
  saveNativeTronClassPending,
  readNativeTronClassPending,
  clearNativeTronClassPending,
} from '../services/tronClassNativeDraft';
import {
  acknowledged,
  availability,
  connection,
  disconnected,
  homework,
  nextRevision,
  operationId,
  preparation,
  revision,
  snapshot,
  studentKey,
  submissionHistory,
} from './fixtures/tronClassIntegration';
import { fileBytes, directories, deleted, resetFileSystem } from './fixtures/tronClassFileSystem';

const accountA = 'pa_11111111-1111-4111-8111-111111111111';
const accountB = 'pa_22222222-2222-4222-8222-222222222222';
const mockBffRequest = jest.fn();
const mockUpload = jest.fn();
const mockDownload = jest.fn();
const mockSubmissionDownload = jest.fn();
const mockShare = jest.fn();
const mockSharingAvailable = jest.fn();
const mockRefresh = jest.fn(async () => undefined);
const mockLogout = jest.fn(async () => undefined);
const mockDocument = jest.fn();
let mockAuth: {
  session: { platformAccountId: string; context: string } | null;
  loading: boolean;
  error: string;
  pendingLogout: boolean;
};
let mockSchool: { user: { uid: string } | null; loading: boolean; tokenExpired: boolean };
let mockPreparation = preparation;
let mockConnection = connection;
let mockSnapshot = snapshot;
let mockId = 0;
let mockSubmissionDownloadEnabled = true;

jest.mock('../state/nuniSession', () => ({
  useNuniSession: () => ({
    ...mockAuth,
    bffRequest: mockBffRequest,
    upload: mockUpload,
    tronClassDownload: mockDownload,
    tronClassSubmissionDownload: mockSubmissionDownloadEnabled ? mockSubmissionDownload : undefined,
    refresh: mockRefresh,
    logout: mockLogout,
    isSessionCurrent: (owner: string, context: string) =>
      !mockAuth.loading &&
      !mockAuth.error &&
      !mockAuth.pendingLogout &&
      mockAuth.session?.platformAccountId === owner &&
      mockAuth.session.context === context,
  }),
}));
jest.mock('../state/auth', () => ({ useAuth: () => mockSchool }));
jest.mock('../firebase', () => ({ getAuthInstance: () => ({ currentUser: mockSchool.user }) }));
jest.mock('expo-document-picker', () => ({
  getDocumentAsync: (input: unknown) => mockDocument(input),
}));
jest.mock('expo-crypto', () => ({
  randomUUID: () => `aaaaaaaa-aaaa-4aaa-8aaa-${String(++mockId).padStart(12, '0')}`,
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digest: async () => new Uint8Array(32).fill(0xdd).buffer,
}));
jest.mock('expo-file-system', () => require('./fixtures/tronClassFileSystem'));
jest.mock('expo-sharing', () => ({
  isAvailableAsync: () => mockSharingAvailable(),
  shareAsync: (...args: unknown[]) => mockShare(...args),
}));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => undefined) }));
jest.mock('@react-navigation/native', () => ({
  NavigationContext: require('react').createContext(null),
}));
jest.mock('../ui/aiFirst', () => {
  const React = require('react');
  const { View, Text, Pressable } = require('react-native');
  return {
    aiTokens: { text: '#111', muted: '#555', border: '#ddd', danger: '#c00' },
    AIScreen: ({ children }: { children: React.ReactNode }) => <View>{children}</View>,
    AIHero: ({ title, subtitle }: { title: string; subtitle: string }) => (
      <View>
        <Text>{title}</Text>
        <Text>{subtitle}</Text>
      </View>
    ),
    AICard: ({ title, children }: { title?: string; children?: React.ReactNode }) => (
      <View>
        {title && <Text>{title}</Text>}
        {children}
      </View>
    ),
    AIRow: ({
      title,
      subtitle,
      onPress,
    }: {
      title: string;
      subtitle: string;
      onPress: () => void;
    }) => (
      <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={onPress}>
        <Text>{title}</Text>
        <Text>{subtitle}</Text>
      </Pressable>
    ),
    AIButton: ({
      label,
      disabled,
      onPress,
    }: {
      label: string;
      disabled?: boolean;
      onPress: () => void;
    }) => (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onPress}
      >
        <Text>{label}</Text>
      </Pressable>
    ),
  };
});

async function defaultRequest(_path: string, _context: string, input: Record<string, unknown>) {
  switch (input.action) {
    case 'status':
      return mockConnection;
    case 'connect':
      return mockConnection;
    case 'disconnect':
      return disconnected;
    case 'courses':
      return { kind: 'course-index', revision: mockConnection.revision, fetchedAt: mockSnapshot.fetchedAt,
        courses: mockSnapshot.courses.map((course) => ({ ...course, href: `https://tronclass.pu.edu.tw/course/${course.id}/content` })),
        errors: [], partial: false };
    case 'sync':
      return mockSnapshot;
    case 'prepare':
      return mockPreparation;
    case 'submit':
      return acknowledged(String(input.operationId));
    case 'reconcile':
      return { status: 'unknown', operationId: input.operationId, receipt: null };
    case 'cancel-preparation':
      return { status: 'unknown', operationId: input.operationId,
        courseId: input.courseId, homeworkId: input.homeworkId };
    default:
      throw new Error('unexpected action');
  }
}
beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  mockAuth = {
    session: { platformAccountId: accountA, context: 'context-a' },
    loading: false,
    error: '',
    pendingLogout: false,
  };
  mockSchool = { user: null, loading: false, tokenExpired: false };
  mockPreparation = { ...preparation };
  mockConnection = { ...connection };
  mockSnapshot = { ...snapshot };
  mockId = 0;
  mockSubmissionDownloadEnabled = true;
  resetFileSystem();
  fileBytes.set('file:///cache/picked-answer.pdf', new Uint8Array([1, 2, 3]));
  mockShare.mockResolvedValue(undefined);
  mockSharingAvailable.mockResolvedValue(true);
  jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-18T10:00:00.000Z'));
  mockDownload.mockResolvedValue({
    bytes: new Uint8Array([5, 6, 7]),
    filename: '講義.pdf',
    contentType: 'application/pdf',
  });
  mockSubmissionDownload.mockResolvedValue({
    bytes: new Uint8Array([4, 5, 6]),
    filename: '先前答案.pdf',
    contentType: 'application/pdf',
  });
  mockBffRequest.mockImplementation(defaultRequest);
  mockDocument.mockResolvedValue({ canceled: true });
  mockUpload.mockImplementation(async (_path, _context, bytes, contentType, query) => ({
    status: 'uploaded',
    fileId: query.fileId,
    name: query.name,
    size: bytes.byteLength,
    contentType,
    sha256: 'd'.repeat(64),
  }));
});
afterEach(() => {
  jest.restoreAllMocks();
});
function actions(name: string) {
  return mockBffRequest.mock.calls.map((call) => call[2]).filter((input) => input.action === name);
}
async function openAssignment(view: ReturnType<typeof render>) {
  fireEvent.press(await view.findByRole('button', { name: homework.title }));
  await waitFor(() =>
    expect(view.getByRole('button', { name: '預覽並重新核對' })).not.toBeDisabled(),
  );
}
async function previewDraft(view: ReturnType<typeof render>, content = '我的答案') {
  fireEvent.changeText(view.getByLabelText('作業內容'), content);
  fireEvent.press(view.getByRole('button', { name: '預覽並重新核對' }));
  await view.findByText('確認這次作業內容');
  await waitFor(() => expect(view.queryByLabelText('正在準備預覽並重新核對作業…')).toBeNull());
}
async function confirmAndSend(view: ReturnType<typeof render>) {
  fireEvent(view.getByLabelText('我已確認要把這份作業送至校方'), 'valueChange', true);
  fireEvent.press(view.getByRole('button', { name: '確認並繳交至 TronClass' }));
}

it('shows personal school windows and drafts without enabling the native writer', async () => {
  mockPreparation = { ...preparation, availability };
  const view = render(<TronClassWorkspaceScreen />);
  await openAssignment(view);
  expect(view.getByText('一般再次繳交：一般繳交次數已用完，剩餘 0 次')).toBeTruthy();
  expect(view.getByText('個人補交：個人補交已開放')).toBeTruthy();
  expect(view.getByText('個人重繳：作業目前未開放重繳')).toBeTruthy();
  expect(view.getByText('校方草稿：校方有 1 份草稿，請至 TronClass 接續')).toBeTruthy();
  expect(view.getByText(/nuni 可送出的方式仍以本頁繳交區為準/)).toBeTruthy();
  expect(view.getByText('目前可在本頁整理與預覽；正式繳交請使用 TronClass 原頁。')).toBeTruthy();
  await previewDraft(view);
  fireEvent(view.getByLabelText('我已確認要把這份作業送至校方'), 'valueChange', true);
  expect(view.getByRole('button', { name: '確認並繳交至 TronClass' })).toBeDisabled();
  expect(actions('submit')).toHaveLength(0);
  expect(mockUpload).not.toHaveBeenCalled();
});

it('retries an unavailable personal status without removing the native answer or existing school history', async () => {
  mockPreparation = { ...preparation, history: submissionHistory, availability: { ...availability, state: 'unavailable',
    ordinary: { state: 'unknown', kind: 'unknown', remainingAttempts: null },
    makeUp: { state: 'unknown', updatedAt: null }, resubmit: { state: 'unknown', updatedAt: null },
    draft: { state: 'unknown', submissionId: null, count: null } } };
  const view = render(<TronClassWorkspaceScreen />);
  await openAssignment(view);
  expect(view.getByText(/暫時無法確認你的校方繳交狀態/)).toBeTruthy();
  expect(view.getByText('先前版本的答案')).toBeTruthy();
  fireEvent.changeText(view.getByLabelText('作業內容'), '繼續整理中的答案');
  mockPreparation = { ...mockPreparation, availability: { ...availability,
    ordinary: { state: 'open', kind: 'first', remainingAttempts: null } } };
  fireEvent.press(view.getByRole('button', { name: '重新讀取繳交狀態' }));
  await view.findByText('一般初繳：校方目前開放');
  expect(view.getByLabelText('作業內容').props.value).toBe('繼續整理中的答案');
  expect(view.getByText('先前版本的答案')).toBeTruthy();
  expect(actions('prepare')).toHaveLength(2);
  expect(actions('submit')).toHaveLength(0);
});

it('filters school submission states and orders unfinished work by deadline without hiding unknown status', async () => {
  const items = [
    { ...homework, id: 21, title: '已完成報告', submitted: true, deadline: '2026-11-01T00:00:00.000Z' },
    { ...homework, id: 22, title: '未提供期限的作業', submitted: false, deadline: null },
    { ...homework, id: 23, title: '狀態尚未取得的報告', deadline: '2026-11-13T00:00:00.000Z' },
    { ...homework, id: 24, title: '近期報告', submitted: false, deadline: '2026-11-14T00:00:00.000Z' },
    { ...homework, id: 25, courseId: 11, courseName: '資料庫', title: '資料庫練習', submitted: false, deadline: '2026-11-20T00:00:00.000Z' },
  ];
  mockSnapshot = { ...snapshot,
    courses: [...snapshot.courses, { ...snapshot.courses[0], id: 11, name: '資料庫' }],
    homework: items,
  };
  const view = render(<TronClassWorkspaceScreen />);
  await view.findByRole('button', { name: '全部作業，5 份' });
  const visibleTitles = () => view.getAllByRole('button')
    .map((button) => button.props.accessibilityLabel as string)
    .filter((label) => items.some((item) => item.title === label));
  expect(visibleTitles()).toEqual(['狀態尚未取得的報告', '近期報告', '資料庫練習', '未提供期限的作業', '已完成報告']);
  fireEvent.press(view.getByRole('button', { name: '待繳交，3 份' }));
  expect(view.getByRole('button', { name: '待繳交，3 份' })).toHaveAccessibilityState({ selected: true });
  expect(visibleTitles()).toEqual(['近期報告', '資料庫練習', '未提供期限的作業']);
  fireEvent.press(view.getByRole('button', { name: '狀態待確認，1 份' }));
  expect(visibleTitles()).toEqual(['狀態尚未取得的報告']);
  fireEvent.press(view.getByRole('button', { name: '已繳交，1 份' }));
  expect(visibleTitles()).toEqual(['已完成報告']);
  fireEvent.press(view.getByRole('button', { name: '全部作業，5 份' }));
  fireEvent.changeText(view.getByLabelText('搜尋作業'), '資料庫');
  expect(visibleTitles()).toEqual(['資料庫練習']);
  expect(view.getByRole('button', { name: '待繳交，1 份' })).toBeTruthy();
  expect(view.getByRole('button', { name: '狀態待確認，0 份' })).toBeTruthy();
  expect(actions('sync')).toHaveLength(1);
});

it.each(['confirmed', 'submitted'] as const)(
  'updates the assignment list only after a verified %s result and allows a later source refresh',
  async (status) => {
    mockPreparation = { ...preparation, canSubmit: true, blockedReason: null };
    mockSnapshot = { ...snapshot, homework: [{ ...homework, submitted: false }] };
    if (status === 'submitted') mockBffRequest.mockImplementation((path, context, input) =>
      input.action === 'submit' ? Promise.resolve({ status, operationId: input.operationId,
        receipt: { id: 'receipt-30', courseId: 10, homeworkId: 20, status: 'submitted',
          source: 'tronclass', submittedAt: '2026-11-18T10:00:00.000Z', content: '我的答案', attachments: [] },
      }) : defaultRequest(path, context, input));
    const view = render(<TronClassWorkspaceScreen />);
    await openAssignment(view);
    await previewDraft(view);
    await confirmAndSend(view);
    await view.findByText(status === 'confirmed' ? '已確認校方版本' : '校方已確認繳交');
    expect(view.getByText('目前清單狀態：已繳交')).toBeTruthy();
    await waitFor(() => expect(view.getByRole('button', { name: '返回作業清單' })).not.toBeDisabled());
    fireEvent.press(view.getByRole('button', { name: '返回作業清單' }));
    expect(view.getByRole('button', { name: '已繳交，1 份' })).toBeTruthy();
    expect(view.getByRole('button', { name: '待繳交，0 份' })).toBeTruthy();
    fireEvent.press(view.getByRole('button', { name: '已繳交，1 份' }));
    expect(view.getByRole('button', { name: homework.title })).toBeTruthy();
    // The school's next explicit read can report a changed/returned state.
    fireEvent.press(view.getByRole('button', { name: '重新整理課務資料' }));
    await view.findByRole('button', { name: '待繳交，1 份' });
    expect(view.getByRole('button', { name: '已繳交，0 份' })).toBeTruthy();
    expect(actions('submit')).toHaveLength(1);
  },
);

it.each(['submit', 'reconcile'] as const)(
  'keeps assignment and account navigation locked during %s and never marks an unknown result as submitted',
  async (action) => {
    mockPreparation = { ...preparation, canSubmit: true, blockedReason: null };
    mockSnapshot = { ...snapshot, homework: [{ ...homework, submitted: false }] };
    let resolveOperation: (value: unknown) => void = () => undefined;
    const pending = new Promise((resolve) => { resolveOperation = resolve; });
    mockBffRequest.mockImplementation((path, context, input) =>
      input.action === action ? pending : defaultRequest(path, context, input));
    if (action === 'reconcile') await saveNativeTronClassPending(`platform:${accountA}`, 10, 20, operationId);
    const view = render(<TronClassWorkspaceScreen />);
    if (action === 'submit') {
      await openAssignment(view);
      await previewDraft(view);
      await confirmAndSend(view);
    } else fireEvent.press(await view.findByRole('button', { name: homework.title }));
    await waitFor(() => expect(actions(action)).toHaveLength(1));
    for (const name of ['返回作業清單', '重新連接或切換校方帳號', '解除 TronClass 連接', '重新整理課務資料']) {
      expect(view.getByRole('button', { name })).toBeDisabled();
      fireEvent.press(view.getByRole('button', { name }));
    }
    expect(actions('status')).toHaveLength(1);
    expect(view.queryByRole('button', { name: homework.title })).toBeNull();
    const input = actions(action)[0];
    await act(async () => resolveOperation({ status: 'unknown', operationId: input.operationId, receipt: null }));
    await waitFor(() => expect(view.getByRole('button', { name: '返回作業清單' })).not.toBeDisabled());
    fireEvent.press(view.getByRole('button', { name: '返回作業清單' }));
    expect(view.getByRole('button', { name: '已繳交，0 份' })).toBeTruthy();
    expect(view.getByRole('button', { name: '待繳交，1 份' })).toBeTruthy();
    expect(await readNativeTronClassPending(`platform:${accountA}`, 10, 20)).toBe(input.operationId);
  },
);

it('loads courses, distinguishes unknown submitted state and permits a read-only local preview without writes', async () => {
  const view = render(<TronClassWorkspaceScreen />);
  await openAssignment(view);
  expect(view.getByText('目前清單狀態：尚未確認')).toBeTruthy();
  await previewDraft(view);
  expect(view.getByRole('button', { name: '確認並繳交至 TronClass' })).toBeDisabled();
  expect(actions('prepare')).toHaveLength(2);
  expect(actions('submit')).toHaveLength(0);
  expect(mockUpload).not.toHaveBeenCalled();
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});
it('performs fresh preparation after preview and confirmation, then shows acknowledged readback without inventing a submission time', async () => {
  mockPreparation = { ...preparation, canSubmit: true, blockedReason: null };
  const view = render(<TronClassWorkspaceScreen />);
  await openAssignment(view);
  await previewDraft(view);
  await confirmAndSend(view);
  await view.findByText('已確認校方版本');
  expect(actions('prepare')).toHaveLength(3);
  expect(actions('submit')).toHaveLength(1);
  expect(actions('submit')[0]).toMatchObject({
    courseId: 10,
    homeworkId: 20,
    revision,
    content: '我的答案',
    attachments: [],
    confirmed: true,
  });
  expect(view.getByText('來源紀錄時間：未提供')).toBeTruthy();
  expect(view.queryByText(/^繳交時間：/)).toBeNull();
  expect(await readNativeTronClassPending(`platform:${accountA}`, 10, 20)).toBeNull();
});
it('selects native files, freezes bytes for preview, uploads once and submits only the returned verified ID', async () => {
  mockPreparation = { ...preparation, canSubmit: true, blockedReason: null };
  mockDocument.mockResolvedValue({
    canceled: false,
    assets: [
      {
        name: '答案.pdf',
        uri: 'file:///cache/picked-answer.pdf',
        size: 3,
        mimeType: 'application/pdf',
      },
    ],
  });
  const view = render(<TronClassWorkspaceScreen />);
  await openAssignment(view);
  fireEvent.press(view.getByRole('button', { name: '選擇作業附件' }));
  await view.findByText('答案.pdf · 3 B');
  await previewDraft(view);
  // The source file changed after preview. Only the frozen, confirmed bytes may be sent.
  for (const uri of fileBytes.keys())
    if (uri.endsWith('.draft')) fileBytes.set(uri, new Uint8Array([9, 9, 9]));
  await confirmAndSend(view);
  await view.findByText('已確認校方版本');
  expect(mockDocument).toHaveBeenCalledWith({
    multiple: true,
    copyToCacheDirectory: true,
    type: '*/*',
  });
  expect(mockUpload).toHaveBeenCalledTimes(1);
  expect(Array.from(mockUpload.mock.calls[0][2])).toEqual([1, 2, 3]);
  expect(actions('submit')[0].attachments).toEqual([mockUpload.mock.calls[0][4].fileId]);
  expect(AsyncStorage.setItem).toHaveBeenCalledTimes(1);
  expect(AsyncStorage.setItem).toHaveBeenCalledWith(
    expect.stringContaining('pending.v1:'),
    actions('submit')[0].operationId,
  );
});
it('requires a new confirmation if the final prepare changes the school rules, without uploading or submitting', async () => {
  mockPreparation = { ...preparation, canSubmit: true, blockedReason: null };
  const view = render(<TronClassWorkspaceScreen />);
  await openAssignment(view);
  await previewDraft(view);
  mockPreparation = { ...mockPreparation, title: '校方已更新作業題目' };
  await confirmAndSend(view);
  await view.findByText('校方作業條件已變更，請查看最新要求並重新確認。');
  expect(actions('submit')).toHaveLength(0);
  expect(mockUpload).not.toHaveBeenCalled();
  expect(view.getByRole('button', { name: '確認並繳交至 TronClass' })).toBeDisabled();
});
it('does not treat a newer observation timestamp as a changed confirmation requirement', async () => {
  const details = {
    status: 'available' as const,
    fetchedAt: '2026-11-18T10:00:00.000Z',
    submissionType: 'individual' as const,
    mode: 'normal' as const,
    opensAt: null,
    deadline: null,
    isInProgress: true,
    isClosed: false,
    attempts: { unlimited: null, limit: null, used: null, remaining: null },
    resubmissionOpen: null,
    retractAllowed: null,
  };
  mockPreparation = { ...preparation, canSubmit: true, blockedReason: null, details };
  const view = render(<TronClassWorkspaceScreen />);
  await openAssignment(view);
  await previewDraft(view);
  mockPreparation = {
    ...mockPreparation,
    details: { ...details, fetchedAt: '2026-11-18T10:01:00.000Z' },
  };
  await confirmAndSend(view);
  await view.findByText('已確認校方版本');
  expect(actions('submit')).toHaveLength(1);
});
it('never resends a lost submit reply and only queries the original operation', async () => {
  mockPreparation = { ...preparation, canSubmit: true, blockedReason: null };
  mockBffRequest.mockImplementation((path, context, input) =>
    input.action === 'submit'
      ? Promise.reject(new NuniError(0, 'NETWORK_ERROR'))
      : defaultRequest(path, context, input),
  );
  const view = render(<TronClassWorkspaceScreen />);
  await openAssignment(view);
  await previewDraft(view);
  await confirmAndSend(view);
  await view.findByText('前次送出結果待確認');
  const pending = actions('submit')[0].operationId;
  expect(await readNativeTronClassPending(`platform:${accountA}`, 10, 20)).toBe(pending);
  fireEvent.press(view.getByRole('button', { name: '查詢原送出結果' }));
  await waitFor(() => expect(actions('reconcile')).toHaveLength(1));
  expect(actions('reconcile')[0]).toEqual({ action: 'reconcile', operationId: pending, revision });
  expect(actions('submit')).toHaveLength(1);
  expect(view.queryByRole('button', { name: '確認並繳交至 TronClass' })).toBeNull();
});
it('restores a pending operation as read-only reconciliation before any editor can send', async () => {
  await saveNativeTronClassPending(`platform:${accountA}`, 10, 20, operationId);
  const view = render(<TronClassWorkspaceScreen />);
  fireEvent.press(await view.findByRole('button', { name: homework.title }));
  await view.findByText('前次送出結果待確認');
  await waitFor(() => expect(actions('reconcile')).toHaveLength(1));
  expect(actions('submit')).toHaveLength(0);
  expect(view.queryByLabelText('作業內容')).toBeNull();
});
it('unlocks editing only after the server explicitly proves that the final submission was not started', async () => {
  await saveNativeTronClassPending(`platform:${accountA}`, 10, 20, operationId);
  mockBffRequest.mockImplementation((path, context, input) =>
    input.action === 'reconcile'
      ? Promise.reject(new NuniError(409, 'TRONCLASS_SUBMISSION_NOT_STARTED'))
      : defaultRequest(path, context, input),
  );
  const view = render(<TronClassWorkspaceScreen />);
  await openAssignment(view);
  await view.findByText('已確認這次作業未送出，請重新預覽與確認後再繳交。');
  expect(await readNativeTronClassPending(`platform:${accountA}`, 10, 20)).toBeNull();
  expect(actions('submit')).toHaveLength(0);
});
it('explicitly stops a failed upload preparation, keeps text and files, and requires a fresh preview before a new operation', async () => {
  mockPreparation = { ...preparation, canSubmit: true, blockedReason: null };
  mockDocument.mockResolvedValue({ canceled: false, assets: [{
    name: '答案.pdf', uri: 'file:///cache/picked-answer.pdf', size: 3, mimeType: 'application/pdf',
  }] });
  mockUpload.mockRejectedValueOnce(new NuniError(0, 'NETWORK_ERROR'));
  mockBffRequest.mockImplementation((path, context, input) => input.action === 'cancel-preparation'
    ? Promise.resolve({ status: 'cancelled', operationId: input.operationId,
      courseId: input.courseId, homeworkId: input.homeworkId })
    : defaultRequest(path, context, input));
  const view = render(<TronClassWorkspaceScreen />);
  await openAssignment(view);
  fireEvent.press(view.getByRole('button', { name: '選擇作業附件' }));
  await view.findByText('答案.pdf · 3 B');
  await previewDraft(view, '保留原本整理的答案');
  await confirmAndSend(view);
  await view.findByText('前次送出結果待確認');
  const firstOperation = mockUpload.mock.calls[0][4].operationId;
  expect(await readNativeTronClassPending(`platform:${accountA}`, 10, 20)).toBe(firstOperation);
  expect(actions('cancel-preparation')).toHaveLength(0);
  expect(actions('submit')).toHaveLength(0);
  fireEvent.press(view.getByRole('button', { name: '停止準備並返回編輯' }));
  await view.findByText('已停止尚未送出的準備，文字與附件已保留。請重新預覽與確認後再繳交。');
  expect(actions('cancel-preparation')).toEqual([{ action: 'cancel-preparation',
    courseId: 10, homeworkId: 20, revision, operationId: firstOperation }]);
  expect(await readNativeTronClassPending(`platform:${accountA}`, 10, 20)).toBeNull();
  expect(view.getByLabelText('作業內容').props.value).toBe('保留原本整理的答案');
  expect(view.getByText('答案.pdf · 3 B')).toBeTruthy();
  expect(view.queryByRole('button', { name: '確認並繳交至 TronClass' })).toBeNull();
  for (const uri of fileBytes.keys())
    if (uri.endsWith('.draft')) fileBytes.set(uri, new Uint8Array([9, 8, 7]));
  fireEvent.press(view.getByRole('button', { name: '預覽並重新核對' }));
  await view.findByText('確認這次作業內容');
  await waitFor(() => expect(view.queryByLabelText('正在準備預覽並重新核對作業…')).toBeNull());
  expect(view.getByRole('button', { name: '確認並繳交至 TronClass' })).toBeDisabled();
  await confirmAndSend(view);
  await view.findByText('已確認校方版本');
  expect(mockUpload).toHaveBeenCalledTimes(2);
  expect(Array.from(mockUpload.mock.calls[1][2])).toEqual([9, 8, 7]);
  expect(actions('submit')).toHaveLength(1);
  expect(actions('submit')[0].operationId).not.toBe(firstOperation);
});
it.each(['unknown', 'malformed', 'network'])(
  'keeps the pending operation and disables editing after a %s cancellation outcome', async (outcome) => {
    await saveNativeTronClassPending(`platform:${accountA}`, 10, 20, operationId);
    mockBffRequest.mockImplementation((path, context, input) => {
      if (input.action !== 'cancel-preparation') return defaultRequest(path, context, input);
      if (outcome === 'network') return Promise.reject(new NuniError(0, 'NETWORK_ERROR'));
      return Promise.resolve({ status: outcome === 'malformed' ? ['cancelled'] : 'unknown',
        operationId, courseId: 10, homeworkId: 20 });
    });
    const view = render(<TronClassWorkspaceScreen />);
    fireEvent.press(await view.findByRole('button', { name: homework.title }));
    await waitFor(() => expect(view.getByRole('button', { name: '停止準備並返回編輯' })).not.toBeDisabled());
    fireEvent.press(view.getByRole('button', { name: '停止準備並返回編輯' }));
    await waitFor(() => expect(actions('cancel-preparation')).toHaveLength(1));
    await waitFor(() => expect(view.getByRole('button', { name: '停止準備並返回編輯' })).not.toBeDisabled());
    expect(await readNativeTronClassPending(`platform:${accountA}`, 10, 20)).toBe(operationId);
    expect(view.getByText('前次送出結果待確認')).toBeTruthy();
    expect(view.queryByLabelText('作業內容')).toBeNull();
    expect(AsyncStorage.removeItem).not.toHaveBeenCalled();
    expect(actions('submit')).toHaveLength(0);
    expect(mockUpload).not.toHaveBeenCalled();
  },
);
it('keeps a cancelled operation pending when device storage removal fails and allows explicit retry', async () => {
  await saveNativeTronClassPending(`platform:${accountA}`, 10, 20, operationId);
  mockBffRequest.mockImplementation((path, context, input) => input.action === 'cancel-preparation'
    ? Promise.resolve({ status: 'cancelled', operationId, courseId: 10, homeworkId: 20 })
    : defaultRequest(path, context, input));
  const view = render(<TronClassWorkspaceScreen />);
  fireEvent.press(await view.findByRole('button', { name: homework.title }));
  await waitFor(() => expect(view.getByRole('button', { name: '停止準備並返回編輯' })).not.toBeDisabled());
  jest.mocked(AsyncStorage.removeItem).mockRejectedValueOnce(new Error('storage unavailable'));
  fireEvent.press(view.getByRole('button', { name: '停止準備並返回編輯' }));
  await view.findByText('已停止準備，但無法更新裝置紀錄。請再次停止準備後再編輯。');
  expect(view.queryByLabelText('作業內容')).toBeNull();
  expect(await readNativeTronClassPending(`platform:${accountA}`, 10, 20)).toBe(operationId);
  fireEvent.press(view.getByRole('button', { name: '停止準備並返回編輯' }));
  await view.findByLabelText('作業內容');
  expect(await readNativeTronClassPending(`platform:${accountA}`, 10, 20)).toBeNull();
  expect(actions('cancel-preparation')).toHaveLength(2);
  expect(actions('submit')).toHaveLength(0);
});
it('preserves a newer same-owner pending operation when an earlier cancellation response arrives', async () => {
  await saveNativeTronClassPending(`platform:${accountA}`, 10, 20, operationId);
  let finish: (value: unknown) => void = () => undefined;
  mockBffRequest.mockImplementation((path, context, input) => input.action === 'cancel-preparation'
    ? new Promise(resolve => { finish = resolve; })
    : defaultRequest(path, context, input));
  const view = render(<TronClassWorkspaceScreen />);
  fireEvent.press(await view.findByRole('button', { name: homework.title }));
  await waitFor(() => expect(view.getByRole('button', { name: '停止準備並返回編輯' })).not.toBeDisabled());
  fireEvent.press(view.getByRole('button', { name: '停止準備並返回編輯' }));
  await waitFor(() => expect(actions('cancel-preparation')).toHaveLength(1));
  // Another screen has independently resolved the old operation and started a
  // new one while this screen is still waiting for its original cancellation.
  const newer = '22222222-2222-4222-8222-222222222222';
  await clearNativeTronClassPending(`platform:${accountA}`, 10, 20, operationId);
  await saveNativeTronClassPending(`platform:${accountA}`, 10, 20, newer);
  const removals = jest.mocked(AsyncStorage.removeItem).mock.calls.length;
  await act(async () => { finish({ status: 'cancelled', operationId, courseId: 10, homeworkId: 20 }); });
  await view.findByText('裝置已有另一筆待查操作，請返回作業清單再開啟，先查證該筆紀錄。');
  expect(await readNativeTronClassPending(`platform:${accountA}`, 10, 20)).toBe(newer);
  expect(AsyncStorage.removeItem).toHaveBeenCalledTimes(removals);
  expect(view.getByText('前次送出結果待確認')).toBeTruthy();
  expect(view.queryByLabelText('作業內容')).toBeNull();
  expect(actions('submit')).toHaveLength(0);
  expect(mockUpload).not.toHaveBeenCalled();
});
it.each(['owner', 'session', 'unmount', 'expired-binding'])(
  'does not clear a pending operation for a delayed cancellation after %s changes', async (change) => {
    await saveNativeTronClassPending(`platform:${accountA}`, 10, 20, operationId);
    let finish: (value: unknown) => void = () => undefined;
    mockBffRequest.mockImplementation((path, context, input) => input.action === 'cancel-preparation'
      ? new Promise(resolve => { finish = resolve; })
      : defaultRequest(path, context, input));
    const view = render(<TronClassWorkspaceScreen />);
    fireEvent.press(await view.findByRole('button', { name: homework.title }));
    await waitFor(() => expect(view.getByRole('button', { name: '停止準備並返回編輯' })).not.toBeDisabled());
    fireEvent.press(view.getByRole('button', { name: '停止準備並返回編輯' }));
    fireEvent.press(view.getByRole('button', { name: '停止準備並返回編輯' }));
    await waitFor(() => expect(actions('cancel-preparation')).toHaveLength(1));
    expect(view.getByRole('button', { name: '查詢原送出結果' })).toBeDisabled();
    if (change === 'unmount') view.unmount();
    else if (change === 'expired-binding')
      jest.mocked(Date.now).mockReturnValue(Date.parse(connection.expiresAt!) + 1);
    else {
      mockAuth = { ...mockAuth, session: {
        platformAccountId: change === 'owner' ? accountB : accountA, context: 'context-next',
      } };
      mockConnection = { ...disconnected };
      view.rerender(<TronClassWorkspaceScreen />);
    }
    await act(async () => { finish({ status: 'cancelled', operationId, courseId: 10, homeworkId: 20 }); });
    expect(await readNativeTronClassPending(`platform:${accountA}`, 10, 20)).toBe(operationId);
    expect(AsyncStorage.removeItem).not.toHaveBeenCalled();
    expect(actions('submit')).toHaveLength(0);
    if (change !== 'unmount') expect(view.queryByLabelText('作業內容')).toBeNull();
  },
);
it('blocks a send if the operation journal cannot be read', async () => {
  jest.mocked(AsyncStorage.getItem).mockRejectedValueOnce(new Error('storage unavailable'));
  const view = render(<TronClassWorkspaceScreen />);
  fireEvent.press(await view.findByRole('button', { name: homework.title }));
  await view.findByText('無法讀取前次送出紀錄。請重新讀取，確認之前沒有待查操作後才能送出。');
  expect(view.getByRole('button', { name: '預覽並重新核對' })).toBeDisabled();
  expect(actions('submit')).toHaveLength(0);
});
it('does not upload or submit if the operation journal cannot be persisted', async () => {
  mockPreparation = { ...preparation, canSubmit: true, blockedReason: null };
  const view = render(<TronClassWorkspaceScreen />);
  await openAssignment(view);
  await previewDraft(view);
  jest.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error('storage unavailable'));
  await confirmAndSend(view);
  await view.findByText('無法保留送出查證編號，這次尚未送出。請重新讀取作業後再試。');
  expect(actions('submit')).toHaveLength(0);
  expect(mockUpload).not.toHaveBeenCalled();
});
it('blocks a changed local file before preview can grant confirmation', async () => {
  mockPreparation = { ...preparation, canSubmit: true, blockedReason: null };
  mockDocument.mockResolvedValue({
    canceled: false,
    assets: [
      {
        name: '答案.pdf',
        uri: 'file:///cache/picked-answer.pdf',
        size: 3,
        mimeType: 'application/pdf',
      },
    ],
  });
  const view = render(<TronClassWorkspaceScreen />);
  await openAssignment(view);
  fireEvent.press(view.getByRole('button', { name: '選擇作業附件' }));
  await view.findByText('答案.pdf · 3 B');
  for (const uri of fileBytes.keys())
    if (uri.endsWith('.draft')) fileBytes.set(uri, new Uint8Array(9));
  fireEvent.press(view.getByRole('button', { name: '預覽並重新核對' }));
  await view.findByText('附件已變更或無法讀取。請移除後重新選檔，再預覽作業。');
  expect(actions('submit')).toHaveLength(0);
  expect(mockUpload).not.toHaveBeenCalled();
  expect(view.queryByRole('button', { name: '確認並繳交至 TronClass' })).toBeNull();
});
it('drops a delayed previous-owner response after account switching', async () => {
  let resolveStatus: (value: unknown) => void = () => undefined;
  mockBffRequest.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveStatus = resolve;
      }),
  );
  const view = render(<TronClassWorkspaceScreen />);
  mockAuth = { ...mockAuth, session: { platformAccountId: accountB, context: 'context-b' } };
  mockConnection = { ...disconnected };
  view.rerender(<TronClassWorkspaceScreen />);
  await view.findByLabelText('TronClass 帳號');
  await act(async () => {
    resolveStatus(connection);
  });
  expect(view.queryByText('已連接 同學 A')).toBeNull();
  expect(actions('sync')).toHaveLength(0);
});
it('requires confirmed rules even if an older prepare response says canSubmit', async () => {
  mockPreparation = { ...preparation, canSubmit: true, rules: undefined };
  const view = render(<TronClassWorkspaceScreen />);
  await openAssignment(view);
  await previewDraft(view);
  expect(view.getByRole('button', { name: '確認並繳交至 TronClass' })).toBeDisabled();
});
it('uses explicitly empty current assignment content and a removed deadline without reviving stale list text', async () => {
  mockPreparation = { ...preparation, title: '新版題目', description: '', deadline: null };
  const view = render(<TronClassWorkspaceScreen />);
  await openAssignment(view);
  expect(view.getByText('新版題目')).toBeTruthy();
  expect(view.getByText('校方尚未提供文字說明。')).toBeTruthy();
  expect(view.getByText('截止時間：未提供')).toBeTruthy();
  expect(view.queryByText(homework.description)).toBeNull();
});
it('masks school data and drops the draft immediately on a nuni owner switch', async () => {
  const view = render(<TronClassWorkspaceScreen />);
  await openAssignment(view);
  fireEvent.changeText(view.getByLabelText('作業內容'), '帳號 A 的私密草稿');
  mockAuth = { ...mockAuth, session: { platformAccountId: accountB, context: 'context-b' } };
  mockConnection = { ...disconnected };
  view.rerender(<TronClassWorkspaceScreen />);
  await view.findByLabelText('TronClass 帳號');
  expect(view.queryByDisplayValue('帳號 A 的私密草稿')).toBeNull();
  expect(view.queryByText(homework.title)).toBeNull();
  expect(mockBffRequest.mock.calls.at(-1)?.[1]).toBe('context-b');
});
it('does not fall back to stale Firebase when the platform session is unresolved', async () => {
  mockAuth = { session: null, loading: false, error: 'unverified', pendingLogout: false };
  mockSchool = { user: { uid: 'firebase-old-owner' }, loading: false, tokenExpired: false };
  const view = render(<TronClassWorkspaceScreen />);
  expect(view.getByText('請先確認 nuni 登入')).toBeTruthy();
  expect(mockBffRequest).not.toHaveBeenCalled();
});
it.each([studentKey, 'f'.repeat(64)])(
  'restores text and temporary files only for the same verified school fingerprint after reconnect: %s',
  async (key) => {
    const view = render(<TronClassWorkspaceScreen />);
    await openAssignment(view);
    mockDocument.mockResolvedValueOnce({
      canceled: false,
      assets: [
        {
          name: '答案.pdf',
          uri: 'file:///cache/picked-answer.pdf',
          size: 3,
          mimeType: 'application/pdf',
        },
      ],
    });
    fireEvent.press(view.getByRole('button', { name: '選擇作業附件' }));
    await view.findByText('答案.pdf · 3 B');
    fireEvent.changeText(view.getByLabelText('作業內容'), '待恢復草稿');
    mockBffRequest.mockImplementationOnce(async () => {
      throw new NuniError(401, 'TRONCLASS_RECONNECT_REQUIRED');
    });
    fireEvent.press(view.getByRole('button', { name: '預覽並重新核對' }));
    await view.findByText('本頁草稿等待恢復');
    mockConnection = { ...connection, connected: false, studentKey: null };
    fireEvent.press(view.getByRole('button', { name: '重新讀取連接狀態' }));
    await view.findByLabelText('TronClass 密碼');
    mockConnection = { ...connection, revision: nextRevision, studentKey: key };
    mockSnapshot = { ...snapshot, revision: nextRevision };
    mockPreparation = { ...preparation, revision: nextRevision };
    fireEvent.changeText(view.getByLabelText('TronClass 密碼'), 'private-password');
    fireEvent.press(view.getByRole('button', { name: '驗證並連接 TronClass' }));
    await openAssignment(view);
    expect(view.getByLabelText('作業內容').props.value).toBe(
      key === studentKey ? '待恢復草稿' : '',
    );
    expect(!!view.queryByText('答案.pdf · 3 B')).toBe(key === studentKey);
    expect([...fileBytes.keys()].some((uri) => uri.endsWith('.draft'))).toBe(key === studentKey);
    expect(actions('submit')).toHaveLength(0);
    expect(mockUpload).not.toHaveBeenCalled();
    expect(view.queryByDisplayValue('private-password')).toBeNull();
  },
);
it('clears local content before an explicit unlink even when the unlink reply is lost', async () => {
  const view = render(<TronClassWorkspaceScreen />);
  await openAssignment(view);
  fireEvent.changeText(view.getByLabelText('作業內容'), '不應保留');
  fireEvent.press(view.getByRole('button', { name: '解除 TronClass 連接' }));
  mockBffRequest.mockImplementationOnce(async () => {
    throw new NuniError(0, 'NETWORK_ERROR');
  });
  fireEvent.press(view.getByRole('button', { name: '確認解除連接並清除草稿' }));
  await view.findByText('目前無法連線，請確認網路後重試。 請讀取狀態，確認是否已解除。');
  expect(view.queryByDisplayValue('不應保留')).toBeNull();
  expect(view.queryByText('本頁草稿等待恢復')).toBeNull();
  expect(actions('disconnect')).toHaveLength(1);
});

const material = {
  id: 30,
  courseId: 10,
  courseName: '程式設計',
  title: '第一週講義',
  type: 'document',
  href: 'https://tronclass.pu.edu.tw/course/10/content#/material/30',
  files: [
    {
      name: '講義.pdf',
      allowDownload: true,
      downloadHref: 'https://tronclass.pu.edu.tw/api/uploads/material-key/blob',
    },
  ],
};

it('downloads a permitted submission-history attachment through the private native capability and clears its share copy', async () => {
  mockPreparation = { ...preparation, history: submissionHistory };
  const view = render(<TronClassWorkspaceScreen />);
  await openAssignment(view);
  fireEvent.press(view.getByRole('button', { name: '下載並分享作業附件：先前答案.pdf' }));
  await waitFor(() => expect(mockShare).toHaveBeenCalledTimes(1));
  expect(mockSubmissionDownload).toHaveBeenCalledWith({
    courseId: 10, homeworkId: 20, submissionId: '30', uploadId: 50, revision,
  }, 'context-a', expect.any(AbortSignal));
  const sharedUri = mockShare.mock.calls[0][0];
  await waitFor(() => expect(fileBytes.has(sharedUri)).toBe(false));
  expect(deleted).toContain(sharedUri);
  expect(view.getByText('目前清單狀態：尚未確認')).toBeTruthy();
  expect(actions('submit')).toHaveLength(0);
  expect(actions('reconcile')).toHaveLength(0);
  expect(mockDownload).not.toHaveBeenCalled();
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});

it.each(['no-descriptor', 'no-capability'] as const)('keeps history attachment names readable without a %s download', async (condition) => {
  mockSubmissionDownloadEnabled = condition !== 'no-capability';
  mockPreparation = { ...preparation, history: condition === 'no-descriptor' ? {
    ...submissionHistory,
    entries: [{ ...submissionHistory.entries[0], attachments: [{ name: '先前答案.pdf', size: 3 }] }],
  } : submissionHistory };
  const view = render(<TronClassWorkspaceScreen />);
  await openAssignment(view);
  expect(view.getByText('先前答案.pdf · 3 B')).toBeTruthy();
  expect(view.queryByRole('button', { name: '下載並分享作業附件：先前答案.pdf' })).toBeNull();
  expect(mockSubmissionDownload).not.toHaveBeenCalled();
});

it('keeps a denied history download out of the native share sheet without altering the pending operation', async () => {
  mockPreparation = { ...preparation, history: submissionHistory };
  mockSubmissionDownload.mockRejectedValueOnce(new NuniError(403, 'TRONCLASS_SUBMISSION_ATTACHMENT_DENIED'));
  await saveNativeTronClassPending(`platform:${accountA}`, 10, 20, operationId);
  const view = render(<TronClassWorkspaceScreen />);
  fireEvent.press(await view.findByRole('button', { name: homework.title }));
  const download = await view.findByRole('button', { name: '下載並分享作業附件：先前答案.pdf' });
  await waitFor(() => expect(download).not.toBeDisabled());
  fireEvent.press(download);
  await view.findByText('校方尚未允許下載這份作業附件，請重新讀取作業紀錄。');
  expect(mockShare).not.toHaveBeenCalled();
  expect(await readNativeTronClassPending(`platform:${accountA}`, 10, 20)).toBe(operationId);
  expect(actions('submit')).toHaveLength(0);
  expect(actions('reconcile')).toHaveLength(1);
  expect(view.getByText('前次送出結果待確認')).toBeTruthy();
});

it.each(['owner-change', 'unmount'] as const)('cancels a history download on %s and drops late bytes before sharing', async (change) => {
  mockPreparation = { ...preparation, history: submissionHistory };
  let finish: (value: unknown) => void = () => undefined;
  mockSubmissionDownload.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const view = render(<TronClassWorkspaceScreen />);
  await openAssignment(view);
  fireEvent.press(view.getByRole('button', { name: '下載並分享作業附件：先前答案.pdf' }));
  await waitFor(() => expect(mockSubmissionDownload).toHaveBeenCalledTimes(1));
  const signal = mockSubmissionDownload.mock.calls[0][2] as AbortSignal;
  if (change === 'owner-change') {
    mockAuth = { ...mockAuth, session: { platformAccountId: accountB, context: 'context-b' } };
    mockConnection = { ...disconnected };
    view.rerender(<TronClassWorkspaceScreen />);
    await view.findByLabelText('TronClass 帳號');
  } else view.unmount();
  expect(signal.aborted).toBe(true);
  await act(async () => finish({ bytes: new Uint8Array([4, 5, 6]), filename: '先前答案.pdf', contentType: 'application/pdf' }));
  expect(mockShare).not.toHaveBeenCalled();
  expect([...fileBytes.keys()].some((uri) => uri.includes('nuni-tronclass-'))).toBe(false);
  expect(actions('submit')).toHaveLength(0);
});

it('does not share a history attachment when the school binding expires before sharing becomes available', async () => {
  mockPreparation = { ...preparation, history: submissionHistory };
  mockConnection = { ...connection, expiresAt: '2026-11-18T10:00:01.000Z' };
  let available: (value: boolean) => void = () => undefined;
  mockSharingAvailable.mockImplementationOnce(() => new Promise((resolve) => { available = resolve; }));
  const view = render(<TronClassWorkspaceScreen />);
  await openAssignment(view);
  fireEvent.press(view.getByRole('button', { name: '下載並分享作業附件：先前答案.pdf' }));
  await waitFor(() => expect(mockSharingAvailable).toHaveBeenCalledTimes(1));
  jest.mocked(Date.now).mockReturnValue(Date.parse('2026-11-18T10:00:02.000Z'));
  await act(async () => available(true));
  await view.findByText('TronClass 登入已到期，請重新連接。');
  expect(mockShare).not.toHaveBeenCalled();
  expect([...fileBytes.keys()].some((uri) => uri.includes('nuni-tronclass-'))).toBe(false);
});

it('requests the selected course explicitly and downloads its authorized material through the native BFF', async () => {
  mockBffRequest.mockImplementation((path, context, input) =>
    input.action === 'sync' && input.courseId === 10
      ? Promise.resolve({ ...snapshot, materials: [material] })
      : defaultRequest(path, context, input),
  );
  const view = render(<TronClassWorkspaceScreen />);
  fireEvent.press(await view.findByRole('button', { name: '程式設計' }));
  fireEvent.press(await view.findByRole('button', { name: '下載並分享：講義.pdf' }));
  await waitFor(() => expect(mockShare).toHaveBeenCalledTimes(1));
  expect(actions('sync').map((input) => input.courseId)).toEqual([undefined, 10]);
  expect(mockDownload).toHaveBeenCalledWith(
    { courseId: 10, activityId: 30, uploadKey: 'material-key', revision },
    'context-a',
  );
  const sharedUri = mockShare.mock.calls[0][0];
  await waitFor(() => expect(fileBytes.has(sharedUri)).toBe(false));
  expect(deleted).toContain(sharedUri);
});
it('does not expose a revoked material download even when its source URL is present', async () => {
  mockBffRequest.mockImplementation((path, context, input) =>
    input.action === 'sync' && input.courseId === 10
      ? Promise.resolve({
          ...snapshot,
          materials: [{ ...material, files: [{ ...material.files[0], allowDownload: false }] }],
        })
      : defaultRequest(path, context, input),
  );
  const view = render(<TronClassWorkspaceScreen />);
  fireEvent.press(await view.findByRole('button', { name: '程式設計' }));
  await view.findByText('講義.pdf（校方未開放下載）');
  expect(view.queryByRole('button', { name: '下載並分享：講義.pdf' })).toBeNull();
  expect(mockDownload).not.toHaveBeenCalled();
});
it('keeps the latest selected course when an earlier course read finishes later', async () => {
  const courses = [...snapshot.courses, { ...snapshot.courses[0], id: 11, name: '資料庫' }];
  mockSnapshot = { ...snapshot, courses };
  let resolveFirst: (value: unknown) => void = () => undefined;
  mockBffRequest.mockImplementation((path, context, input) => {
    if (input.action === 'sync' && input.courseId === 10)
      return new Promise((resolve) => {
        resolveFirst = resolve;
      });
    if (input.action === 'sync' && input.courseId === 11)
      return Promise.resolve({
        ...snapshot,
        courses,
        homework: [{ ...homework, courseId: 11, courseName: '資料庫', title: '資料庫作業' }],
      });
    return defaultRequest(path, context, input);
  });
  const view = render(<TronClassWorkspaceScreen />);
  fireEvent.press(await view.findByRole('button', { name: '程式設計' }));
  expect(view.queryByRole('button', { name: homework.title })).toBeNull();
  fireEvent.press(view.getByRole('button', { name: '資料庫' }));
  await view.findByRole('button', { name: '資料庫作業' });
  await act(async () => {
    resolveFirst({ ...snapshot, courses });
  });
  expect(view.getByRole('button', { name: '資料庫作業' })).toBeTruthy();
  expect(view.queryByRole('button', { name: homework.title })).toBeNull();
});
it('retries a partial course read with the same explicit course ID', async () => {
  let failed = false;
  mockBffRequest.mockImplementation((path, context, input) => {
    if (input.action === 'sync' && input.courseId === 10) {
      if (!failed) {
        failed = true;
        return Promise.reject(new NuniError(0, 'NETWORK_ERROR'));
      }
      return Promise.resolve({ ...snapshot, materials: [material] });
    }
    return defaultRequest(path, context, input);
  });
  const view = render(<TronClassWorkspaceScreen />);
  fireEvent.press(await view.findByRole('button', { name: '程式設計' }));
  fireEvent.press(await view.findByRole('button', { name: '重試讀取課務' }));
  await view.findByRole('button', { name: '下載並分享：講義.pdf' });
  expect(actions('sync').map((input) => input.courseId)).toEqual([undefined, 10, 10]);
  expect(view.queryByText('部分資料尚未讀取完成')).toBeNull();
});
it('discards a delayed download when the owner changes before any native share is opened', async () => {
  mockSnapshot = { ...snapshot, materials: [material] };
  let resolveDownload: (value: unknown) => void = () => undefined;
  mockDownload.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveDownload = resolve;
      }),
  );
  const view = render(<TronClassWorkspaceScreen />);
  fireEvent.press(await view.findByRole('button', { name: '下載並分享：講義.pdf' }));
  mockAuth = { ...mockAuth, session: { platformAccountId: accountB, context: 'context-b' } };
  mockConnection = { ...disconnected };
  view.rerender(<TronClassWorkspaceScreen />);
  await act(async () => {
    resolveDownload({
      bytes: new Uint8Array([5]),
      filename: '講義.pdf',
      contentType: 'application/pdf',
    });
  });
  expect(mockShare).not.toHaveBeenCalled();
});
it('does not share downloaded bytes after the school session expires while the native sharing capability is pending', async () => {
  mockSnapshot = { ...snapshot, materials: [material] };
  mockConnection = { ...connection, expiresAt: '2026-11-18T10:00:01.000Z' };
  let available: (value: boolean) => void = () => undefined;
  mockSharingAvailable.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        available = resolve;
      }),
  );
  const view = render(<TronClassWorkspaceScreen />);
  fireEvent.press(await view.findByRole('button', { name: '下載並分享：講義.pdf' }));
  await waitFor(() => expect(mockSharingAvailable).toHaveBeenCalledTimes(1));
  jest.mocked(Date.now).mockReturnValue(Date.parse('2026-11-18T10:00:02.000Z'));
  await act(async () => {
    available(true);
  });
  expect(mockShare).not.toHaveBeenCalled();
  await view.findByText('TronClass 登入已到期，請重新連接。');
  expect([...fileBytes.keys()].some((uri) => uri.includes('nuni-tronclass-'))).toBe(false);
});
it('refuses an already expired binding before dispatching a material download', async () => {
  mockSnapshot = { ...snapshot, materials: [material] };
  mockConnection = { ...connection, expiresAt: '2026-11-18T09:59:59.000Z' };
  const view = render(<TronClassWorkspaceScreen />);
  fireEvent.press(await view.findByRole('button', { name: '下載並分享：講義.pdf' }));
  await view.findByText('TronClass 登入已到期，請重新連接。');
  expect(mockDownload).not.toHaveBeenCalled();
});
it('purges abandoned attachment copies when a verified owner merely opens the workspace', async () => {
  directories.add('file:///cache/nuni-tronclass-abandoned');
  fileBytes.set('file:///cache/nuni-tronclass-abandoned/old.draft', new Uint8Array([1]));
  const view = render(<TronClassWorkspaceScreen />);
  await view.findByRole('button', { name: homework.title });
  expect(fileBytes.has('file:///cache/nuni-tronclass-abandoned/old.draft')).toBe(false);
  expect(mockDocument).not.toHaveBeenCalled();
  expect(mockDownload).not.toHaveBeenCalled();
});
it('removes picked cache copies on removal and never leaves a late picker result after an owner switch', async () => {
  const asset = {
    name: '答案.pdf',
    uri: 'file:///cache/picked-answer.pdf',
    size: 3,
    mimeType: 'application/pdf',
  };
  mockDocument.mockResolvedValueOnce({ canceled: false, assets: [asset] });
  const view = render(<TronClassWorkspaceScreen />);
  await openAssignment(view);
  fireEvent.press(view.getByRole('button', { name: '選擇作業附件' }));
  await view.findByText('答案.pdf · 3 B');
  expect(fileBytes.has(asset.uri)).toBe(false);
  expect([...fileBytes.keys()].some((uri) => uri.endsWith('.draft'))).toBe(true);
  fireEvent.press(view.getByRole('button', { name: '移除 答案.pdf' }));
  expect([...fileBytes.keys()].some((uri) => uri.endsWith('.draft'))).toBe(false);
  let resolvePicker: (value: unknown) => void = () => undefined;
  mockDocument.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolvePicker = resolve;
      }),
  );
  fireEvent.press(view.getByRole('button', { name: '選擇作業附件' }));
  mockAuth = { ...mockAuth, session: { platformAccountId: accountB, context: 'context-b' } };
  mockConnection = { ...disconnected };
  view.rerender(<TronClassWorkspaceScreen />);
  fileBytes.set(asset.uri, new Uint8Array([1, 2, 3]));
  await act(async () => {
    resolvePicker({ canceled: false, assets: [asset] });
  });
  expect(fileBytes.has(asset.uri)).toBe(false);
});

it('keeps text and attachment copies when returning to the list and revalidates before restoring them', async () => {
  mockPreparation = { ...preparation, canSubmit: true, blockedReason: null };
  mockDocument.mockResolvedValue({ canceled: false, assets: [{ name: '保留的作業.pdf',
    uri: 'file:///cache/picked-answer.pdf', size: 3, mimeType: 'application/pdf' }] });
  const view = render(<TronClassWorkspaceScreen />);
  await openAssignment(view);
  fireEvent.press(view.getByRole('button', { name: '選擇作業附件' }));
  await view.findByText('保留的作業.pdf · 3 B');
  await previewDraft(view, '稍後繼續的文字');
  fireEvent(view.getByLabelText('我已確認要把這份作業送至校方'), 'valueChange', true);
  fireEvent.press(view.getByRole('button', { name: '返回作業清單' }));
  expect(view.queryByText('稍後繼續的文字')).toBeNull();
  expect([...fileBytes.keys()].filter((uri) => uri.endsWith('.draft'))).toHaveLength(1);
  let resolvePrepare!: (value: unknown) => void;
  const pendingPrepare = new Promise((resolve) => { resolvePrepare = resolve; });
  mockBffRequest.mockImplementation((path, context, input) => input.action === 'prepare'
    ? pendingPrepare : defaultRequest(path, context, input));
  fireEvent.press(view.getByRole('button', { name: '恢復本頁作業草稿' }));
  expect(view.queryByDisplayValue('稍後繼續的文字')).toBeNull();
  expect(view.queryByText('保留的作業.pdf · 3 B')).toBeNull();
  await act(async () => resolvePrepare(mockPreparation));
  await view.findByDisplayValue('稍後繼續的文字');
  expect(view.getByText('保留的作業.pdf · 3 B')).toBeTruthy();
  mockBffRequest.mockImplementation(defaultRequest);
  fireEvent.press(view.getByRole('button', { name: '預覽並重新核對' }));
  await view.findByText('確認這次作業內容');
  expect(view.getByLabelText('我已確認要把這份作業送至校方').props.value).toBe(false);
  expect(actions('submit')).toHaveLength(0);
  expect(mockUpload).not.toHaveBeenCalled();
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});

it('preserves another assignment draft and its files when the current draft is discarded', async () => {
  const second = { ...homework, id: 21, title: '第二份作業' };
  mockSnapshot = { ...snapshot, homework: [homework, second] };
  mockBffRequest.mockImplementation((path, context, input) => input.action === 'prepare'
    ? Promise.resolve({ ...mockPreparation, homeworkId: input.homeworkId, title: input.homeworkId === second.id ? second.title : homework.title })
    : defaultRequest(path, context, input));
  mockDocument.mockResolvedValue({ canceled: false, assets: [{ name: '第一份的附件.pdf',
    uri: 'file:///cache/picked-answer.pdf', size: 3, mimeType: 'application/pdf' }] });
  const view = render(<TronClassWorkspaceScreen />);
  await openAssignment(view);
  fireEvent.changeText(view.getByLabelText('作業內容'), '第一份文字');
  fireEvent.press(view.getByRole('button', { name: '選擇作業附件' }));
  await view.findByText('第一份的附件.pdf · 3 B');
  fireEvent.press(view.getByRole('button', { name: '返回作業清單' }));
  fireEvent.press(view.getByRole('button', { name: second.title }));
  await waitFor(() => expect(view.getByRole('button', { name: '預覽並重新核對' })).not.toBeDisabled());
  fireEvent.changeText(view.getByLabelText('作業內容'), '第二份文字');
  fireEvent.press(view.getByRole('button', { name: '返回作業清單' }));
  expect(view.getByRole('button', { name: '繼續編輯 期中作業' })).toBeTruthy();
  expect(view.getByRole('button', { name: '繼續編輯 第二份作業' })).toBeTruthy();
  fireEvent.press(view.getByRole('button', { name: '丟棄 第二份作業 的草稿' }));
  expect([...fileBytes.keys()].filter((uri) => uri.endsWith('.draft'))).toHaveLength(1);
  fireEvent.press(view.getByRole('button', { name: '恢復本頁作業草稿' }));
  await view.findByDisplayValue('第一份文字');
  expect(view.getByText('第一份的附件.pdf · 3 B')).toBeTruthy();
  fireEvent.press(view.getByRole('button', { name: '丟棄本頁草稿' }));
  expect([...fileBytes.keys()].filter((uri) => uri.endsWith('.draft'))).toHaveLength(0);
  fireEvent.press(view.getByRole('button', { name: '返回作業清單' }));
  expect(view.queryByRole('button', { name: '恢復本頁作業草稿' })).toBeNull();
});

it('allows a single-course read from the directory before the full coursework request finishes', async () => {
  let resolveFull!: (value: unknown) => void;
  const pendingFull = new Promise((resolve) => { resolveFull = resolve; });
  mockBffRequest.mockImplementation((path, context, input) => {
    if (input.action === 'sync' && input.courseId === undefined) return pendingFull;
    if (input.action === 'sync' && input.courseId === 10) return Promise.resolve({ ...snapshot,
      homework: [{ ...homework, title: '單課先讀到的作業' }] });
    return defaultRequest(path, context, input);
  });
  const view = render(<TronClassWorkspaceScreen />);
  fireEvent.press(await view.findByRole('button', { name: '程式設計' }));
  await view.findByRole('button', { name: '單課先讀到的作業' });
  await act(async () => resolveFull({ ...snapshot, homework: [{ ...homework, title: '晚到的全量結果' }] }));
  expect(view.queryByRole('button', { name: '晚到的全量結果' })).toBeNull();
  expect(actions('sync').map((value) => value.courseId)).toEqual([undefined, 10]);
});

it('keeps the course picker after the first full sync fails without reporting an empty assignment list', async () => {
  mockBffRequest.mockImplementation((path, context, input) => input.action === 'sync' && input.courseId === undefined
    ? Promise.reject(new NuniError(504, 'TRONCLASS_TIMEOUT')) : defaultRequest(path, context, input));
  const view = render(<TronClassWorkspaceScreen />);
  await view.findByText('課程清單已載入。請選一門課讀取作業、公告與教材，或重新整理。');
  expect(view.queryByText('目前沒有符合條件的作業。')).toBeNull();
  fireEvent.press(view.getByRole('button', { name: '程式設計' }));
  await view.findByRole('button', { name: homework.title });
  expect(actions('sync').map((value) => value.courseId)).toEqual([undefined, 10]);
});

it('refreshes changed course choices from a newer sync without letting a late initial index restore removed courses', async () => {
  const initialSnapshot = { ...snapshot, courses: [snapshot.courses[0], { ...snapshot.courses[0], id: 11, name: '即將移除的課程' }] };
  mockSnapshot = initialSnapshot;
  let resolveIndex!: (value: unknown) => void;
  const oldIndex = new Promise((resolve) => { resolveIndex = resolve; });
  mockBffRequest.mockImplementation((path, context, input) => input.action === 'courses'
    ? oldIndex : defaultRequest(path, context, input));
  const view = render(<TronClassWorkspaceScreen />);
  await view.findByRole('button', { name: '即將移除的課程' });
  mockSnapshot = { ...snapshot, courses: [snapshot.courses[0], { ...snapshot.courses[0], id: 12, name: '新增課程' }] };
  fireEvent.press(view.getByRole('button', { name: '程式設計' }));
  await view.findByRole('button', { name: '新增課程' });
  expect(view.queryByRole('button', { name: '即將移除的課程' })).toBeNull();
  await act(async () => resolveIndex({ kind: 'course-index', revision, fetchedAt: snapshot.fetchedAt,
    courses: initialSnapshot.courses.map((course) => ({ ...course, href: `https://tronclass.pu.edu.tw/course/${course.id}/content` })),
    errors: [], partial: false }));
  expect(view.getByRole('button', { name: '新增課程' })).toBeTruthy();
  expect(view.queryByRole('button', { name: '即將移除的課程' })).toBeNull();
});

it('rejects a file selection in a second draft without deleting the first draft attachment', async () => {
  const second = { ...homework, id: 21, title: '第二份作業' };
  mockSnapshot = { ...snapshot, homework: [homework, second] };
  mockPreparation = { ...preparation, allowedContentTypes: ['application/pdf'] };
  mockBffRequest.mockImplementation((path, context, input) => input.action === 'prepare'
    ? Promise.resolve({ ...mockPreparation, homeworkId: input.homeworkId, title: input.homeworkId === second.id ? second.title : homework.title })
    : defaultRequest(path, context, input));
  mockDocument.mockResolvedValueOnce({ canceled: false, assets: [{ name: '不能丟失的附件.pdf',
    uri: 'file:///cache/picked-answer.pdf', size: 3, mimeType: 'application/pdf' }] });
  const view = render(<TronClassWorkspaceScreen />);
  await openAssignment(view);
  fireEvent.press(view.getByRole('button', { name: '選擇作業附件' }));
  await view.findByText('不能丟失的附件.pdf · 3 B');
  const firstCopy = [...fileBytes.keys()].find((uri) => uri.endsWith('.draft'))!;
  fireEvent.press(view.getByRole('button', { name: '返回作業清單' }));
  fireEvent.press(view.getByRole('button', { name: second.title }));
  await waitFor(() => expect(view.getByRole('button', { name: '預覽並重新核對' })).not.toBeDisabled());
  fileBytes.set('file:///cache/not-accepted.txt', new Uint8Array([4, 5]));
  mockDocument.mockResolvedValueOnce({ canceled: false, assets: [{ name: '不支援.txt',
    uri: 'file:///cache/not-accepted.txt', size: 2, mimeType: 'text/plain' }] });
  fireEvent.press(view.getByRole('button', { name: '選擇作業附件' }));
  await view.findByText('其中有目前無法在 nuni 繳交的附件格式，請重新選檔或至 TronClass 處理。');
  expect(fileBytes.has(firstCopy)).toBe(true);
  expect([...fileBytes.keys()].filter((uri) => uri.endsWith('.draft'))).toEqual([firstCopy]);
  fireEvent.press(view.getByRole('button', { name: '返回作業清單' }));
  fireEvent.press(view.getByRole('button', { name: '恢復本頁作業草稿' }));
  await view.findByText('不能丟失的附件.pdf · 3 B');
  fireEvent.press(view.getByRole('button', { name: '預覽並重新核對' }));
  await view.findByText('確認這次作業內容');
  expect(mockUpload).not.toHaveBeenCalled();
});

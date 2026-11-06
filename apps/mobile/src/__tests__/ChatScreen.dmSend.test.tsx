import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import {
  clearOutboundDraftsForUser,
  clearOutboundPreviewsForUser,
  readOutboundDrafts,
  writeOutboundDrafts,
  type DmOutboundDraft,
} from '../screens/messagingInboxModel';

import * as Photos from '../services/dmPhotos';
import * as ImagePicker from 'expo-image-picker';

const mockSend = jest.fn();
let mockViewer = 'alice';
let mockSchool = 'pu';
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'photo_message_00000001' }));
jest.mock('../services/dmPhotos', () => ({
  ...jest.requireActual('../services/dmPhotos'),
  localPhoto: jest.fn(),
  uploadDmPhoto: jest.fn(),
  confirmDmPhoto: jest.fn(),
  openDmPhoto: jest.fn(),
}));
const mockSnapshotHandlers = new Map();
let mockMessagesSnapshotOptions: { includeMetadataChanges?: boolean } | null = null;

jest.mock('../state/auth', () => ({
  useAuth: () => ({ user: { uid: mockViewer } }),
}));
jest.mock('../state/school', () => ({
  useSchool: () => ({ school: { id: mockSchool } }),
}));
jest.mock('../ui/useThemeStyleSheet', () => {
  const cache = new Map();
  return {
    useThemeStyleSheet: (factory: () => unknown) => {
      if (!cache.has(factory)) cache.set(factory, factory());
      return cache.get(factory);
    },
  };
});
jest.mock('../ui/components', () => {
  const ReactNative = require('react-native');
  return {
    Screen: ({ children }: { children: React.ReactNode }) => (
      <ReactNative.View>{children}</ReactNative.View>
    ),
    ErrorState: ({ title }: { title: string }) => (
      <ReactNative.Text>{title}</ReactNative.Text>
    ),
  };
});
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../services/demoSession', () => ({
  shouldBlockForNoLogin: () => false,
  isDemoUid: () => false,
}));
jest.mock('../data/demoPersona', () => ({
  getPersona: () => null,
  getPersonaConversationDetail: () => null,
  getPersonaConversations: () => [],
  isDemoPersonaUid: () => false,
}));
jest.mock('../services/memberDirectory', () => ({
  fetchSchoolDirectoryProfiles: jest.fn(async () => [{ displayName: '小明' }]),
}));
jest.mock('../services/messaging', () => ({
  newChatMessageId: () => 'fixed-msg-1',
  sendChatMessageIdempotent: (...args: unknown[]) => mockSend(...args),
  recallChatMessage: jest.fn(),
  toggleMessageReaction: jest.fn(),
}));
const mockDb = {};
jest.mock('../firebase', () => ({
  getDb: () => mockDb,
  isFirebaseMockMode: () => false,
}));
jest.mock('firebase/firestore', () => ({
  arrayUnion: jest.fn((v: string) => v),
  collection: (_db: unknown, ...parts: string[]) => ({ path: parts.join('/') }),
  doc: jest.fn((_db: unknown, ...parts: string[]) => ({ path: parts.join('/') })),
  getDoc: jest.fn(async () => ({
    exists: () => true,
    data: () => ({
      type: 'dm',
      schoolId: 'pu',
      memberIds: ['alice', 'bob'],
    }),
  })),
  setDoc: jest.fn(),
  onSnapshot: (qy: { path?: string }, optionsOrNext: any, maybeNext?: any) => {
    const path = qy?.path ?? '';
    if (typeof optionsOrNext === 'function') {
      mockSnapshotHandlers.set(path, optionsOrNext);
      return () => undefined;
    }
    if (path.includes('/messages')) {
      mockMessagesSnapshotOptions = optionsOrNext;
    }
    mockSnapshotHandlers.set(path, maybeNext);
    return () => undefined;
  },
  orderBy: jest.fn(),
  query: (ref: { path: string }) => ref,
  serverTimestamp: jest.fn(),
  updateDoc: jest.fn(async () => undefined),
  limit: jest.fn(),
  Timestamp: {},
}));

import { ChatScreen } from '../screens/ChatScreen';

function emitMessages(
  docs: Array<{ id: string; data: Record<string, unknown>; hasPendingWrites?: boolean }>,
) {
  const handler = [...mockSnapshotHandlers.entries()].find(([path]) =>
    path.includes('/messages'),
  )?.[1];
  if (!handler) throw new Error('missing messages snapshot handler');
  handler({
    docs: docs.map((row) => ({
      id: row.id,
      data: () => row.data,
      metadata: { hasPendingWrites: Boolean(row.hasPendingWrites) },
    })),
  });
}

beforeEach(() => {
  mockViewer = 'alice';
  mockSchool = 'pu';
  mockSend.mockReset();
  mockSend.mockResolvedValue({ id: 'fixed-msg-1', replayed: false });
  mockSnapshotHandlers.clear();
  mockMessagesSnapshotOptions = null;
  clearOutboundDraftsForUser(null);
  clearOutboundPreviewsForUser(null);
});

test('pending writes do not mark a message as delivered and keep retryable outbound', async () => {
  mockSend.mockImplementation(() => new Promise(() => {}));
  const view = render(
    <ChatScreen
      route={{ params: { conversationId: 'dm_pu_alice_bob', peerId: 'bob' } }}
      navigation={{ setOptions: jest.fn() }}
    />,
  );

  await waitFor(() =>
    expect(mockMessagesSnapshotOptions).toEqual({ includeMetadataChanges: true }),
  );
  await act(async () => emitMessages([]));

  fireEvent.changeText(view.getByPlaceholderText('輸入訊息...'), '弱網測試');
  await act(async () => {
    fireEvent.press(view.getByLabelText('傳送訊息'));
  });

  await waitFor(() => expect(view.getByText('送出中')).toBeTruthy());

  await act(async () =>
    emitMessages([
      {
        id: 'fixed-msg-1',
        data: { senderId: 'alice', content: '弱網測試', readBy: ['alice'] },
        hasPendingWrites: true,
      },
    ]),
  );

  expect(view.getByText('送出中')).toBeTruthy();
  expect(view.queryByText('已送達')).toBeNull();
  expect(view.queryByLabelText('重試送出此則訊息')).toBeNull();
});

test('leaving and re-entering restores outbound status, retry, and failed draft text', async () => {
  const draft: DmOutboundDraft = {
    id: 'retry-keep-1',
    conversationId: 'dm_pu_alice_bob',
    senderId: 'alice',
    content: '離開前失敗的內容',
    status: 'failed',
    createdAtMs: 100,
  };
  writeOutboundDrafts('dm_pu_alice_bob', [draft]);

  const first = render(
    <ChatScreen
      route={{ params: { conversationId: 'dm_pu_alice_bob', peerId: 'bob' } }}
      navigation={{ setOptions: jest.fn() }}
    />,
  );
  await act(async () => emitMessages([]));
  expect(first.getByText('送出失敗')).toBeTruthy();
  expect(first.getByLabelText('重試送出此則訊息')).toBeTruthy();
  expect(first.getByDisplayValue('離開前失敗的內容')).toBeTruthy();
  first.unmount();

  const second = render(
    <ChatScreen
      route={{ params: { conversationId: 'dm_pu_alice_bob', peerId: 'bob' } }}
      navigation={{ setOptions: jest.fn() }}
    />,
  );
  await act(async () => emitMessages([]));
  expect(second.getByText('送出失敗')).toBeTruthy();
  expect(second.getByLabelText('重試送出此則訊息')).toBeTruthy();
  expect(second.getByDisplayValue('離開前失敗的內容')).toBeTruthy();
});

test('confirmed server snapshot shows delivered and drops local status', async () => {
  const view = render(
    <ChatScreen
      route={{ params: { conversationId: 'dm_pu_alice_bob', peerId: 'bob' } }}
      navigation={{ setOptions: jest.fn() }}
    />,
  );
  await act(async () => emitMessages([]));

  fireEvent.changeText(view.getByPlaceholderText('輸入訊息...'), '確認送達');
  await act(async () => {
    fireEvent.press(view.getByLabelText('傳送訊息'));
  });

  await waitFor(() => expect(mockSend).toHaveBeenCalled());
  await waitFor(() => expect(view.getByText('送出中')).toBeTruthy());

  await act(async () =>
    emitMessages([
      {
        id: 'fixed-msg-1',
        data: {
          senderId: 'alice',
          content: '確認送達',
          readBy: ['alice'],
          createdAt: { seconds: 1_800_000_100 },
        },
        hasPendingWrites: false,
      },
    ]),
  );

  await waitFor(() => expect(view.getByText('已送達')).toBeTruthy());
  expect(view.queryByText('送出中')).toBeNull();
  expect(view.queryByLabelText('重試送出此則訊息')).toBeNull();
  expect(readOutboundDrafts('dm_pu_alice_bob', 'alice')).toEqual([]);
});

test('retry button resends the same message id', async () => {
  const draft: DmOutboundDraft = {
    id: 'retry-same-id',
    conversationId: 'dm_pu_alice_bob',
    senderId: 'alice',
    content: '同一則重試',
    status: 'failed',
    createdAtMs: 50,
  };
  writeOutboundDrafts('dm_pu_alice_bob', [draft]);

  const view = render(
    <ChatScreen
      route={{ params: { conversationId: 'dm_pu_alice_bob', peerId: 'bob' } }}
      navigation={{ setOptions: jest.fn() }}
    />,
  );
  await act(async () => emitMessages([]));
  expect(view.getByLabelText('重試送出此則訊息')).toBeTruthy();

  mockSend.mockClear();
  mockSend.mockResolvedValue({ id: 'retry-same-id', replayed: true });
  await act(async () => {
    fireEvent.press(view.getByLabelText('重試送出此則訊息'));
  });

  await waitFor(() =>
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'dm_pu_alice_bob',
        messageId: 'retry-same-id',
        content: '同一則重試',
      }),
    ),
  );
  expect(mockSend).toHaveBeenCalledTimes(1);
});

test('send with failed draft text retries existing id instead of creating a new message', async () => {
  const draft: DmOutboundDraft = {
    id: 'reuse-on-send',
    conversationId: 'dm_pu_alice_bob',
    senderId: 'alice',
    content: '失敗原文',
    status: 'failed',
    createdAtMs: 70,
  };
  writeOutboundDrafts('dm_pu_alice_bob', [draft]);

  const view = render(
    <ChatScreen
      route={{ params: { conversationId: 'dm_pu_alice_bob', peerId: 'bob' } }}
      navigation={{ setOptions: jest.fn() }}
    />,
  );
  await act(async () => emitMessages([]));
  expect(view.getByDisplayValue('失敗原文')).toBeTruthy();

  mockSend.mockClear();
  mockSend.mockResolvedValue({ id: 'reuse-on-send', replayed: true });
  await act(async () => {
    fireEvent.press(view.getByLabelText('傳送訊息'));
  });

  await waitFor(() =>
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: 'reuse-on-send',
        content: '失敗原文',
      }),
    ),
  );
  expect(mockSend).toHaveBeenCalledTimes(1);
  expect(mockSend).not.toHaveBeenCalledWith(
    expect.objectContaining({ messageId: 'fixed-msg-1' }),
  );
});

test('failure after unmount persists failed draft for later retry', async () => {
  let rejectSend: (error: unknown) => void = () => undefined;
  mockSend.mockImplementation(
    () =>
      new Promise((_, reject) => {
        rejectSend = reject;
      }),
  );

  const view = render(
    <ChatScreen
      route={{ params: { conversationId: 'dm_pu_alice_bob', peerId: 'bob' } }}
      navigation={{ setOptions: jest.fn() }}
    />,
  );
  await act(async () => emitMessages([]));

  fireEvent.changeText(view.getByPlaceholderText('輸入訊息...'), '離房後失敗');
  await act(async () => {
    fireEvent.press(view.getByLabelText('傳送訊息'));
  });
  await waitFor(() => expect(view.getByText('送出中')).toBeTruthy());
  expect(readOutboundDrafts('dm_pu_alice_bob', 'alice')[0]?.status).toBe('sending');

  view.unmount();

  await act(async () => {
    rejectSend({ code: 'permission-denied', message: 'denied' });
  });

  await waitFor(() => {
    const rows = readOutboundDrafts('dm_pu_alice_bob', 'alice');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 'fixed-msg-1',
      content: '離房後失敗',
      status: 'failed',
    });
  });

  const again = render(
    <ChatScreen
      route={{ params: { conversationId: 'dm_pu_alice_bob', peerId: 'bob' } }}
      navigation={{ setOptions: jest.fn() }}
    />,
  );
  await act(async () => emitMessages([]));
  expect(again.getByText('送出失敗')).toBeTruthy();
  expect(again.getByLabelText('重試送出此則訊息')).toBeTruthy();
  expect(again.getByDisplayValue('離房後失敗')).toBeTruthy();
});

test('a story reply shows only its origin label, and recall removes the label and content', async () => {
  const view = render(
    <ChatScreen
      route={{ params: { conversationId: 'dm_pu_alice_bob', peerId: 'bob' } }}
      navigation={{ setOptions: jest.fn() }}
    />,
  );
  const message = { senderId: 'bob', content: '操場見', storyReplyTo: { storyId: 's1', authorUid: 'alice' } };
  await act(async () => emitMessages([{ id: 'm1', data: message }]));
  expect(view.getByText('回覆了限時動態')).toBeTruthy();
  expect(view.getByText('操場見')).toBeTruthy();
  await act(async () => emitMessages([{ id: 'm1', data: { ...message, recalledAt: 1 } }]));
  expect(view.getByText('訊息已撤回')).toBeTruthy();
  expect(view.queryByText('回覆了限時動態')).toBeNull();
  expect(view.queryByText('操場見')).toBeNull();
});


const photoId = 'photo_message_00000001';
const photoConvo = 'dm_pu_alice_bob';
const staged = 'conversations/dm_pu_alice_bob/photos/media-1/photo.png';
const published = staged.replace('photo.png', 'sent.png');
function photoChat(conversationId = photoConvo) {
  return <ChatScreen route={{ params: { conversationId, peerId: 'bob' } }} navigation={{ setOptions: jest.fn() }} />;
}
function verifyPhotoChat(fromCache = false, hasPendingWrites = false) {
  const handler = mockSnapshotHandlers.get(`conversations/${photoConvo}`);
  act(() => handler({ exists: () => true, metadata: { fromCache, hasPendingWrites }, data: () => ({ type: 'dm', schoolId: 'pu', memberIds: ['alice', 'bob'] }) }));
}
function pickPhoto() {
  jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue({
    canceled: false, assets: [{ uri: 'file:///pick.png', mimeType: 'image/png', width: 20, height: 20 }],
  });
  jest.mocked(Photos.localPhoto).mockReturnValue({ uri: 'file:///pick.png', contentType: 'image/png', size: 10 });
}

test('local preview is removable and retries reuse one upload and the same message until acknowledged', async () => {
  pickPhoto();
  jest.mocked(Photos.uploadDmPhoto).mockReset().mockResolvedValue(staged);
  let ack!: () => void;
  jest.mocked(Photos.confirmDmPhoto).mockReset().mockRejectedValueOnce(new Error('lost receipt'))
    .mockImplementation(() => new Promise((done) => { ack = done; }));
  const view = render(photoChat());
  expect(view.queryByLabelText('加入照片')).toBeNull();
  verifyPhotoChat(true);
  expect(view.queryByLabelText('加入照片')).toBeNull();
  verifyPhotoChat(false, true);
  expect(view.queryByLabelText('加入照片')).toBeNull();
  verifyPhotoChat();
  await act(async () => fireEvent.press(view.getByLabelText('加入照片')));
  expect(view.getByLabelText('待傳送照片預覽')).toBeTruthy();
  expect(Photos.uploadDmPhoto).not.toHaveBeenCalled();
  fireEvent.press(view.getByLabelText('移除照片'));
  expect(view.queryByLabelText('待傳送照片預覽')).toBeNull();
  await act(async () => fireEvent.press(view.getByLabelText('加入照片')));
  await act(async () => fireEvent.press(view.getByText('傳送照片')));
  expect(view.getByText('尚未確認送達，照片已保留。')).toBeTruthy();
  await act(async () => fireEvent.press(view.getByText('重新傳送照片')));
  expect(view.getByText('照片傳送中…')).toBeTruthy();
  expect(view.queryByText('照片已傳送')).toBeNull();
  expect(Photos.uploadDmPhoto).toHaveBeenCalledTimes(1);
  const scope = { conversationId: photoConvo, viewerUid: 'alice', schoolId: 'pu', messageId: photoId };
  expect(jest.mocked(Photos.confirmDmPhoto).mock.calls.map(args => args.slice(0, 2))).toEqual([[scope, staged], [scope, staged]]);
  await act(async () => ack());
  expect(view.getByText('照片已傳送')).toBeTruthy();
  expect(view.queryByLabelText('待傳送照片預覽')).toBeNull();
});

test.each(['account', 'school', 'thread'])('switching %s discards a private draft and cancels a late upload', async (kind) => {
  pickPhoto();
  let uploaded!: (path: string) => void;
  jest.mocked(Photos.uploadDmPhoto).mockReset().mockImplementation(() => new Promise(done => { uploaded = done; }));
  jest.mocked(Photos.confirmDmPhoto).mockReset();
  const view = render(photoChat());
  expect(view.queryByLabelText('加入照片')).toBeNull();
  verifyPhotoChat();
  await act(async () => fireEvent.press(view.getByLabelText('加入照片')));
  await act(async () => fireEvent.press(view.getByText('傳送照片')));
  if (kind === 'account') mockViewer = 'other';
  if (kind === 'school') mockSchool = 'another';
  view.rerender(photoChat(kind === 'thread' ? 'other-thread' : photoConvo));
  await act(async () => uploaded(staged));
  expect(view.queryByLabelText('待傳送照片預覽')).toBeNull();
  expect(Photos.confirmDmPhoto).not.toHaveBeenCalled();
  expect(jest.mocked(Photos.uploadDmPhoto).mock.calls[0][2].aborted).toBe(true);
});

test('only canonical message photos open on tap, close at expiry, and disappear on recall', async () => {
  jest.useFakeTimers();
  const row = { senderId: 'bob', type: 'image', content: '照片', imageUrl: 'https://evil.invalid/token', readBy: ['alice'] };
  const view = render(photoChat());
  expect(view.queryByLabelText('加入照片')).toBeNull();
  verifyPhotoChat();
  try {
    await act(async () => emitMessages([{ id: photoId, data: { ...row, attachmentPath: 'conversations/other/photos/i/sent.png' } }]));
    expect(view.queryByText('查看照片')).toBeNull();
    await act(async () => emitMessages([{ id: photoId, data: { ...row, attachmentPath: published } }]));
    jest.mocked(Photos.openDmPhoto).mockReset().mockImplementation(async () => ({ uri: 'data:image/png;base64,QQ==', expiresAt: Date.now() + 60000 }));
    expect(Photos.openDmPhoto).not.toHaveBeenCalled();
    await act(async () => fireEvent.press(view.getByText('查看照片')));
    expect(view.getByLabelText('對話中的照片')).toBeTruthy();
    expect(Photos.openDmPhoto).toHaveBeenCalledWith({
      viewerUid: 'alice', schoolId: 'pu', conversationId: photoConvo, messageId: photoId,
    }, published, expect.anything());
    act(() => jest.advanceTimersByTime(60000));
    expect(view.queryByLabelText('對話中的照片')).toBeNull();
    await act(async () => fireEvent.press(view.getByText('查看照片')));
    await act(async () => emitMessages([{ id: photoId, data: { ...row, attachmentPath: published, recalledAt: { seconds: 2 } } }]));
    expect(view.queryByLabelText('對話中的照片')).toBeNull();
    expect(view.queryByText('查看照片')).toBeNull();
    expect(view.getByText('訊息已撤回')).toBeTruthy();
  } finally {
    view.unmount();
    jest.useRealTimers();
  }
});

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
import * as DmConversations from '../services/dmConversations';
import * as ImagePicker from 'expo-image-picker';
import { getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { fetchSchoolDirectoryProfiles } from '../services/memberDirectory';

const mockSend = jest.fn();
let mockViewer = 'alice';
let mockSchool = 'pu';
let mockPhotoId = 'photo_message_00000001';
jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: jest.fn(),
  UIImagePickerPreferredAssetRepresentationMode: { Compatible: 'compatible' },
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => mockPhotoId }));
jest.mock('../services/dmPhotos', () => ({
  ...jest.requireActual('../services/dmPhotos'),
  localPhoto: jest.fn(),
  uploadDmPhoto: jest.fn(),
  confirmDmPhoto: jest.fn(),
  openDmPhoto: jest.fn(),
}));
jest.mock('../services/dmConversations', () => ({
  prepareDmConversation: jest.fn(),
  sendDmText: jest.fn(),
  watchNewDm: jest.fn(),
}));
const mockSnapshotHandlers = new Map();
const mockSnapshotErrors = new Map();
let mockIncomingThread: (() => void) | null = null;
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
    ErrorState: jest.requireActual('../ui/components').ErrorState,
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
  onSnapshot: (qy: { path?: string }, optionsOrNext: any, maybeNext?: any, maybeFail?: any) => {
    const path = qy?.path ?? '';
    if (typeof optionsOrNext === 'function') {
      mockSnapshotHandlers.set(path, optionsOrNext);
      mockSnapshotErrors.set(path, maybeNext);
      return () => { mockSnapshotHandlers.delete(path); mockSnapshotErrors.delete(path); };
    }
    if (path.includes('/messages')) {
      mockMessagesSnapshotOptions = optionsOrNext;
    }
    mockSnapshotHandlers.set(path, maybeNext);
    mockSnapshotErrors.set(path, maybeFail);
    return () => {
      if (mockSnapshotHandlers.get(path) === maybeNext) {
        mockSnapshotHandlers.delete(path);
        mockSnapshotErrors.delete(path);
      }
    };
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
  fromCache = false,
) {
  const handler = [...mockSnapshotHandlers.entries()].find(([path]) =>
    path.includes('/messages'),
  )?.[1];
  if (!handler) throw new Error('missing messages snapshot handler');
  handler({
    metadata: { fromCache, hasPendingWrites: docs.some((row) => row.hasPendingWrites) },
    docs: docs.map((row) => ({
      id: row.id,
      data: () => row.data,
      metadata: { hasPendingWrites: Boolean(row.hasPendingWrites) },
    })),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockViewer = 'alice';
  mockSchool = 'pu';
  mockPhotoId = 'photo_message_00000001';
  mockSend.mockReset();
  mockSend.mockResolvedValue({ id: 'fixed-msg-1', replayed: false });
  mockSnapshotHandlers.clear();
  mockSnapshotErrors.clear();
  mockMessagesSnapshotOptions = null;
  mockIncomingThread = null;
  jest.mocked(DmConversations.prepareDmConversation).mockReset().mockResolvedValue({
    conversationId: 'dm_pu_alice_bob', peerUid: 'bob', exists: false,
  });
  jest.mocked(DmConversations.sendDmText).mockReset().mockResolvedValue({
    conversationId: 'dm_pu_alice_bob', messageId: 'fixed-msg-1',
  });
  jest.mocked(DmConversations.watchNewDm).mockReset().mockImplementation((_scope, receive) => {
    mockIncomingThread = receive;
    return () => { if (mockIncomingThread === receive) mockIncomingThread = null; };
  });
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

  verifyPhotoChat();
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
  verifyPhotoChat();
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
  verifyPhotoChat();
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
  verifyPhotoChat();
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
          type: 'text',
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
  verifyPhotoChat();
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
  verifyPhotoChat();
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
  verifyPhotoChat();
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
  verifyPhotoChat();
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
  verifyPhotoChat();
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
function navigationWithFocus() {
  const listeners: Partial<Record<'focus' | 'blur', () => void>> = {};
  return {
    setOptions: jest.fn(),
    isFocused: () => true,
    addListener: (event: 'focus' | 'blur', listener: () => void) => {
      listeners[event] = listener;
      return () => {
        if (listeners[event] === listener) delete listeners[event];
      };
    },
    emit: (event: 'focus' | 'blur') => listeners[event]?.(),
  };
}

function photoChat(conversationId = photoConvo, navigation: { setOptions: jest.Mock } = { setOptions: jest.fn() }) {
  return <ChatScreen route={{ params: { conversationId, peerId: 'bob' } }} navigation={navigation} />;
}
function verifyPhotoChat(
  fromCache = false,
  hasPendingWrites = false,
  data: Record<string, unknown> = {},
) {
  const handler = mockSnapshotHandlers.get(`conversations/${photoConvo}`);
  act(() => handler({
    exists: () => true,
    metadata: { fromCache, hasPendingWrites },
    data: () => ({ type: 'dm', schoolId: 'pu', memberIds: ['alice', 'bob'], ...data }),
  }));
}
function pickPhoto() {
  jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue({
    canceled: false, assets: [{ uri: 'file:///pick.png', mimeType: 'image/png', width: 20, height: 20 }],
  });
  jest.mocked(Photos.localPhoto).mockReturnValue({ uri: 'file:///pick.png', contentType: 'image/png', size: 10 });
}

test('local preview is removable and sending a photo shows it is not yet available', async () => {
  pickPhoto();
  jest.mocked(Photos.uploadDmPhoto).mockReset();
  jest.mocked(Photos.confirmDmPhoto).mockReset();
  const view = render(photoChat());
  expect(view.queryByLabelText('加入照片')).toBeNull();
  verifyPhotoChat(true);
  expect(view.queryByLabelText('加入照片')).toBeNull();
  verifyPhotoChat(false, true);
  expect(view.queryByLabelText('加入照片')).toBeNull();
  verifyPhotoChat();
  await act(async () => fireEvent.press(view.getByLabelText('加入照片')));
  expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalledWith(
    expect.objectContaining({ preferredAssetRepresentationMode: 'compatible' }),
  );
  expect(view.getByLabelText('待傳送照片預覽')).toBeTruthy();
  expect(Photos.uploadDmPhoto).not.toHaveBeenCalled();
  fireEvent.press(view.getByLabelText('移除照片'));
  expect(view.queryByLabelText('待傳送照片預覽')).toBeNull();
  await act(async () => fireEvent.press(view.getByLabelText('加入照片')));
  await act(async () => fireEvent.press(view.getByText('傳送照片')));
  expect(view.getByText('照片私訊尚未開通')).toBeTruthy();
  expect(view.getByLabelText('待傳送照片預覽')).toBeTruthy();
  await act(async () => {
    fireEvent.press(view.getByText('重新傳送照片'));
  });
  expect(view.getByText('照片私訊尚未開通')).toBeTruthy();
  expect(view.queryByText('照片已傳送')).toBeNull();
  expect(view.queryByText('照片傳送中…')).toBeNull();
  expect(Photos.uploadDmPhoto).not.toHaveBeenCalled();
  expect(Photos.confirmDmPhoto).not.toHaveBeenCalled();
});

test('blurring the screen keeps the photo composer mounted with the same draft', async () => {
  pickPhoto();
  jest.mocked(Photos.uploadDmPhoto).mockReset();
  jest.mocked(Photos.confirmDmPhoto).mockReset();
  const navigation = navigationWithFocus();
  const view = render(photoChat(photoConvo, navigation));
  verifyPhotoChat();
  await act(async () => { navigation.emit('blur'); });
  expect(view.getByLabelText('加入照片').props.accessibilityState).toEqual({ disabled: true });
  fireEvent.press(view.getByLabelText('加入照片'));
  expect(ImagePicker.launchImageLibraryAsync).not.toHaveBeenCalled();
  await act(async () => { navigation.emit('focus'); });
  await act(async () => { fireEvent.press(view.getByLabelText('加入照片')); });
  expect(view.getByLabelText('待傳送照片預覽')).toBeTruthy();
  await act(async () => { navigation.emit('blur'); });
  expect(view.getByLabelText('待傳送照片預覽')).toBeTruthy();
  expect(view.queryByLabelText('加入照片')).toBeNull();
  fireEvent.press(view.getByText('傳送照片'));
  expect(Photos.uploadDmPhoto).not.toHaveBeenCalled();
  expect(view.queryByText('照片私訊尚未開通')).toBeNull();
  await act(async () => { navigation.emit('focus'); });
  expect(view.getByLabelText('待傳送照片預覽')).toBeTruthy();
  await act(async () => { fireEvent.press(view.getByText('傳送照片')); });
  expect(view.getByText('照片私訊尚未開通')).toBeTruthy();
  expect(view.getByLabelText('待傳送照片預覽')).toBeTruthy();
  expect(view.queryByText('照片已傳送')).toBeNull();
  expect(Photos.uploadDmPhoto).not.toHaveBeenCalled();
  expect(Photos.confirmDmPhoto).not.toHaveBeenCalled();
});

test('pending typing and presence writes preserve a verified photo draft after send is declined', async () => {
  pickPhoto();
  jest.mocked(Photos.uploadDmPhoto).mockReset();
  jest.mocked(Photos.confirmDmPhoto).mockReset();
  const view = render(photoChat());
  verifyPhotoChat();
  await act(async () => {
    fireEvent.press(view.getByLabelText('加入照片'));
  });
  fireEvent.changeText(view.getByPlaceholderText('輸入訊息...'), '搭配照片的文字');
  verifyPhotoChat(false, true, { typingUsers: { alice: { seconds: 12 } } });
  expect(view.getByLabelText('待傳送照片預覽')).toBeTruthy();
  expect(view.getByDisplayValue('搭配照片的文字')).toBeTruthy();
  verifyPhotoChat();
  await act(async () => {
    fireEvent.press(view.getByText('傳送照片'));
  });
  verifyPhotoChat(false, true, {
    onlineUsers: { alice: { seconds: 20 } },
    lastReadBy: { alice: { seconds: 20 } },
  });
  expect(view.getByLabelText('待傳送照片預覽')).toBeTruthy();
  expect(view.getByText('照片私訊尚未開通')).toBeTruthy();
  expect(view.queryByText('照片傳送中…')).toBeNull();
  verifyPhotoChat();
  expect(view.getByText('照片私訊尚未開通')).toBeTruthy();
  expect(view.getByDisplayValue('搭配照片的文字')).toBeTruthy();
  expect(Photos.uploadDmPhoto).not.toHaveBeenCalled();
  expect(Photos.confirmDmPhoto).not.toHaveBeenCalled();
});

test.each([
  { name: 'pending member change', fromCache: false, hasPendingWrites: true, data: { memberIds: ['alice', 'charlie'] } },
])('$name clears a photo draft and requires fresh server confirmation', async ({ fromCache, hasPendingWrites, data }) => {
  pickPhoto();
  const view = render(photoChat());
  verifyPhotoChat();
  await act(async () => {
    fireEvent.press(view.getByLabelText('加入照片'));
  });
  expect(view.getByLabelText('待傳送照片預覽')).toBeTruthy();
  verifyPhotoChat(fromCache, hasPendingWrites, data);
  expect(view.queryByLabelText('待傳送照片預覽')).toBeNull();
  expect(view.queryByLabelText('加入照片')).toBeNull();
  verifyPhotoChat(false, true);
  expect(view.queryByLabelText('加入照片')).toBeNull();
  verifyPhotoChat();
  expect(view.getByLabelText('加入照片')).toBeTruthy();
  expect(view.queryByLabelText('待傳送照片預覽')).toBeNull();
});

test('offline cache preserves loaded messages, a photo draft, and verified access without restarting listeners', async () => {
  pickPhoto();
  const view = render(photoChat());
  verifyPhotoChat();
  const received = { id: 'received', data: { senderId: 'bob', content: '離線仍可閱讀', readBy: ['alice'] } };
  await act(async () => emitMessages([received]));
  await act(async () => fireEvent.press(view.getByLabelText('加入照片')));
  fireEvent.changeText(view.getByPlaceholderText('輸入訊息...'), '保留文字草稿');
  const messagesPath = `conversations/${photoConvo}/messages`;
  const listener = mockSnapshotHandlers.get(messagesPath);

  await act(async () => emitMessages([], true));
  expect(view.getByText('離線仍可閱讀')).toBeTruthy();
  verifyPhotoChat(true);
  // A missing cached document also cannot revoke server-confirmed access.
  act(() => mockSnapshotHandlers.get(`conversations/${photoConvo}`)({
    exists: () => false,
    metadata: { fromCache: true, hasPendingWrites: false },
  }));
  expect(view.getByText('離線仍可閱讀')).toBeTruthy();
  expect(view.getByLabelText('待傳送照片預覽')).toBeTruthy();
  expect(view.queryByLabelText('加入照片')).toBeNull();
  expect(view.getByDisplayValue('保留文字草稿')).toBeTruthy();
  expect(mockSnapshotHandlers.get(messagesPath)).toBe(listener);

  await act(async () => emitMessages([
    received,
    { id: 'reconnected', data: { senderId: 'bob', content: '重新連線後的訊息', readBy: ['alice'] } },
  ]));
  expect(view.getByText('重新連線後的訊息')).toBeTruthy();
});

test.each(['account', 'school', 'thread'])('switching %s discards a private draft after photo send is declined', async (kind) => {
  pickPhoto();
  jest.mocked(Photos.uploadDmPhoto).mockReset();
  jest.mocked(Photos.confirmDmPhoto).mockReset();
  const view = render(photoChat());
  expect(view.queryByLabelText('加入照片')).toBeNull();
  verifyPhotoChat();
  await act(async () => fireEvent.press(view.getByLabelText('加入照片')));
  await act(async () => {
    fireEvent.press(view.getByText('傳送照片'));
  });
  expect(view.getByText('照片私訊尚未開通')).toBeTruthy();
  expect(Photos.uploadDmPhoto).not.toHaveBeenCalled();
  if (kind === 'account') mockViewer = 'other';
  if (kind === 'school') mockSchool = 'another';
  view.rerender(photoChat(kind === 'thread' ? 'other-thread' : photoConvo));
  expect(view.queryByLabelText('待傳送照片預覽')).toBeNull();
  expect(view.queryByText('照片私訊尚未開通')).toBeNull();
  expect(Photos.confirmDmPhoto).not.toHaveBeenCalled();
  expect(Photos.uploadDmPhoto).not.toHaveBeenCalled();
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

function firstChat(peerId = 'bob') {
  return <ChatScreen route={{ params: { peerId } }} navigation={{ setOptions: jest.fn() }} />;
}

test('a new peer is prepared before reads or writes, and selecting or canceling a photo creates nothing', async () => {
  let ready!: (value: { conversationId: string; peerUid: string; exists: boolean }) => void;
  jest.mocked(DmConversations.prepareDmConversation).mockImplementationOnce(() => new Promise(resolve => { ready = resolve; }));
  jest.mocked(Photos.uploadDmPhoto).mockReset();
  jest.mocked(Photos.confirmDmPhoto).mockReset();
  const view = render(firstChat());
  expect(view.getByText('正在確認對話…')).toBeTruthy();
  fireEvent.changeText(view.getByPlaceholderText('輸入訊息...'), '等你一起吃飯');
  fireEvent.press(view.getByLabelText('傳送訊息'));
  expect(DmConversations.sendDmText).not.toHaveBeenCalled();
  expect(mockSnapshotHandlers.size).toBe(0);
  expect(getDoc).not.toHaveBeenCalled();
  expect(setDoc).not.toHaveBeenCalled();
  expect(updateDoc).not.toHaveBeenCalled();
  await act(async () => ready({ conversationId: photoConvo, peerUid: 'bob', exists: false }));
  expect(view.getByText('傳送第一則訊息，或分享一張照片。')).toBeTruthy();
  expect(DmConversations.watchNewDm).toHaveBeenCalledWith({
    viewerUid: 'alice', schoolId: 'pu', peerUid: 'bob', conversationId: photoConvo,
  }, expect.any(Function), expect.any(Function));
  jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValueOnce({ canceled: true, assets: null });
  await act(async () => { fireEvent.press(view.getByLabelText('加入照片')); });
  expect(view.queryByLabelText('待傳送照片預覽')).toBeNull();
  pickPhoto();
  await act(async () => { fireEvent.press(view.getByLabelText('加入照片')); });
  expect(view.getByLabelText('待傳送照片預覽')).toBeTruthy();
  fireEvent.press(view.getByLabelText('移除照片'));
  expect(view.getByDisplayValue('等你一起吃飯')).toBeTruthy();
  expect(Photos.uploadDmPhoto).not.toHaveBeenCalled();
  expect(Photos.confirmDmPhoto).not.toHaveBeenCalled();
  expect(mockSnapshotHandlers.size).toBe(0);
  expect(getDoc).not.toHaveBeenCalled();
  expect(setDoc).not.toHaveBeenCalled();
  expect(updateDoc).not.toHaveBeenCalled();
});

test('the first text retries its stable ID and starts direct listeners only after an acknowledgment', async () => {
  jest.mocked(DmConversations.sendDmText).mockRejectedValueOnce({ code: 'unavailable' });
  const view = render(firstChat());
  await waitFor(() => expect(view.getByLabelText('加入照片')).toBeTruthy());
  fireEvent.changeText(view.getByPlaceholderText('輸入訊息...'), '第一則訊息');
  await act(async () => { fireEvent.press(view.getByLabelText('傳送訊息')); });
  expect(view.getByText('未確認')).toBeTruthy();
  expect(view.getByDisplayValue('第一則訊息')).toBeTruthy();
  expect(mockSnapshotHandlers.size).toBe(0);
  expect(updateDoc).not.toHaveBeenCalled();
  await act(async () => { fireEvent.press(view.getByLabelText('重試送出此則訊息')); });
  expect(jest.mocked(DmConversations.sendDmText).mock.calls.map(([input]) => input)).toEqual([
    { viewerUid: 'alice', schoolId: 'pu', peerUid: 'bob', conversationId: photoConvo, messageId: 'fixed-msg-1', content: '第一則訊息' },
    { viewerUid: 'alice', schoolId: 'pu', peerUid: 'bob', conversationId: photoConvo, messageId: 'fixed-msg-1', content: '第一則訊息' },
  ]);
  expect(mockSend).not.toHaveBeenCalled();
  expect(getDoc).not.toHaveBeenCalled();
  expect(setDoc).not.toHaveBeenCalled();
  expect(mockSnapshotHandlers.has(`conversations/${photoConvo}/messages`)).toBe(true);
  await act(async () => emitMessages([{ id: 'fixed-msg-1', data: { senderId: 'alice', type: 'text', content: '第一則訊息', readBy: ['alice'] } }]));
  expect(view.getByText('已送達')).toBeTruthy();
  expect(readOutboundDrafts(photoConvo, 'alice')).toEqual([]);
});

test.each([
  { name: 'exact text', change: {}, confirmed: true },
  { name: 'different sender', change: { senderId: 'bob' }, confirmed: false },
  { name: 'different content', change: { content: '另一則內容' }, confirmed: false },
  { name: 'different type', change: { type: 'image' }, confirmed: false },
  { name: 'different document', documentId: 'other-message', change: { id: 'fixed-msg-1' }, confirmed: false },
])('a first-text late timeout respects only its $name server confirmation', async ({ change, confirmed, documentId }) => {
  let rejectReceipt!: (error: unknown) => void;
  jest.mocked(DmConversations.sendDmText).mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectReceipt = reject; }));
  const view = render(firstChat());
  await waitFor(() => expect(view.getByLabelText('加入照片')).toBeTruthy());
  fireEvent.changeText(view.getByPlaceholderText('輸入訊息...'), '已抵達伺服器');
  await act(async () => { fireEvent.press(view.getByLabelText('傳送訊息')); });
  act(() => mockIncomingThread?.());
  await act(async () => emitMessages([{ id: documentId ?? 'fixed-msg-1', data: {
    senderId: 'alice', type: 'text', content: '已抵達伺服器', readBy: ['alice'], ...change,
  } }]));
  if (confirmed) {
    expect(view.getByText('已送達')).toBeTruthy();
    expect(readOutboundDrafts(photoConvo, 'alice')).toEqual([]);
    fireEvent.changeText(view.getByPlaceholderText('輸入訊息...'), '接著要說的內容');
  } else {
    expect(view.getByText('送出中')).toBeTruthy();
    expect(readOutboundDrafts(photoConvo, 'alice')).toHaveLength(1);
  }
  await act(async () => rejectReceipt({ code: 'unavailable' }));
  if (confirmed) {
    expect(view.getByText('已送達')).toBeTruthy();
    expect(view.queryByText('未確認')).toBeNull();
    expect(view.getByDisplayValue('接著要說的內容')).toBeTruthy();
    expect(readOutboundDrafts(photoConvo, 'alice')).toEqual([]);
  } else {
    expect(view.getByText('未確認')).toBeTruthy();
    expect(view.getByLabelText('重試送出此則訊息')).toBeTruthy();
  }
});

test.each(['unchanged', 'new text after error', 'edited back after error', 'new text while sending'])(
  'a late first-text server snapshot clears only its automatic restored draft (%s)',
  async (editing) => {
    let rejectReceipt!: (error: unknown) => void;
    jest.mocked(DmConversations.sendDmText).mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectReceipt = reject; }));
    const view = render(firstChat());
    await waitFor(() => expect(view.getByLabelText('加入照片')).toBeTruthy());
    fireEvent.changeText(view.getByPlaceholderText('輸入訊息...'), '第一則原稿');
    await act(async () => { fireEvent.press(view.getByLabelText('傳送訊息')); });
    if (editing === 'new text while sending') {
      fireEvent.changeText(view.getByPlaceholderText('輸入訊息...'), '新的文字草稿');
    }
    await act(async () => rejectReceipt({ code: 'unavailable' }));
    expect(view.getByText('未確認')).toBeTruthy();
    if (editing === 'new text after error') {
      fireEvent.changeText(view.getByPlaceholderText('輸入訊息...'), '新的文字草稿');
    }
    if (editing === 'edited back after error') {
      fireEvent.changeText(view.getByPlaceholderText('輸入訊息...'), '重新編輯');
      fireEvent.changeText(view.getByPlaceholderText('輸入訊息...'), '第一則原稿');
    }
    const beforeConfirmation = editing.startsWith('new text') ? '新的文字草稿' : '第一則原稿';
    expect(view.getByDisplayValue(beforeConfirmation)).toBeTruthy();
    act(() => mockIncomingThread?.());
    await act(async () => emitMessages([{ id: 'fixed-msg-1', data: {
      senderId: 'bob', type: 'text', content: '第一則原稿', readBy: ['alice'],
    } }]));
    expect(view.getByDisplayValue(beforeConfirmation)).toBeTruthy();
    expect(readOutboundDrafts(photoConvo, 'alice')).toHaveLength(1);
    await act(async () => emitMessages([{ id: 'fixed-msg-1', data: {
      senderId: 'alice', type: 'text', content: '第一則原稿', readBy: ['alice'],
    } }]));
    expect(view.getByText('已送達')).toBeTruthy();
    expect(view.queryByText('未確認')).toBeNull();
    expect(readOutboundDrafts(photoConvo, 'alice')).toEqual([]);
    expect(view.getByPlaceholderText('輸入訊息...').props.value).toBe(
      editing === 'unchanged' ? '' : beforeConfirmation,
    );
    expect(DmConversations.sendDmText).toHaveBeenCalledTimes(1);
  },
);

test('an incoming first message keeps a declined first photo and its text draft intact', async () => {
  pickPhoto();
  jest.mocked(Photos.uploadDmPhoto).mockReset();
  jest.mocked(Photos.confirmDmPhoto).mockReset();
  const view = render(firstChat());
  await waitFor(() => expect(view.getByLabelText('加入照片')).toBeTruthy());
  await act(async () => { fireEvent.press(view.getByLabelText('加入照片')); });
  fireEvent.changeText(view.getByPlaceholderText('輸入訊息...'), '照片留給你');
  await act(async () => { fireEvent.press(view.getByText('傳送照片')); });
  expect(view.getByText('照片私訊尚未開通')).toBeTruthy();
  expect(mockSnapshotHandlers.size).toBe(0);
  act(() => mockIncomingThread?.());
  const conversation = mockSnapshotHandlers.get(`conversations/${photoConvo}`);
  act(() => conversation({ exists: () => false, metadata: { fromCache: true, hasPendingWrites: false } }));
  await act(async () => emitMessages([{ id: 'cached', data: { senderId: 'bob', content: '未經確認的快取', readBy: ['alice'] } }], true));
  expect(view.queryByText('未經確認的快取')).toBeNull();
  expect(view.getByLabelText('待傳送照片預覽')).toBeTruthy();
  expect(view.getByText('照片私訊尚未開通')).toBeTruthy();
  expect(view.getByDisplayValue('照片留給你')).toBeTruthy();
  verifyPhotoChat();
  await act(async () => emitMessages([{ id: photoId, data: { senderId: 'bob', type: 'image', content: '照片', attachmentPath: published, readBy: ['alice'] } }]));
  expect(view.getByText('查看照片')).toBeTruthy();
  expect(view.getByText('照片私訊尚未開通')).toBeTruthy();
  expect(view.queryByText('照片已傳送')).toBeNull();
  expect(view.getByDisplayValue('照片留給你')).toBeTruthy();
  expect(Photos.confirmDmPhoto).not.toHaveBeenCalled();
  expect(Photos.uploadDmPhoto).not.toHaveBeenCalled();
});

test('sending a first photo is declined and later server photos do not mark it sent', async () => {
  pickPhoto();
  jest.mocked(Photos.uploadDmPhoto).mockReset();
  jest.mocked(Photos.confirmDmPhoto).mockReset();
  const view = render(firstChat());
  await waitFor(() => expect(view.getByLabelText('加入照片')).toBeTruthy());
  await act(async () => { fireEvent.press(view.getByLabelText('加入照片')); });
  fireEvent.changeText(view.getByPlaceholderText('輸入訊息...'), '照片旁的文字草稿');
  await act(async () => { fireEvent.press(view.getByText('傳送照片')); });
  expect(view.getByText('照片私訊尚未開通')).toBeTruthy();
  expect(view.getByLabelText('待傳送照片預覽')).toBeTruthy();
  expect(Photos.uploadDmPhoto).not.toHaveBeenCalled();
  expect(Photos.confirmDmPhoto).not.toHaveBeenCalled();
  act(() => mockIncomingThread?.());
  await act(async () => emitMessages([{ id: photoId, data: {
    senderId: 'alice', type: 'image', attachmentPath: published, readBy: ['alice'],
  } }]));
  expect(view.getByDisplayValue('照片旁的文字草稿')).toBeTruthy();
  expect(view.getByText('照片私訊尚未開通')).toBeTruthy();
  expect(view.getByLabelText('待傳送照片預覽')).toBeTruthy();
  expect(view.queryByText('照片已傳送')).toBeNull();
  jest.mocked(DmConversations.prepareDmConversation).mockResolvedValueOnce({
    conversationId: 'dm_pu_alice_charlie', peerUid: 'charlie', exists: false,
  });
  view.rerender(firstChat('charlie'));
  await waitFor(() => expect(view.getByLabelText('加入照片')).toBeTruthy());
  expect(view.queryByText('照片已傳送')).toBeNull();
  expect(view.queryByLabelText('待傳送照片預覽')).toBeNull();
  expect(Photos.uploadDmPhoto).not.toHaveBeenCalled();
  expect(Photos.confirmDmPhoto).not.toHaveBeenCalled();
});

test('a declined first photo can be replaced without a late snapshot marking it sent', async () => {
  pickPhoto();
  jest.mocked(Photos.uploadDmPhoto).mockReset();
  jest.mocked(Photos.confirmDmPhoto).mockReset();
  const view = render(firstChat());
  await waitFor(() => expect(view.getByLabelText('加入照片')).toBeTruthy());
  await act(async () => { fireEvent.press(view.getByLabelText('加入照片')); });
  await act(async () => { fireEvent.press(view.getByText('傳送照片')); });
  expect(view.getByText('照片私訊尚未開通')).toBeTruthy();
  fireEvent.press(view.getByLabelText('移除照片'));
  mockPhotoId = 'photo_message_00000002';
  jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValueOnce({
    canceled: false, assets: [{ uri: 'file:///next-photo.png', mimeType: 'image/png', width: 20, height: 20 }],
  });
  jest.mocked(Photos.localPhoto).mockReturnValueOnce({ uri: 'file:///next-photo.png', contentType: 'image/png', size: 20 });
  await act(async () => { fireEvent.press(view.getByLabelText('加入照片')); });
  fireEvent.changeText(view.getByPlaceholderText('輸入訊息...'), '稍後才傳的新文字');
  act(() => mockIncomingThread?.());
  await act(async () => emitMessages([{ id: photoId, data: {
    senderId: 'alice', type: 'image', attachmentPath: published, readBy: ['alice'],
  } }]));
  expect(view.getByLabelText('待傳送照片預覽').props.source.uri).toBe('file:///next-photo.png');
  expect(view.getByDisplayValue('稍後才傳的新文字')).toBeTruthy();
  expect(view.queryByText('照片已傳送')).toBeNull();
  expect(Photos.uploadDmPhoto).not.toHaveBeenCalled();
  expect(Photos.confirmDmPhoto).not.toHaveBeenCalled();
});

test('declining a first photo keeps the typed message and does not start a live send', async () => {
  pickPhoto();
  jest.mocked(Photos.uploadDmPhoto).mockReset();
  jest.mocked(Photos.confirmDmPhoto).mockReset();
  const view = render(firstChat());
  await waitFor(() => expect(view.getByLabelText('加入照片')).toBeTruthy());
  await act(async () => { fireEvent.press(view.getByLabelText('加入照片')); });
  fireEvent.changeText(view.getByPlaceholderText('輸入訊息...'), '接著說的話');
  await act(async () => { fireEvent.press(view.getByText('傳送照片')); });
  expect(view.getByText('照片私訊尚未開通')).toBeTruthy();
  expect(view.getByDisplayValue('接著說的話')).toBeTruthy();
  expect(view.queryByText('照片已傳送')).toBeNull();
  expect(Photos.uploadDmPhoto).not.toHaveBeenCalled();
  expect(Photos.confirmDmPhoto).not.toHaveBeenCalled();
  expect(setDoc).not.toHaveBeenCalled();
});

test('a peer who transferred schools can still read and message an existing member conversation', async () => {
  // Alice 仍在 pu；Bob 的目前校籍已不同，prepare 的嚴格校籍檢查拒絕。
  jest.mocked(DmConversations.prepareDmConversation).mockRejectedValueOnce({ code: 'functions/permission-denied' });
  jest.mocked(getDoc).mockResolvedValueOnce({
    exists: () => true,
    metadata: { fromCache: false, hasPendingWrites: false },
    data: () => ({ type: 'dm', schoolId: 'pu', memberIds: ['alice', 'bob'] }),
  } as any);
  const view = render(firstChat());
  await waitFor(() => expect(mockSnapshotHandlers.has(`conversations/${photoConvo}/messages`)).toBe(true));
  verifyPhotoChat();
  await act(async () => emitMessages([{ id: 'old', data: {
    senderId: 'bob', content: '轉校以前的訊息', readBy: ['alice'],
  } }]));
  expect(view.getByText('轉校以前的訊息')).toBeTruthy();
  expect(view.queryByText('目前無法與此對象開啟私訊，請確認登入帳號與所屬學校。')).toBeNull();
  fireEvent.changeText(view.getByPlaceholderText('輸入訊息...'), '繼續既有對話');
  await act(async () => { fireEvent.press(view.getByLabelText('傳送訊息')); });
  expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({
    conversationId: photoConvo, senderId: 'alice', content: '繼續既有對話',
  }));
  expect(DmConversations.sendDmText).not.toHaveBeenCalled();
  expect(DmConversations.watchNewDm).not.toHaveBeenCalled();
  expect(setDoc).not.toHaveBeenCalled();
});

test.each([false, true])('peer entry reads cached history after prepare fails with pending=%s without photo authorization or receipts', async (pending) => {
  jest.mocked(DmConversations.prepareDmConversation).mockRejectedValueOnce({ code: 'functions/unavailable' });
  jest.mocked(getDoc).mockResolvedValueOnce({
    exists: () => true,
    metadata: { fromCache: true, hasPendingWrites: pending },
    data: () => ({ type: 'dm', schoolId: 'pu', memberIds: ['alice', 'bob'] }),
  } as any);
  const view = render(firstChat());
  await waitFor(() => expect(mockSnapshotHandlers.has(`conversations/${photoConvo}`)).toBe(true));
  expect(view.queryByLabelText('加入照片')).toBeNull();
  verifyPhotoChat(true, pending, { onlineUsers: { alice: {} }, lastReadBy: { alice: {} } });
  expect(mockSnapshotHandlers.has(`conversations/${photoConvo}/messages`)).toBe(true);
  jest.mocked(updateDoc).mockClear();
  await act(async () => emitMessages([
    { id: 'history', data: { senderId: 'bob', type: 'text', content: 'peer 離線歷史文字', readBy: [] } },
    { id: 'mine', data: { senderId: 'alice', type: 'text', content: 'peer 我的歷史文字', readBy: ['bob'] } },
    { id: 'photo', data: { senderId: 'bob', type: 'image', attachmentPath: `conversations/${photoConvo}/photos/old/sent.jpg` } },
    { id: 'file', data: { senderId: 'bob', type: 'file', fileName: '作業.pdf' } },
    { id: 'system', data: { senderId: 'bob', type: 'system', content: '已加入對話' } },
    { id: 'pending', hasPendingWrites: true, data: { senderId: 'alice', content: 'peer 尚未確認的文字' } },
  ], true));
  expect(view.getByText('peer 離線歷史文字')).toBeTruthy();
  expect(view.getByText('peer 我的歷史文字')).toBeTruthy();
  expect(view.getByText('照片')).toBeTruthy();
  expect(view.getByText('作業.pdf')).toBeTruthy();
  expect(view.getByText('已加入對話')).toBeTruthy();
  expect(view.queryByText('peer 尚未確認的文字')).toBeNull();
  expect(Photos.openDmPhoto).not.toHaveBeenCalled();
  expect(view.queryByText('已送達')).toBeNull();
  expect(view.queryByText('已讀')).toBeNull();
  expect(updateDoc).not.toHaveBeenCalled();
  expect(view.queryByLabelText('加入照片')).toBeNull();
  // 即使收到同成員名單的待寫入文件，也不能繼承不存在的伺服器授權。
  verifyPhotoChat(false, true);
  expect(view.queryByLabelText('加入照片')).toBeNull();
  expect(Photos.uploadDmPhoto).not.toHaveBeenCalled();
  expect(DmConversations.watchNewDm).not.toHaveBeenCalled();
  expect(DmConversations.sendDmText).not.toHaveBeenCalled();
  expect(setDoc).not.toHaveBeenCalled();
  verifyPhotoChat();
  expect(view.getByLabelText('加入照片')).toBeTruthy();
});

test.each([false, true].flatMap(fromCache => [
  { exists: false },
  { memberIds: ['alice', 'charlie'] },
  { memberIds: ['bob', 'charlie'] },
  { schoolId: 'another' },
  { type: 'group_chat' },
  { memberIds: ['alice', ''] },
].map(invalid => ({ ...invalid, fromCache }))))('a rejected prepare cannot open or create an unconfirmed member conversation (%j)', async (invalid) => {
  jest.mocked(DmConversations.prepareDmConversation).mockRejectedValueOnce({ code: 'functions/permission-denied' });
  jest.mocked(getDoc).mockResolvedValueOnce({
    exists: () => invalid.exists !== false,
    metadata: { fromCache: false, hasPendingWrites: false, ...invalid },
    data: () => ({ type: 'dm', schoolId: 'pu', memberIds: ['alice', 'bob'], ...invalid }),
  } as any);
  const view = render(firstChat());
  await waitFor(() => expect(view.getByLabelText('重新確認對話')).toBeTruthy());
  fireEvent.changeText(view.getByPlaceholderText('輸入訊息...'), '不可新建');
  fireEvent.press(view.getByLabelText('傳送訊息'));
  expect(mockSnapshotHandlers.size).toBe(0);
  expect(mockSend).not.toHaveBeenCalled();
  expect(DmConversations.sendDmText).not.toHaveBeenCalled();
  expect(setDoc).not.toHaveBeenCalled();
});

test.each(['account', 'school', 'peer'])('a late member lookup cannot reopen the previous %s scope', async (kind) => {
  let finish!: (value: any) => void;
  jest.mocked(DmConversations.prepareDmConversation).mockRejectedValueOnce({ code: 'functions/permission-denied' });
  jest.mocked(getDoc).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const view = render(firstChat());
  await waitFor(() => expect(getDoc).toHaveBeenCalledTimes(1));
  if (kind === 'account') mockViewer = 'carol';
  if (kind === 'school') mockSchool = 'another';
  const nextPeer = kind === 'peer' ? 'charlie' : 'bob';
  const nextConversation = `dm_${mockSchool}_${[mockViewer, nextPeer].sort().join('_')}`;
  jest.mocked(DmConversations.prepareDmConversation).mockResolvedValueOnce({
    conversationId: nextConversation, peerUid: nextPeer, exists: false,
  });
  view.rerender(firstChat(nextPeer));
  await waitFor(() => expect(view.getByLabelText('加入照片')).toBeTruthy());
  await act(async () => finish({
    exists: () => true,
    metadata: { fromCache: false, hasPendingWrites: false },
    data: () => ({ type: 'dm', schoolId: 'pu', memberIds: ['alice', 'bob'] }),
  }));
  expect(mockSnapshotHandlers.size).toBe(0);
  expect(DmConversations.watchNewDm).toHaveBeenLastCalledWith({
    viewerUid: mockViewer, schoolId: mockSchool, peerUid: nextPeer, conversationId: nextConversation,
  }, expect.any(Function), expect.any(Function));
});

test('prepare rejection stays explicit and can be retried while preserving typed text', async () => {
  jest.mocked(getDoc).mockResolvedValueOnce({ exists: () => false, metadata: { fromCache: false, hasPendingWrites: false } } as any);
  jest.mocked(DmConversations.prepareDmConversation).mockRejectedValueOnce({ code: 'functions/permission-denied' });
  const view = render(firstChat());
  await waitFor(() => expect(view.getByLabelText('重新確認對話')).toBeTruthy());
  expect(view.queryByLabelText('加入照片')).toBeNull();
  expect(DmConversations.watchNewDm).not.toHaveBeenCalled();
  fireEvent.changeText(view.getByPlaceholderText('輸入訊息...'), '尚未送出的內容');
  fireEvent.press(view.getByLabelText('傳送訊息'));
  expect(DmConversations.sendDmText).not.toHaveBeenCalled();
  await act(async () => { fireEvent.press(view.getByLabelText('重新確認對話')); });
  expect(view.getByLabelText('加入照片')).toBeTruthy();
  expect(view.getByDisplayValue('尚未送出的內容')).toBeTruthy();
  expect(DmConversations.prepareDmConversation).toHaveBeenCalledTimes(2);
  expect(getDoc).toHaveBeenCalledTimes(1);
  expect(setDoc).not.toHaveBeenCalled();
});

test.each(['account', 'school', 'peer'])('a late preparation cannot reopen the previous %s scope', async (kind) => {
  let finish!: (value: { conversationId: string; peerUid: string; exists: boolean }) => void;
  jest.mocked(DmConversations.prepareDmConversation).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const view = render(firstChat());
  if (kind === 'account') mockViewer = 'carol';
  if (kind === 'school') mockSchool = 'another';
  const nextPeer = kind === 'peer' ? 'charlie' : 'bob';
  const nextConversation = `dm_${mockSchool}_${[mockViewer, nextPeer].sort().join('_')}`;
  jest.mocked(DmConversations.prepareDmConversation).mockResolvedValueOnce({ conversationId: nextConversation, peerUid: nextPeer, exists: false });
  view.rerender(firstChat(nextPeer));
  await waitFor(() => expect(view.getByLabelText('加入照片')).toBeTruthy());
  await act(async () => finish({ conversationId: photoConvo, peerUid: 'bob', exists: true }));
  expect(jest.mocked(DmConversations.prepareDmConversation).mock.calls[0][1].aborted).toBe(true);
  expect(mockSnapshotHandlers.size).toBe(0);
  expect(DmConversations.watchNewDm).toHaveBeenLastCalledWith({
    viewerUid: mockViewer, schoolId: mockSchool, peerUid: nextPeer, conversationId: nextConversation,
  }, expect.any(Function), expect.any(Function));
});

test('leaving a recipient aborts a pending first-text receipt without activating its old listeners', async () => {
  let finish!: (value: { conversationId: string; messageId: string }) => void;
  jest.mocked(DmConversations.sendDmText).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const view = render(firstChat());
  await waitFor(() => expect(view.getByLabelText('加入照片')).toBeTruthy());
  fireEvent.changeText(view.getByPlaceholderText('輸入訊息...'), '傳給第一位同學');
  await act(async () => { fireEvent.press(view.getByLabelText('傳送訊息')); });
  jest.mocked(DmConversations.prepareDmConversation).mockResolvedValueOnce({
    conversationId: 'dm_pu_alice_charlie', peerUid: 'charlie', exists: false,
  });
  view.rerender(firstChat('charlie'));
  await waitFor(() => expect(view.getByLabelText('加入照片')).toBeTruthy());
  await act(async () => finish({ conversationId: photoConvo, messageId: 'fixed-msg-1' }));
  expect(jest.mocked(DmConversations.sendDmText).mock.calls[0][1].aborted).toBe(true);
  expect(mockSnapshotHandlers.size).toBe(0);
  expect(view.queryByText('傳給第一位同學')).toBeNull();
});

test('a previous account failure cannot restore its draft or unlock the current first send', async () => {
  let rejectPrevious!: (error: unknown) => void;
  let finishCurrent!: (value: { conversationId: string; messageId: string }) => void;
  jest.mocked(DmConversations.sendDmText)
    .mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectPrevious = reject; }))
    .mockImplementationOnce(() => new Promise(resolve => { finishCurrent = resolve; }));
  const view = render(firstChat());
  await waitFor(() => expect(view.getByLabelText('加入照片')).toBeTruthy());
  fireEvent.changeText(view.getByPlaceholderText('輸入訊息...'), '前一個帳號的草稿');
  await act(async () => { fireEvent.press(view.getByLabelText('傳送訊息')); });

  mockViewer = 'bob';
  jest.mocked(DmConversations.prepareDmConversation).mockResolvedValueOnce({
    conversationId: photoConvo, peerUid: 'alice', exists: false,
  });
  view.rerender(firstChat('alice'));
  await waitFor(() => expect(view.getByLabelText('加入照片')).toBeTruthy());
  fireEvent.changeText(view.getByPlaceholderText('輸入訊息...'), '現在帳號的訊息');
  await act(async () => { fireEvent.press(view.getByLabelText('傳送訊息')); });
  await act(async () => rejectPrevious({ code: 'permission-denied' }));

  expect(readOutboundDrafts(photoConvo, 'alice')).toEqual([]);
  expect(view.queryByText('前一個帳號的草稿')).toBeNull();
  expect(view.getByLabelText('訊息送出中')).toBeTruthy();
  fireEvent.changeText(view.getByPlaceholderText('輸入訊息...'), '還在等待上一則');
  fireEvent.press(view.getByLabelText('訊息送出中'));
  expect(DmConversations.sendDmText).toHaveBeenCalledTimes(2);
  await act(async () => finishCurrent({ conversationId: photoConvo, messageId: 'fixed-msg-1' }));
  expect(view.getByDisplayValue('還在等待上一則')).toBeTruthy();
});

test('cached received messages neither mark read nor replace the current outbound draft', async () => {
  mockSend.mockImplementationOnce(() => new Promise(() => {}));
  const view = render(photoChat());
  verifyPhotoChat();
  const received = { id: 'received', data: { senderId: 'bob', content: '伺服器訊息', readBy: ['alice'] } };
  await act(async () => emitMessages([received]));
  fireEvent.changeText(view.getByPlaceholderText('輸入訊息...'), '等待確認的草稿');
  await act(async () => { fireEvent.press(view.getByLabelText('傳送訊息')); });
  jest.mocked(updateDoc).mockClear();
  jest.mocked(fetchSchoolDirectoryProfiles).mockClear();
  await act(async () => emitMessages([
    { ...received, data: { ...received.data, readBy: [] } },
    { id: 'fixed-msg-1', data: { senderId: 'alice', content: '等待確認的草稿', readBy: ['alice'] } },
  ], true));
  expect(view.getByText('伺服器訊息')).toBeTruthy();
  expect(view.getByText('等待確認的草稿')).toBeTruthy();
  expect(view.getByText('送出中')).toBeTruthy();
  expect(readOutboundDrafts(photoConvo, 'alice')).toHaveLength(1);
  expect(updateDoc).not.toHaveBeenCalled();
  expect(fetchSchoolDirectoryProfiles).not.toHaveBeenCalled();
});

test.each(['messages', 'roster'])('%s non-permission errors retain history and outbound retry', async (source) => {
  writeOutboundDrafts(photoConvo, [{
    id: 'retry-history', conversationId: photoConvo, senderId: 'alice',
    content: '等待重試', status: 'failed', createdAtMs: 100,
  }]);
  const view = render(photoChat());
  verifyPhotoChat();
  await act(async () => emitMessages([{ id: 'history', data: {
    senderId: 'bob', content: '已載入歷史', readBy: ['alice'],
  } }]));
  const log = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    act(() => mockSnapshotErrors.get(source === 'messages'
      ? `conversations/${photoConvo}/messages` : `conversations/${photoConvo}`)({ code: 'unavailable' }));
    expect(view.getByText('已載入歷史')).toBeTruthy();
    expect(view.queryByText('你不是此對話的成員，無法檢視訊息。')).toBeNull();
    if (source === 'roster') expect(view.queryByLabelText('加入照片')).toBeNull();
    await act(async () => fireEvent.press(view.getByLabelText('重試送出此則訊息')));
    expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({ messageId: 'retry-history' }));
    expect(view.getByText('已載入歷史')).toBeTruthy();
    expect(view.queryByText('已送達')).toBeNull();
    expect(readOutboundDrafts(photoConvo, 'alice')).toHaveLength(1);
  } finally {
    log.mockRestore();
  }
});

test.each(['messages', 'roster'])('%s permission errors clear received content and reject late message callbacks', async (source) => {
  const view = render(photoChat());
  verifyPhotoChat();
  const received = { id: 'received', data: { senderId: 'bob', content: '私人的內容', readBy: ['alice'] } };
  await act(async () => emitMessages([received]));
  expect(view.getByText('私人的內容')).toBeTruthy();
  const callback = mockSnapshotHandlers.get(`conversations/${photoConvo}/messages`);
  await act(async () => emitMessages([received], true));
  expect(view.getByText('私人的內容')).toBeTruthy();
  await act(async () => emitMessages([received]));
  expect(view.getByText('私人的內容')).toBeTruthy();
  act(() => mockSnapshotErrors.get(source === 'messages' ? `conversations/${photoConvo}/messages` : `conversations/${photoConvo}`)({ code: 'permission-denied' }));
  // A late valid roster must not restore a revoked message listener or hide the error.
  verifyPhotoChat();
  jest.mocked(updateDoc).mockClear();
  jest.mocked(fetchSchoolDirectoryProfiles).mockClear();
  act(() => callback({ metadata: { fromCache: false, hasPendingWrites: false }, docs: [{ id: received.id, data: () => ({ ...received.data, readBy: [] }), metadata: { hasPendingWrites: false } }] }));
  expect(view.queryByText('私人的內容')).toBeNull();
  expect(view.getByText('你不是此對話的成員，無法檢視訊息。')).toBeTruthy();
  expect(updateDoc).not.toHaveBeenCalled();
  expect(fetchSchoolDirectoryProfiles).not.toHaveBeenCalled();
});

test('an invalid conversation roster revokes late message reads and profile lookups', async () => {
  const view = render(photoChat());
  verifyPhotoChat();
  const callback = mockSnapshotHandlers.get(`conversations/${photoConvo}/messages`);
  verifyPhotoChat(false, false, { memberIds: ['bob', 'charlie'] });
  jest.mocked(updateDoc).mockClear();
  jest.mocked(fetchSchoolDirectoryProfiles).mockClear();
  act(() => callback({
    metadata: { fromCache: false, hasPendingWrites: false },
    docs: [{ id: 'late', data: () => ({ senderId: 'charlie', content: '遲到的私訊', readBy: [] }), metadata: { hasPendingWrites: false } }],
  }));
  expect(view.queryByText('遲到的私訊')).toBeNull();
  expect(updateDoc).not.toHaveBeenCalled();
  expect(fetchSchoolDirectoryProfiles).not.toHaveBeenCalled();
});

test('a previous account callback is ignored even when the conversation ID stays the same', async () => {
  const view = render(photoChat());
  verifyPhotoChat();
  const callback = mockSnapshotHandlers.get(`conversations/${photoConvo}/messages`);
  mockViewer = 'charlie';
  view.rerender(photoChat());
  act(() => callback({
    metadata: { fromCache: false, hasPendingWrites: false },
    docs: [{ id: 'old', data: () => ({ senderId: 'bob', content: '上一個帳號的訊息', readBy: ['alice'] }), metadata: { hasPendingWrites: false } }],
  }));
  expect(view.queryByText('上一個帳號的訊息')).toBeNull();
});

test.each([
  { type: 'group_chat' },
  { memberIds: ['bob', 'charlie'] },
  { schoolId: 'another' },
])('an explicit conversation cannot subscribe to messages with an invalid roster (%j)', async (invalid) => {
  const view = render(photoChat());
  expect(mockSnapshotHandlers.has(`conversations/${photoConvo}/messages`)).toBe(false);
  verifyPhotoChat(true, false, invalid);
  verifyPhotoChat(false, true, invalid);
  expect(mockSnapshotHandlers.has(`conversations/${photoConvo}/messages`)).toBe(false);
  expect(() => emitMessages([{ id: 'early', data: { senderId: 'bob', content: '過早到來的訊息' } }])).toThrow('missing messages');
  verifyPhotoChat(false, false, invalid);
  expect(mockSnapshotHandlers.has(`conversations/${photoConvo}/messages`)).toBe(false);
  expect(view.queryByText('過早到來的訊息')).toBeNull();
});

test('the first commit for another account contains no previous messages, outbound, or typed draft', async () => {
  const commits: string[] = [];
  let view: ReturnType<typeof render> | undefined;
  function visibleTree(node: any): unknown {
    if (Array.isArray(node)) return node.map(visibleTree);
    if (!node || typeof node !== 'object') return node;
    return { value: node.props?.value, children: visibleTree(node.children) };
  }
  const chat = () => <React.Profiler id="private-chat" onRender={() => {
    if (view) commits.push(JSON.stringify(visibleTree(view.toJSON())));
  }}>{photoChat()}</React.Profiler>;
  mockSend.mockImplementationOnce(() => new Promise(() => {}));
  view = render(chat());
  verifyPhotoChat();
  await act(async () => emitMessages([{ id: 'private', data: {
    senderId: 'bob', type: 'text', content: '上一帳號收到的內容', readBy: ['alice'],
  } }]));
  fireEvent.changeText(view.getByPlaceholderText('輸入訊息...'), '上一帳號送出中的內容');
  await act(async () => { fireEvent.press(view!.getByLabelText('傳送訊息')); });
  fireEvent.changeText(view.getByPlaceholderText('輸入訊息...'), '上一帳號尚未送出的草稿');
  commits.length = 0;
  mockViewer = 'charlie';
  view.rerender(chat());
  expect(commits.length).toBeGreaterThan(0);
  expect(commits.every((commit) => !commit.includes('上一帳號'))).toBe(true);
  expect(view.getByPlaceholderText('輸入訊息...').props.value).toBe('');
});

test.each([false, true])('offline re-entry restores cached text with pending=%s without receipts or photo authorization', async (pending) => {
  const view = render(photoChat());
  expect(mockSnapshotHandlers.has(`conversations/${photoConvo}/messages`)).toBe(false);
  verifyPhotoChat(true, pending, { onlineUsers: { alice: {} }, lastReadBy: { alice: {} } });
  expect(mockSnapshotHandlers.has(`conversations/${photoConvo}/messages`)).toBe(true);
  jest.mocked(updateDoc).mockClear();
  await act(async () => emitMessages([
    { id: 'history', data: { senderId: 'bob', type: 'text', content: '離線歷史文字', readBy: [] } },
    { id: 'mine', data: { senderId: 'alice', type: 'text', content: '我的歷史文字', readBy: ['bob'] } },
    { id: 'pending', hasPendingWrites: true, data: { senderId: 'bob', content: '尚未確認的文字' } },
  ], true));
  expect(view.getByText('離線歷史文字')).toBeTruthy();
  expect(view.getByText('我的歷史文字')).toBeTruthy();
  expect(view.queryByText('尚未確認的文字')).toBeNull();
  expect(view.queryByText('已送達')).toBeNull();
  expect(view.queryByText('已讀')).toBeNull();
  expect(updateDoc).not.toHaveBeenCalled();
  expect(view.queryByLabelText('加入照片')).toBeNull();
  expect(Photos.uploadDmPhoto).not.toHaveBeenCalled();
  await act(async () => emitMessages([], true));
  verifyPhotoChat(true, false, { memberIds: ['bob', 'charlie'] });
  expect(view.getByText('離線歷史文字')).toBeTruthy();
  expect(view.queryByLabelText('加入照片')).toBeNull();
  verifyPhotoChat(false, true);
  expect(view.queryByLabelText('加入照片')).toBeNull();
  verifyPhotoChat();
  expect(view.getByText('離線歷史文字')).toBeTruthy();
  expect(view.getByLabelText('加入照片')).toBeTruthy();
  act(() => mockSnapshotErrors.get(`conversations/${photoConvo}`)({ code: 'permission-denied' }));
  expect(view.queryByText('離線歷史文字')).toBeNull();
  expect(view.queryByLabelText('加入照片')).toBeNull();
});

test('cached text on re-entry does not acknowledge a restored outbound draft', async () => {
  writeOutboundDrafts(photoConvo, [{
    id: 'fixed-msg-1', conversationId: photoConvo, senderId: 'alice',
    content: '保留未確認草稿', createdAtMs: 1, status: 'unconfirmed',
  }]);
  const view = render(photoChat());
  verifyPhotoChat(true);
  await act(async () => emitMessages([{ id: 'fixed-msg-1', data: {
    senderId: 'alice', type: 'text', content: '保留未確認草稿', readBy: ['bob'],
  } }], true));
  expect(readOutboundDrafts(photoConvo, 'alice')).toHaveLength(1);
  expect(view.getByText('未確認')).toBeTruthy();
  expect(view.getByDisplayValue('保留未確認草稿')).toBeTruthy();
  expect(view.queryByText('已送達')).toBeNull();
  expect(view.queryByText('已讀')).toBeNull();
});


test('a cached roster cannot restore text access after a server revocation', async () => {
  const view = render(photoChat());
  verifyPhotoChat(true);
  await act(async () => emitMessages([{ id: 'history', data: {
    senderId: 'bob', content: '離線私人文字', readBy: ['alice'],
  } }], true));
  expect(view.getByText('離線私人文字')).toBeTruthy();
  verifyPhotoChat(false, false, { memberIds: ['bob', 'charlie'] });
  expect(view.queryByText('離線私人文字')).toBeNull();
  verifyPhotoChat(true);
  expect(mockSnapshotHandlers.has(`conversations/${photoConvo}/messages`)).toBe(false);
  expect(view.queryByLabelText('加入照片')).toBeNull();
});

test.each([
  { memberIds: ['alice', 'charlie'] },
  { memberIds: ['alice', ''] },
  { memberIds: ['alice', null] },
  { memberIds: ['alice', 'alice'] },
])('pending cached untrusted members cannot start text reading (%j)', async (invalid) => {
  render(photoChat());
  verifyPhotoChat(true, true, invalid);
  expect(mockSnapshotHandlers.has(`conversations/${photoConvo}/messages`)).toBe(false);
  expect(Photos.uploadDmPhoto).not.toHaveBeenCalled();
});


test('conversation-ID entry reads pending cached text before the peer is ready', async () => {
  jest.mocked(getDoc).mockImplementationOnce(() => new Promise(() => {}));
  const view = render(<ChatScreen route={{ params: { conversationId: photoConvo } }} navigation={{ setOptions: jest.fn() }} />);
  verifyPhotoChat(true, true, { onlineUsers: { alice: {} }, lastReadBy: { alice: {} } });
  expect(mockSnapshotHandlers.has(`conversations/${photoConvo}/messages`)).toBe(true);
  jest.mocked(updateDoc).mockClear();
  await act(async () => emitMessages([{ id: 'history', data: {
    senderId: 'bob', type: 'text', content: '對方尚未就緒的離線歷史文字', readBy: [],
  } }], true));
  expect(view.getByText('對方尚未就緒的離線歷史文字')).toBeTruthy();
  expect(view.queryByLabelText('加入照片')).toBeNull();
  expect(view.queryByText('已送達')).toBeNull();
  expect(view.queryByText('已讀')).toBeNull();
  expect(updateDoc).not.toHaveBeenCalled();
});

test('conversation-ID entry reads pending cached text after resolving the valid peer', async () => {
  jest.mocked(getDoc).mockResolvedValueOnce({
    exists: () => true,
    metadata: { fromCache: true, hasPendingWrites: true },
    data: () => ({ type: 'dm', schoolId: 'pu', memberIds: ['alice', 'bob'] }),
  } as any);
  const view = render(<ChatScreen route={{ params: { conversationId: photoConvo } }} navigation={{ setOptions: jest.fn() }} />);
  await waitFor(() => expect(mockSnapshotHandlers.has(`conversations/${photoConvo}`)).toBe(true));
  // The lookup may update peerId and replace the roster listener.
  await act(async () => {});
  verifyPhotoChat(true, true, { onlineUsers: { alice: {} }, lastReadBy: { alice: {} } });
  await act(async () => emitMessages([{ id: 'history', data: {
    senderId: 'bob', type: 'text', content: '從對話列表重進的離線文字', readBy: [],
  } }], true));
  expect(view.getByText('從對話列表重進的離線文字')).toBeTruthy();
  expect(view.queryByLabelText('加入照片')).toBeNull();
});


test('resolving the peer preserves a pending cached text session', async () => {
  let resolvePeer!: (snapshot: any) => void;
  jest.mocked(getDoc).mockImplementationOnce(() => new Promise((resolve) => { resolvePeer = resolve; }));
  const view = render(<ChatScreen route={{ params: { conversationId: photoConvo } }} navigation={{ setOptions: jest.fn() }} />);
  verifyPhotoChat(true, true);
  await act(async () => emitMessages([{ id: 'history', data: {
    senderId: 'bob', type: 'text', content: '解析期間的離線文字', readBy: [],
  } }], true));
  await act(async () => resolvePeer({
    exists: () => true,
    metadata: { fromCache: true, hasPendingWrites: true },
    data: () => ({ type: 'dm', schoolId: 'pu', memberIds: ['alice', 'bob'] }),
  }));
  expect(view.getByText('解析期間的離線文字')).toBeTruthy();
  expect(view.queryByLabelText('加入照片')).toBeNull();
  act(() => mockSnapshotErrors.get(`conversations/${photoConvo}`)({ code: 'permission-denied' }));
  expect(view.queryByText('解析期間的離線文字')).toBeNull();
  expect(mockSnapshotHandlers.has(`conversations/${photoConvo}/messages`)).toBe(false);
});

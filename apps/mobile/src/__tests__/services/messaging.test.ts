import { runTransaction } from 'firebase/firestore';
import {
  CHAT_MESSAGE_CONTENT_MAX,
  sendChatMessageIdempotent,
} from '../../services/messaging';

jest.mock('../../firebase', () => ({ getDb: () => ({ name: 'db' }) }));

const mockTx = {
  get: jest.fn(),
  set: jest.fn(),
  update: jest.fn(),
};

jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...parts: string[]) => ({ path: parts.join('/') }),
  doc: (_db: unknown, ...parts: string[]) => ({
    path: parts.join('/'),
    id: parts.at(-1) ?? 'generated',
  }),
  serverTimestamp: jest.fn(() => 'SERVER_TIME'),
  runTransaction: jest.fn(async (_db: unknown, fn: (transaction: typeof mockTx) => Promise<void>) =>
    fn(mockTx),
  ),
  addDoc: jest.fn(),
  getDoc: jest.fn(),
  updateDoc: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockTx.get.mockReset();
  mockTx.set.mockReset();
  mockTx.update.mockReset();
});

test('writes message and conversation summary atomically with nested lastMessage', async () => {
  mockTx.get.mockResolvedValue({ exists: () => false });
  await expect(
    sendChatMessageIdempotent({
      conversationId: 'dm_1',
      messageId: 'msg_1',
      senderId: 'alice',
      content: '  你好  ',
    }),
  ).resolves.toEqual({ id: 'msg_1', replayed: false });

  expect(runTransaction).toHaveBeenCalledTimes(1);
  expect(mockTx.set).toHaveBeenCalledWith(
    { path: 'conversations/dm_1/messages/msg_1', id: 'msg_1' },
    {
      conversationId: 'dm_1',
      senderId: 'alice',
      content: '你好',
      type: 'text',
      readBy: ['alice'],
      createdAt: 'SERVER_TIME',
    },
  );
  expect(mockTx.update).toHaveBeenCalledWith(
    { path: 'conversations/dm_1', id: 'dm_1' },
    expect.objectContaining({
      lastMessage: expect.objectContaining({
        id: 'msg_1',
        senderId: 'alice',
        content: '你好',
      }),
      lastMessageText: '你好',
      lastMessageSenderId: 'alice',
      lastMessageAt: 'SERVER_TIME',
      updatedAt: 'SERVER_TIME',
      'typingUsers.alice': null,
    }),
  );
});

test('replays the same sender and content without rewriting', async () => {
  mockTx.get.mockResolvedValue({
    exists: () => true,
    data: () => ({ senderId: 'alice', content: '同一則' }),
  });
  await expect(
    sendChatMessageIdempotent({
      conversationId: 'dm_1',
      messageId: 'msg_1',
      senderId: 'alice',
      content: '同一則',
    }),
  ).resolves.toEqual({ id: 'msg_1', replayed: true });
  expect(mockTx.set).not.toHaveBeenCalled();
  expect(mockTx.update).not.toHaveBeenCalled();
});

test('rejects conflicting content on the same message id', async () => {
  mockTx.get.mockResolvedValue({
    exists: () => true,
    data: () => ({ senderId: 'alice', content: '原本' }),
  });
  await expect(
    sendChatMessageIdempotent({
      conversationId: 'dm_1',
      messageId: 'msg_1',
      senderId: 'alice',
      content: '另一則',
    }),
  ).rejects.toMatchObject({ code: 'failed-precondition' });
  expect(mockTx.set).not.toHaveBeenCalled();
});

test('rejects blank and overlong content before writing', async () => {
  await expect(
    sendChatMessageIdempotent({
      conversationId: 'dm_1',
      messageId: 'msg_1',
      senderId: 'alice',
      content: '   ',
    }),
  ).rejects.toThrow('訊息內容不可空白');
  await expect(
    sendChatMessageIdempotent({
      conversationId: 'dm_1',
      messageId: 'msg_1',
      senderId: 'alice',
      content: '字'.repeat(CHAT_MESSAGE_CONTENT_MAX + 1),
    }),
  ).rejects.toMatchObject({ code: 'invalid-argument' });
  expect(runTransaction).not.toHaveBeenCalled();
});

import { onSnapshot, query } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { prepareDmConversation, sendDmText, watchNewDm } from '../../services/dmConversations';

let mockUid = 'alice';
const mockCall = jest.fn();
const mockStop = jest.fn();
let mockNext: (snapshot: any) => void;
let mockFail: (error: unknown) => void;
jest.mock('../../firebase', () => ({
  getAuthInstance: () => ({ currentUser: { uid: mockUid } }),
  getFunctionsInstance: () => 'functions',
  getDb: () => 'db',
  isFirebaseMockMode: () => false,
}));
jest.mock('../../services/demoSession', () => ({ isDemoUid: () => false }));
jest.mock('firebase/functions', () => ({ httpsCallable: jest.fn(() => mockCall) }));
jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, path: string) => path,
  where: (...args: unknown[]) => args,
  orderBy: (...args: unknown[]) => args,
  limit: (count: number) => count,
  query: jest.fn((...args) => args),
  onSnapshot: jest.fn((_query, _options, next, fail) => {
    mockNext = next;
    mockFail = fail;
    return mockStop;
  }),
}));

const peer = { viewerUid: 'alice', schoolId: 'pu', peerUid: 'bob' };
const conversationId = 'dm_pu_alice_bob';
const prepared = { conversationId, peerUid: 'bob', exists: false };
const message = { ...peer, conversationId, messageId: 'text_message_00000001', content: ' 操場見 ' };
const signal = () => new AbortController().signal;

beforeEach(() => {
  mockUid = 'alice';
  mockCall.mockReset();
  mockStop.mockClear();
  jest.mocked(httpsCallable).mockClear();
  jest.mocked(onSnapshot).mockClear();
  jest.mocked(query).mockClear();
});

test('prepares an existing canonical conversation ID longer than 120 characters', async () => {
  const longPeer = { viewerUid: 'a'.repeat(64), schoolId: 'pu', peerUid: 'b'.repeat(64) };
  const longId = `dm_pu_${[longPeer.viewerUid, longPeer.peerUid].sort().join('_')}`;
  expect(longId).toHaveLength(135);
  mockUid = longPeer.viewerUid;
  mockCall.mockResolvedValue({ data: { conversationId: longId, peerUid: longPeer.peerUid, exists: true } });
  await expect(prepareDmConversation(longPeer, signal())).resolves.toEqual({
    conversationId: longId,
    peerUid: longPeer.peerUid,
    exists: true,
  });
  expect(mockCall).toHaveBeenCalledWith(longPeer);
});

test('prepares the canonical peer conversation without subscribing or writing a placeholder', async () => {
  mockCall.mockResolvedValue({ data: prepared });
  await expect(prepareDmConversation(peer, signal())).resolves.toEqual(prepared);
  expect(httpsCallable).toHaveBeenCalledWith('functions', 'prepareDmConversation');
  expect(mockCall).toHaveBeenCalledWith(peer);
  expect(onSnapshot).not.toHaveBeenCalled();
});

test.each([
  { ...prepared, conversationId: 'other' },
  { ...prepared, peerUid: 'charlie' },
  { ...prepared, exists: 'false' },
  null,
])('rejects malformed prepare receipts (%j)', async (data) => {
  mockCall.mockResolvedValue({ data });
  await expect(prepareDmConversation(peer, signal())).rejects.toThrow();
});

test('sends the exact stable message and validates its acknowledgment', async () => {
  const receipt = { conversationId, messageId: message.messageId };
  mockCall.mockResolvedValueOnce({ data: receipt });
  await expect(sendDmText(message, signal())).resolves.toEqual(receipt);
  expect(httpsCallable).toHaveBeenCalledWith('functions', 'sendDmText');
  expect(mockCall).toHaveBeenLastCalledWith({ ...message, content: '操場見' });
  mockCall.mockResolvedValueOnce({ data: { ...receipt, messageId: 'different' } });
  await expect(sendDmText(message, signal())).rejects.toThrow('尚未確認');
  mockCall.mockResolvedValueOnce({ data: { ...receipt, conversationId: 'different' } });
  await expect(sendDmText(message, signal())).rejects.toThrow('尚未確認');
});

test.each([
  { peerUid: 'alice' },
  { peerUid: '../bob' },
  { schoolId: '' },
  { viewerUid: 'other' },
])('rejects an invalid peer session before invoking a callable (%j)', async (change) => {
  await expect(prepareDmConversation({ ...peer, ...change }, signal())).rejects.toThrow();
  expect(mockCall).not.toHaveBeenCalled();
});

test.each([
  { conversationId: 'other' },
  { messageId: 'short' },
  { content: ' ' },
  { content: 'a'.repeat(4001) },
])('rejects invalid first-message input before invoking a callable (%j)', async (change) => {
  await expect(sendDmText({ ...message, ...change }, signal())).rejects.toThrow();
  expect(mockCall).not.toHaveBeenCalled();
});

test('aborted or changed sessions cannot accept a late preparation or message receipt', async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(prepareDmConversation(peer, controller.signal)).rejects.toMatchObject({ code: 'cancelled' });
  expect(mockCall).not.toHaveBeenCalled();
  mockCall.mockImplementationOnce(async () => {
    mockUid = 'other';
    return { data: prepared };
  });
  await expect(prepareDmConversation(peer, signal())).rejects.toMatchObject({ code: 'permission-denied' });
  mockUid = 'alice';
  const pending = new AbortController();
  mockCall.mockImplementationOnce(async () => {
    pending.abort();
    return { data: { conversationId, messageId: message.messageId } };
  });
  await expect(sendDmText(message, pending.signal)).rejects.toMatchObject({ code: 'cancelled' });
});

test('normalizes a known callable rejection for the existing outbound failure model', async () => {
  mockCall.mockRejectedValue({ code: 'functions/permission-denied' });
  await expect(sendDmText(message, signal())).rejects.toMatchObject({ code: 'permission-denied' });
});

function snapshot(fromCache = false, hasPendingWrites = false, memberIds = ['alice', 'bob']) {
  return {
    metadata: { fromCache, hasPendingWrites },
    docs: [{ id: conversationId, data: () => ({ type: 'dm', schoolId: 'pu', memberIds }) }],
  };
}

test('detects an incoming first message only through a confirmed, same-school own-inbox query', () => {
  const receive = jest.fn();
  const fail = jest.fn();
  const stop = watchNewDm({ ...peer, conversationId }, receive, fail);
  expect(query).toHaveBeenCalledWith(
    'conversations', ['type', '==', 'dm'], ['schoolId', '==', 'pu'],
    ['memberIds', 'array-contains', 'alice'], ['updatedAt', 'desc'], 100,
  );
  mockNext({ metadata: { fromCache: false, hasPendingWrites: false }, docs: [] });
  mockNext(snapshot(true));
  mockNext(snapshot(false, true));
  expect(receive).not.toHaveBeenCalled();
  mockNext(snapshot());
  expect(receive).toHaveBeenCalledTimes(1);
  mockNext(snapshot());
  mockFail(new Error('late'));
  expect(receive).toHaveBeenCalledTimes(1);
  expect(fail).not.toHaveBeenCalled();
  stop();
  expect(mockStop).toHaveBeenCalledTimes(1);
});

test('an invalid roster or a changed account cannot activate the conversation', () => {
  const receive = jest.fn();
  const fail = jest.fn();
  watchNewDm({ ...peer, conversationId }, receive, fail);
  mockNext(snapshot(false, false, ['alice', 'charlie']));
  expect(fail).toHaveBeenCalledTimes(1);
  expect(receive).not.toHaveBeenCalled();
  watchNewDm({ ...peer, conversationId }, receive, fail);
  mockUid = 'other';
  mockNext(snapshot());
  expect(fail).toHaveBeenCalledTimes(2);
  expect(receive).not.toHaveBeenCalled();
});

test('unsubscribing ignores a late incoming conversation', () => {
  const receive = jest.fn();
  const fail = jest.fn();
  const stop = watchNewDm({ ...peer, conversationId }, receive, fail);
  stop();
  mockNext(snapshot());
  mockFail(new Error('late'));
  expect(receive).not.toHaveBeenCalled();
  expect(fail).not.toHaveBeenCalled();
});

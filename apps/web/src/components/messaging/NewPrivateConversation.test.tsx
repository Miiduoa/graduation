import { Suspense } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import NewDmPage from '@/app/dms/new/page';
import { NewPrivateConversation } from './NewPrivateConversation';
import { deriveDmConversationId } from '@/lib/conversationAccess';
import {
  findPrivateMessageRecipients,
  MessagingError,
  preparePrivateConversation,
  sendPreparedPrivateMessage,
  sendPrivateMessage,
  newPrivateMessageId,
  watchMessagingSession,
  watchNewPrivateConversation,
  watchConversationContents,
  type MessagingSession,
  type PreparedPrivateConversation,
  type ConversationContents,
} from '@/lib/privateMessages';
import { confirmDmPhoto, uploadDmPhoto } from '@/lib/dmPhotos';

const account = vi.hoisted(() => ({ user: { uid: 'alice' } as { uid: string } | null, loading: false }));
vi.mock('@/components/AuthGuard', () => ({ useAuth: () => account }));
vi.mock('@/lib/firebase', () => ({ getAuth: () => ({ currentUser: account.user }) }));
vi.mock('@/components/SiteShell', () => ({
  SiteShell: ({ children, subtitle }: { children: React.ReactNode; subtitle?: string }) => <main><p>{subtitle}</p>{children}</main>,
}));
vi.mock('@/lib/privateMessages', async (original) => ({
  ...await original<typeof import('@/lib/privateMessages')>(),
  findPrivateMessageRecipients: vi.fn(),
  preparePrivateConversation: vi.fn(),
  sendPreparedPrivateMessage: vi.fn(),
  sendPrivateMessage: vi.fn(),
  newPrivateMessageId: vi.fn(),
  watchMessagingSession: vi.fn(),
  watchNewPrivateConversation: vi.fn(),
  watchConversationContents: vi.fn(),
}));
vi.mock('@/lib/dmPhotos', async (original) => ({
  ...await original<typeof import('@/lib/dmPhotos')>(),
  confirmDmPhoto: vi.fn(), uploadDmPhoto: vi.fn(),
}));
const session = { uid: 'alice', schoolId: 'pu' };
const firstMessageId = 'first_message_12345678';
const makePrepared = (scope = session, peerUid = 'bob'): PreparedPrivateConversation => ({
  conversationId: deriveDmConversationId(scope.schoolId, scope.uid, peerUid),
  peerUid,
  peerName: peerUid === 'bob' ? '陳小文' : '林小雨',
  exists: false,
});
function empty(prepared = makePrepared(), scope = session): ConversationContents {
  return {
    exists: false,
    conversation: {
      id: prepared.conversationId, memberIds: [scope.uid, prepared.peerUid],
      peerUid: prepared.peerUid, peerName: prepared.peerName,
      preview: '', lastMessageAt: null, lastSenderId: null, lastReadAt: null,
    },
    messages: [],
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
function selectPhoto() {
  fireEvent.change(screen.getByLabelText('選擇私訊照片'), {
    target: { files: [new File(['image'], '校園照片.jpg', { type: 'image/jpeg' })] },
  });
  fireEvent.load(screen.getByRole('img', { name: '待傳送照片預覽' }));
}
beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  account.user = { uid: 'alice' };
  vi.mocked(watchMessagingSession).mockImplementation((uid, receive) => {
    receive({ uid, schoolId: 'pu' });
    return vi.fn();
  });
  vi.mocked(findPrivateMessageRecipients).mockReset().mockResolvedValue([
    { uid: 'bob', displayName: '陳小文', department: '資訊管理學系' },
  ]);
  vi.mocked(preparePrivateConversation).mockReset().mockImplementation(async (scope, peer) => makePrepared(scope, peer));
  vi.mocked(watchNewPrivateConversation).mockImplementation((scope, prepared, receive) => {
    receive(empty(prepared, scope));
    return vi.fn();
  });
  vi.mocked(watchConversationContents).mockImplementation((scope, id, receive) => {
    const prepared = makePrepared(scope, id.includes('charlie') ? 'charlie' : 'bob');
    receive({ ...empty(prepared, scope), exists: true });
    return vi.fn();
  });
  vi.mocked(newPrivateMessageId).mockReturnValue(firstMessageId);
  vi.mocked(sendPreparedPrivateMessage).mockReset().mockResolvedValue();
  vi.mocked(uploadDmPhoto).mockReset().mockResolvedValue('conversations/dm_pu_alice_bob/photos/hash/photo.jpg');
  vi.mocked(confirmDmPhoto).mockReset().mockResolvedValue();
});

it('searches the current school directory and links the selected real recipient', async () => {
  render(<NewPrivateConversation session={session} />);
  const input = screen.getByRole('searchbox', { name: '同學姓名' });
  expect(document.activeElement).toBe(input);
  fireEvent.change(input, { target: { value: '陳' } });
  fireEvent.submit(input.closest('form')!);
  const recipient = await screen.findByRole('link', { name: /陳小文/ });
  expect(recipient.getAttribute('href')).toBe('/dms/new?peer=bob');
  expect(findPrivateMessageRecipients).toHaveBeenCalledWith(session, '陳', expect.any(AbortSignal));
  expect(screen.getByText('資訊管理學系')).toBeTruthy();
  expect(preparePrivateConversation).not.toHaveBeenCalled();
  expect(sendPreparedPrivateMessage).not.toHaveBeenCalled();
});

it('offers retry for directory failure and discards old results after editing the search', async () => {
  vi.mocked(findPrivateMessageRecipients).mockRejectedValueOnce(new Error('offline'));
  render(<NewPrivateConversation session={session} />);
  const input = screen.getByRole('searchbox', { name: '同學姓名' });
  fireEvent.change(input, { target: { value: '陳' } });
  fireEvent.submit(input.closest('form')!);
  await screen.findByText('這次沒有搜尋成功');
  expect(screen.queryByText(/沒有符合的同學/)).toBeNull();
  const retry = screen.getByRole('button', { name: '重新搜尋' });
  retry.focus();
  fireEvent.click(retry);
  expect(document.activeElement).toBe(input);
  await screen.findByRole('link', { name: /陳小文/ });
  const old = deferred<{ uid: string; displayName: string; department: null }[]>();
  vi.mocked(findPrivateMessageRecipients).mockReturnValueOnce(old.promise);
  fireEvent.submit(input.closest('form')!);
  const signal = vi.mocked(findPrivateMessageRecipients).mock.lastCall![2];
  fireEvent.change(input, { target: { value: '林' } });
  expect(signal.aborted).toBe(true);
  await act(async () => old.resolve([{ uid: 'old', displayName: '舊查詢姓名', department: null }]));
  expect(screen.queryByText('舊查詢姓名')).toBeNull();
  expect(screen.queryByRole('link', { name: /陳小文/ })).toBeNull();
});

it('waits for a read-only preparation and starts with an empty composer without creating a thread', async () => {
  const preparation = deferred<PreparedPrivateConversation>();
  vi.mocked(preparePrivateConversation).mockReturnValueOnce(preparation.promise);
  render(<NewPrivateConversation session={session} peerUid="bob" />);
  expect(screen.getByText('正在確認收件人')).toBeTruthy();
  expect(screen.queryByRole('textbox', { name: '訊息內容' })).toBeNull();
  expect(watchNewPrivateConversation).not.toHaveBeenCalled();
  await act(async () => preparation.resolve(makePrepared()));
  const input = screen.getByRole('textbox', { name: '訊息內容' });
  expect(document.activeElement).toBe(input);
  expect(input).toHaveProperty('disabled', false);
  expect(screen.getByText('傳送文字或照片，開始這段對話。')).toBeTruthy();
  expect(screen.queryByText('對話已讀')).toBeNull();
  expect(watchConversationContents).not.toHaveBeenCalled();
  expect(sendPreparedPrivateMessage).not.toHaveBeenCalled();
  selectPhoto();
  fireEvent.click(screen.getByRole('button', { name: '移除照片' }));
  expect(uploadDmPhoto).not.toHaveBeenCalled();
  expect(confirmDmPhoto).not.toHaveBeenCalled();
  expect(watchConversationContents).not.toHaveBeenCalled();
});

it('requires successful authorization before exposing the first-message composer, including retry', async () => {
  vi.mocked(preparePrivateConversation).mockRejectedValueOnce(new MessagingError('permission'));
  render(<NewPrivateConversation session={session} peerUid="bob" />);
  await screen.findByText('目前無法與這位同學開啟對話');
  expect(screen.queryByRole('textbox', { name: '訊息內容' })).toBeNull();
  expect(watchNewPrivateConversation).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '重新確認' }));
  expect(screen.getByText('正在確認收件人')).toBeTruthy();
  await screen.findByText('傳送文字或照片，開始這段對話。');
  expect(preparePrivateConversation).toHaveBeenCalledTimes(2);
});

it('retries the same first-text message and switches to the existing conversation only on receipt', async () => {
  const receipt = deferred<void>();
  vi.mocked(sendPreparedPrivateMessage).mockRejectedValueOnce(new Error('lost receipt')).mockReturnValueOnce(receipt.promise);
  render(<NewPrivateConversation session={session} peerUid="bob" />);
  await screen.findByText('傳送文字或照片，開始這段對話。');
  const input = screen.getByRole('textbox', { name: '訊息內容' });
  fireEvent.change(input, { target: { value: '  嗨，同學  ' } });
  fireEvent.click(screen.getByRole('button', { name: '傳送訊息' }));
  await screen.findByText('尚未確認送出，內容已保留。請重新連線後再試。');
  expect(input).toHaveProperty('value', '  嗨，同學  ');
  expect(watchConversationContents).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '傳送訊息' }));
  fireEvent.click(screen.getByRole('button', { name: '傳送中…' }));
  expect(sendPreparedPrivateMessage).toHaveBeenCalledTimes(2);
  const calls = vi.mocked(sendPreparedPrivateMessage).mock.calls;
  expect(calls.map((call) => call[2])).toEqual([firstMessageId, firstMessageId]);
  expect(calls[0].slice(0, 4)).toEqual(calls[1].slice(0, 4));
  await act(async () => receipt.resolve());
  expect(input).toHaveProperty('value', '');
  expect(watchConversationContents).toHaveBeenCalledWith(session, makePrepared().conversationId, expect.any(Function), expect.any(Function));
  expect(sendPrivateMessage).not.toHaveBeenCalled();
});

it('sends a photo as the first message, preserves the text draft and reuses one upload on retry', async () => {
  vi.mocked(confirmDmPhoto).mockRejectedValueOnce(new Error('lost receipt'));
  render(<NewPrivateConversation session={session} peerUid="bob" />);
  await screen.findByText('傳送文字或照片，開始這段對話。');
  const input = screen.getByRole('textbox', { name: '訊息內容' });
  fireEvent.change(input, { target: { value: '等等再傳的文字' } });
  selectPhoto();
  fireEvent.click(screen.getByRole('button', { name: '傳送照片' }));
  await screen.findByRole('button', { name: '重新傳送照片' });
  expect(watchConversationContents).not.toHaveBeenCalled();
  const retry = screen.getByRole('button', { name: '重新傳送照片' });
  retry.focus();
  fireEvent.click(retry);
  await screen.findByText('照片已傳送');
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: '加入照片' })));
  expect(input).toHaveProperty('value', '等等再傳的文字');
  expect(uploadDmPhoto).toHaveBeenCalledTimes(1);
  expect(confirmDmPhoto).toHaveBeenCalledTimes(2);
  expect(vi.mocked(uploadDmPhoto).mock.lastCall![0]).toEqual({
    viewerUid: 'alice', schoolId: 'pu', peerUid: 'bob',
    conversationId: makePrepared().conversationId, messageId: firstMessageId,
  });
  expect(vi.mocked(confirmDmPhoto).mock.calls.map((call) => call[0])).toEqual([
    vi.mocked(uploadDmPhoto).mock.lastCall![0], vi.mocked(uploadDmPhoto).mock.lastCall![0],
  ]);
  expect(watchConversationContents).toHaveBeenCalled();
});

it.each(['snapshot-first', 'error-first'])('accepts the exact server-confirmed first text with a lost acknowledgment (%s)', async (ordering) => {
  const receipt = deferred<void>();
  vi.mocked(sendPreparedPrivateMessage).mockReturnValueOnce(receipt.promise);
  render(<NewPrivateConversation session={session} peerUid="bob" />);
  await screen.findByText('傳送文字或照片，開始這段對話。');
  const input = screen.getByRole('textbox', { name: '訊息內容' });
  fireEvent.change(input, { target: { value: '  已經送達的文字  ' } });
  fireEvent.click(screen.getByRole('button', { name: '傳送訊息' }));
  const receive = vi.mocked(watchNewPrivateConversation).mock.lastCall![2];
  if (ordering === 'error-first') {
    await act(async () => receipt.reject(new Error('lost acknowledgment')));
    expect(screen.getByText('尚未確認送出，內容已保留。請重新連線後再試。')).toBeTruthy();
    fireEvent.change(input, { target: { value: '接著寫的新草稿' } });
  }
  act(() => receive({
    ...empty(), exists: true,
    messages: [{ id: firstMessageId, senderId: 'alice', type: 'text', content: '已經送達的文字', createdAt: null, recalled: false }],
  }));
  if (ordering === 'snapshot-first') await act(async () => receipt.reject(new Error('lost acknowledgment')));
  expect(screen.queryByText('尚未確認送出，內容已保留。請重新連線後再試。')).toBeNull();
  expect(input).toHaveProperty('value', ordering === 'snapshot-first' ? '' : '接著寫的新草稿');
  expect(watchConversationContents).toHaveBeenCalled();
  if (ordering === 'snapshot-first') fireEvent.click(screen.getByRole('button', { name: '傳送訊息' }));
  expect(sendPreparedPrivateMessage).toHaveBeenCalledTimes(1);
});

it.each([
  { mismatch: 'ID', patch: { id: 'another-message-id' } },
  { mismatch: 'sender', patch: { senderId: 'bob' } },
  { mismatch: 'content', patch: { content: '只有相似的內容' } },
  { mismatch: 'type', patch: { type: 'system' } },
])('keeps first-text retry when a server message has a different $mismatch', async ({ patch }) => {
  const receipt = deferred<void>();
  vi.mocked(sendPreparedPrivateMessage).mockReturnValueOnce(receipt.promise);
  render(<NewPrivateConversation session={session} peerUid="bob" />);
  await screen.findByText('傳送文字或照片，開始這段對話。');
  const input = screen.getByRole('textbox', { name: '訊息內容' });
  fireEvent.change(input, { target: { value: '仍然等待確認的文字' } });
  fireEvent.click(screen.getByRole('button', { name: '傳送訊息' }));
  const receive = vi.mocked(watchNewPrivateConversation).mock.lastCall![2];
  act(() => receive({
    ...empty(), exists: true,
    messages: [{ id: firstMessageId, senderId: 'alice', type: 'text', content: '仍然等待確認的文字', createdAt: null, recalled: false, ...patch }],
  }));
  await act(async () => receipt.reject(new Error('unavailable')));
  expect(screen.getByText('尚未確認送出，內容已保留。請重新連線後再試。')).toBeTruthy();
  expect(input).toHaveProperty('value', '仍然等待確認的文字');
  expect(watchConversationContents).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '傳送訊息' }));
  await waitFor(() => expect(input).toHaveProperty('value', ''));
  expect(vi.mocked(sendPreparedPrivateMessage).mock.calls.map((call) => call[2])).toEqual([firstMessageId, firstMessageId]);
});

it.each(['snapshot-first', 'error-first'])('accepts the exact immutable server photo with a lost acknowledgment (%s)', async (ordering) => {
  const receipt = deferred<void>();
  vi.mocked(confirmDmPhoto).mockReturnValueOnce(receipt.promise);
  render(<NewPrivateConversation session={session} peerUid="bob" />);
  await screen.findByText('傳送文字或照片，開始這段對話。');
  const input = screen.getByRole('textbox', { name: '訊息內容' });
  fireEvent.change(input, { target: { value: '照片旁邊的文字草稿' } });
  selectPhoto();
  fireEvent.click(screen.getByRole('button', { name: '傳送照片' }));
  await waitFor(() => expect(confirmDmPhoto).toHaveBeenCalled());
  const receive = vi.mocked(watchNewPrivateConversation).mock.lastCall![2];
  if (ordering === 'error-first') {
    await act(async () => receipt.reject(new Error('lost acknowledgment')));
    expect(screen.getByRole('button', { name: '重新傳送照片' })).toBeTruthy();
  }
  act(() => receive({
    ...empty(), exists: true,
    messages: [{
      id: firstMessageId, senderId: 'alice', type: 'image', content: '照片', createdAt: null, recalled: false,
      attachmentPath: 'conversations/dm_pu_alice_bob/photos/hash/sent.jpg',
    }],
  }));
  if (ordering === 'snapshot-first') await act(async () => receipt.reject(new Error('lost acknowledgment')));
  expect(screen.getByText('照片已傳送')).toBeTruthy();
  expect(screen.queryByRole('button', { name: '重新傳送照片' })).toBeNull();
  expect(input).toHaveProperty('value', '照片旁邊的文字草稿');
  expect(uploadDmPhoto).toHaveBeenCalledTimes(1);
  expect(confirmDmPhoto).toHaveBeenCalledTimes(1);
  expect(watchConversationContents).toHaveBeenCalled();
});

it.each([
  { mismatch: 'ID', patch: { id: 'another-message-id' } },
  { mismatch: 'sender', patch: { senderId: 'bob' } },
  { mismatch: 'path', patch: { attachmentPath: 'conversations/dm_pu_alice_bob/photos/other/sent.jpg' } },
  { mismatch: 'type', patch: { type: 'text' } },
])('keeps first-photo retry when a server message has a different $mismatch', async ({ patch }) => {
  const receipt = deferred<void>();
  vi.mocked(confirmDmPhoto).mockReturnValueOnce(receipt.promise);
  render(<NewPrivateConversation session={session} peerUid="bob" />);
  await screen.findByText('傳送文字或照片，開始這段對話。');
  selectPhoto();
  fireEvent.click(screen.getByRole('button', { name: '傳送照片' }));
  await waitFor(() => expect(confirmDmPhoto).toHaveBeenCalled());
  const receive = vi.mocked(watchNewPrivateConversation).mock.lastCall![2];
  act(() => receive({
    ...empty(), exists: true,
    messages: [{
      id: firstMessageId, senderId: 'alice', type: 'image', content: '照片', createdAt: null, recalled: false,
      attachmentPath: 'conversations/dm_pu_alice_bob/photos/hash/sent.jpg', ...patch,
    }],
  }));
  await act(async () => receipt.reject(new Error('unavailable')));
  fireEvent.click(screen.getByRole('button', { name: '重新傳送照片' }));
  await screen.findByText('照片已傳送');
  expect(uploadDmPhoto).toHaveBeenCalledTimes(1);
  expect(vi.mocked(confirmDmPhoto).mock.calls[0].slice(0, 2)).toEqual(vi.mocked(confirmDmPhoto).mock.calls[1].slice(0, 2));
});

it('discards a late first-photo confirmation after selecting a different recipient', async () => {
  const receipt = deferred<void>();
  vi.mocked(confirmDmPhoto).mockReturnValueOnce(receipt.promise);
  const view = render(<NewPrivateConversation session={session} peerUid="bob" />);
  await screen.findByText('傳送文字或照片，開始這段對話。');
  selectPhoto();
  fireEvent.click(screen.getByRole('button', { name: '傳送照片' }));
  await waitFor(() => expect(confirmDmPhoto).toHaveBeenCalled());
  const oldReceive = vi.mocked(watchNewPrivateConversation).mock.lastCall![2];
  const oldSignal = vi.mocked(confirmDmPhoto).mock.lastCall![2];
  view.rerender(<NewPrivateConversation session={session} peerUid="charlie" />);
  await screen.findByRole('heading', { name: '林小雨' });
  const input = screen.getByRole('textbox', { name: '訊息內容' });
  fireEvent.change(input, { target: { value: '新收件人的文字' } });
  selectPhoto();
  act(() => oldReceive({
    ...empty(), exists: true,
    messages: [{
      id: firstMessageId, senderId: 'alice', type: 'image', content: '照片', createdAt: null, recalled: false,
      attachmentPath: 'conversations/dm_pu_alice_bob/photos/hash/sent.jpg',
    }],
  }));
  await act(async () => receipt.reject(new Error('lost acknowledgment')));
  expect(oldSignal.aborted).toBe(true);
  expect(input).toHaveProperty('value', '新收件人的文字');
  expect(screen.getByRole('img', { name: '待傳送照片預覽' })).toBeTruthy();
  expect(screen.queryByText('照片已傳送')).toBeNull();
  expect(screen.queryByRole('button', { name: '重新傳送照片' })).toBeNull();
  expect(watchConversationContents).not.toHaveBeenCalled();
});

it('shows a recipient-first message while preserving the local first-message draft', async () => {
  render(<NewPrivateConversation session={session} peerUid="bob" />);
  await screen.findByText('傳送文字或照片，開始這段對話。');
  const input = screen.getByRole('textbox', { name: '訊息內容' });
  fireEvent.change(input, { target: { value: '我正在輸入' } });
  const receive = vi.mocked(watchNewPrivateConversation).mock.lastCall![2];
  act(() => receive({
    ...empty(), exists: true,
    messages: [{ id: 'incoming', senderId: 'bob', content: '對方先打招呼', type: 'text', createdAt: null, recalled: false }],
  }));
  expect(screen.getByText('對方先打招呼')).toBeTruthy();
  expect(input).toHaveProperty('value', '我正在輸入');
  expect(sendPreparedPrivateMessage).not.toHaveBeenCalled();
});

it('keeps focus in the text draft when a photo finishes while the user is typing', async () => {
  const receipt = deferred<void>();
  vi.mocked(confirmDmPhoto).mockReturnValueOnce(receipt.promise);
  render(<NewPrivateConversation session={session} peerUid="bob" />);
  await screen.findByText('傳送文字或照片，開始這段對話。');
  selectPhoto();
  fireEvent.click(screen.getByRole('button', { name: '傳送照片' }));
  await waitFor(() => expect(confirmDmPhoto).toHaveBeenCalled());
  const input = screen.getByRole('textbox', { name: '訊息內容' });
  input.focus();
  fireEvent.change(input, { target: { value: '照片傳送時繼續寫' } });
  await act(async () => receipt.resolve());
  await act(async () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  expect(document.activeElement).toBe(input);
  expect(input).toHaveProperty('value', '照片傳送時繼續寫');
});

it.each(['peer', 'school', 'account'])('aborts the old first-photo request after switching %s', async (change) => {
  const upload = deferred<string>();
  vi.mocked(uploadDmPhoto).mockReturnValueOnce(upload.promise);
  const view = render(<NewPrivateConversation session={session} peerUid="bob" />);
  await screen.findByText('傳送文字或照片，開始這段對話。');
  selectPhoto();
  fireEvent.click(screen.getByRole('button', { name: '傳送照片' }));
  const signal = vi.mocked(uploadDmPhoto).mock.lastCall![2];
  const next: MessagingSession = {
    uid: change === 'account' ? 'new-account' : 'alice',
    schoolId: change === 'school' ? 'another-school' : 'pu',
  };
  account.user = { uid: next.uid };
  view.rerender(<NewPrivateConversation session={next} peerUid={change === 'peer' ? 'charlie' : 'bob'} />);
  await screen.findByText('傳送文字或照片，開始這段對話。');
  expect(signal.aborted).toBe(true);
  const input = screen.getByRole('textbox', { name: '訊息內容' });
  fireEvent.change(input, { target: { value: '新對話草稿' } });
  await act(async () => upload.resolve('conversations/dm_pu_alice_bob/photos/hash/photo.jpg'));
  expect(confirmDmPhoto).not.toHaveBeenCalled();
  expect(input).toHaveProperty('value', '新對話草稿');
  expect(screen.queryByRole('img', { name: '待傳送照片預覽' })).toBeNull();
});

it('discards stale preparation and a late first-text receipt after changing recipient', async () => {
  const oldPreparation = deferred<PreparedPrivateConversation>();
  vi.mocked(preparePrivateConversation).mockReturnValueOnce(oldPreparation.promise);
  const view = render(<NewPrivateConversation session={session} peerUid="bob" />);
  const signal = vi.mocked(preparePrivateConversation).mock.lastCall![2];
  view.rerender(<NewPrivateConversation session={session} peerUid="charlie" />);
  await screen.findByRole('heading', { name: '林小雨' });
  await act(async () => oldPreparation.resolve(makePrepared()));
  expect(signal.aborted).toBe(true);
  expect(screen.queryByRole('heading', { name: '陳小文' })).toBeNull();
  const receipt = deferred<void>();
  vi.mocked(sendPreparedPrivateMessage).mockReturnValueOnce(receipt.promise);
  fireEvent.change(screen.getByRole('textbox', { name: '訊息內容' }), { target: { value: '小雨的訊息' } });
  fireEvent.click(screen.getByRole('button', { name: '傳送訊息' }));
  const sendingSignal = vi.mocked(sendPreparedPrivateMessage).mock.lastCall![4];
  view.rerender(<NewPrivateConversation session={session} peerUid="bob" />);
  await screen.findByRole('heading', { name: '陳小文' });
  const input = screen.getByRole('textbox', { name: '訊息內容' });
  fireEvent.change(input, { target: { value: '小文的新草稿' } });
  await act(async () => receipt.resolve());
  expect(sendingSignal.aborted).toBe(true);
  expect(input).toHaveProperty('value', '小文的新草稿');
  expect(watchConversationContents).not.toHaveBeenCalled();
});

it('keeps a denied pending-conversation query distinct and removes the approved peer view', async () => {
  render(<NewPrivateConversation session={session} peerUid="bob" />);
  await screen.findByRole('heading', { name: '陳小文' });
  const fail = vi.mocked(watchNewPrivateConversation).mock.lastCall![3];
  act(() => fail('permission'));
  expect(screen.queryByRole('heading', { name: '陳小文' })).toBeNull();
  expect(screen.getByText('目前無法開啟這些資料')).toBeTruthy();
  expect(screen.getByRole('textbox', { name: '訊息內容' })).toHaveProperty('disabled', true);
  expect(screen.queryByRole('button', { name: '加入照片' })).toBeNull();
});

it('renders the Promise-based new-message route with its selected peer', async () => {
  const params = Promise.resolve({ peer: 'bob' });
  await act(async () => {
    render(<Suspense fallback={<p>載入路由…</p>}><NewDmPage searchParams={params} /></Suspense>);
  });
  await screen.findByRole('heading', { name: '陳小文' });
  expect(screen.getByText('尋找同校同學，傳送文字或照片開啟對話。')).toBeTruthy();
  expect(preparePrivateConversation).toHaveBeenCalledWith(session, 'bob', expect.any(AbortSignal));
});

it('preserves the intended new-message recipient through the login return URL', async () => {
  account.user = null;
  const params = Promise.resolve({ peer: 'bob' });
  await act(async () => {
    render(<Suspense fallback={<p>載入路由…</p>}><NewDmPage searchParams={params} /></Suspense>);
  });
  const login = await screen.findByRole('link', { name: '前往登入' });
  expect(login.getAttribute('href')).toBe('/login?returnUrl=%2Fdms%2Fnew%3Fpeer%3Dbob');
  expect(preparePrivateConversation).not.toHaveBeenCalled();
});

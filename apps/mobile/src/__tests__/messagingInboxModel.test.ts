import {
  canRetryDmSend,
  classifyDmSendFailure,
  clearOutboundDraftsForUser,
  clearOutboundPreview,
  clearOutboundPreviewsForUser,
  confirmedServerMessageIds,
  conversationListPreview,
  dmSendStatusLabel,
  filterInbox,
  inboxPreviewForOutbound,
  latestOutboundDraft,
  mergeOutboundWithServerMessages,
  nextDmSendStatus,
  pruneConfirmedOutbound,
  readOutboundDrafts,
  readOutboundPreview,
  schoolConversations,
  setOutboundPreview,
  writeOutboundDrafts,
  unreadConversation,
  type DmOutboundDraft,
  type InboxConversation,
} from '../screens/messagingInboxModel';

const alice = 'alice';
const row = (patch: Partial<InboxConversation> = {}): InboxConversation => ({
  id: 'dm_pu_alice_bob',
  type: 'dm',
  schoolId: 'pu',
  memberIds: [alice, 'bob'],
  lastMessageText: '今天上課嗎？',
  lastMessageAt: { seconds: 1_800_000_000 },
  lastMessageSenderId: 'bob',
  lastReadBy: {},
  ...patch,
});

describe('messaging inbox school boundary', () => {
  it('requires a school and both distinct DM members', () => {
    const valid = row();
    const rows = [
      valid,
      row({ id: 'other', schoolId: 'ncku' }),
      row({ id: 'stranger', memberIds: ['bob', 'carol'] }),
      row({ id: 'group', type: 'group_chat' }),
      row({ id: 'duplicate', memberIds: ['alice', 'alice'] }),
      row({ id: 'invalid-length', memberIds: ['alice', 'bob', 'carol'] }),
    ];
    expect(schoolConversations(rows, alice, 'pu')).toEqual([valid]);
    expect(schoolConversations(rows, alice, '')).toEqual([]);
    expect(schoolConversations(rows, null, 'pu')).toEqual([]);
  });

  it('does not mark my own last message or an empty conversation unread', () => {
    expect(unreadConversation(row({ lastMessageSenderId: 'alice' }), alice)).toBe(false);
    expect(unreadConversation(row({ lastMessageText: '' }), alice)).toBe(false);
    expect(unreadConversation(row(), alice)).toBe(true);
    expect(
      unreadConversation(row({ lastReadBy: { alice: { seconds: 1_800_000_001 } } }), alice),
    ).toBe(false);
  });

  it('searches names and previews within the selected unread state', () => {
    const rows = [
      { ...row(), peerName: '小明' },
      { ...row({ id: 'read', lastMessageSenderId: 'alice' }), peerName: '小華' },
    ];
    expect(filterInbox(rows, alice, '今天', true).map((item) => item.id)).toEqual([
      'dm_pu_alice_bob',
    ]);
    expect(filterInbox(rows, alice, '小華', false).map((item) => item.id)).toEqual(['read']);
    expect(filterInbox(rows, alice, '', true).map((item) => item.id)).toEqual([
      'dm_pu_alice_bob',
    ]);
  });
});

describe('dm send status transitions and retry', () => {
  afterEach(() => {
    clearOutboundPreviewsForUser(null);
  });

  it('maps start / confirmed / known failure / uncertain / background / retry', () => {
    expect(nextDmSendStatus('sending', 'start')).toBe('sending');
    expect(nextDmSendStatus('sending', 'confirmed')).toBe('delivered');
    expect(nextDmSendStatus('sending', 'known_failure')).toBe('failed');
    expect(nextDmSendStatus('sending', 'uncertain')).toBe('unconfirmed');
    expect(nextDmSendStatus('sending', 'background')).toBe('unconfirmed');
    expect(nextDmSendStatus('failed', 'background')).toBe('failed');
    expect(nextDmSendStatus('failed', 'retry')).toBe('sending');
    expect(nextDmSendStatus('unconfirmed', 'retry')).toBe('sending');
    expect(nextDmSendStatus('sending', 'account_or_scope_changed')).toBeNull();
  });

  it('never treats unconfirmed or failed as delivered labels', () => {
    expect(dmSendStatusLabel('sending')).toBe('送出中');
    expect(dmSendStatusLabel('unconfirmed')).toBe('未確認');
    expect(dmSendStatusLabel('failed')).toBe('送出失敗');
    expect(dmSendStatusLabel('delivered')).toBe('已送達');
    expect(dmSendStatusLabel('delivered', true)).toBe('已讀');
    expect(canRetryDmSend('sending')).toBe(false);
    expect(canRetryDmSend('delivered')).toBe(false);
    expect(canRetryDmSend('failed')).toBe(true);
    expect(canRetryDmSend('unconfirmed')).toBe(true);
  });

  it('classifies clear errors as failed and network-like errors as unconfirmed', () => {
    expect(classifyDmSendFailure({ code: 'permission-denied' })).toBe('failed');
    expect(classifyDmSendFailure({ code: 'invalid-argument' })).toBe('failed');
    expect(classifyDmSendFailure({ code: 'unavailable' })).toBe('unconfirmed');
    expect(classifyDmSendFailure({ code: 'deadline-exceeded' })).toBe('unconfirmed');
    expect(classifyDmSendFailure(new Error('Network request failed'))).toBe('unconfirmed');
    expect(classifyDmSendFailure(new Error('something odd'))).toBe('unconfirmed');
  });

  it('keeps unconfirmed outbound out of delivered merges until the server id appears', () => {
    const outbound: DmOutboundDraft[] = [
      {
        id: 'local-1',
        conversationId: 'dm_pu_alice_bob',
        senderId: alice,
        content: '還沒到伺服器',
        status: 'unconfirmed',
        createdAtMs: 1,
      },
      {
        id: 'local-2',
        conversationId: 'dm_pu_alice_bob',
        senderId: alice,
        content: '已確認',
        status: 'sending',
        createdAtMs: 2,
      },
    ];
    const server = [{ id: 'local-2', content: '已確認', createdAt: { seconds: 2 } }];
    // 尚未 prune 前，即使 server 已有同 id，仍顯示 outbound 狀態（不標已送達）。
    const mergedWhilePending = mergeOutboundWithServerMessages(server, outbound, 'dm_pu_alice_bob');
    expect(mergedWhilePending.map((item) => item.id)).toEqual(['local-1', 'local-2']);
    expect(mergedWhilePending.every((item) => 'local' in item && item.local)).toBe(true);
    const pruned = pruneConfirmedOutbound(outbound, new Set(['local-2']));
    expect(pruned.map((item) => item.id)).toEqual(['local-1']);
    const mergedAfterConfirm = mergeOutboundWithServerMessages(server, pruned, 'dm_pu_alice_bob');
    expect(mergedAfterConfirm.map((item) => item.id)).toEqual(['local-1', 'local-2']);
    expect(mergedAfterConfirm[1]).toEqual(server[0]);
  });

  it('orders merged rows by time so old failed drafts stay before newer server messages', () => {
    const outbound: DmOutboundDraft[] = [
      {
        id: 'old-fail',
        conversationId: 'dm_pu_alice_bob',
        senderId: alice,
        content: '舊失敗',
        status: 'failed',
        createdAtMs: 1_000,
      },
    ];
    const server = [
      { id: 'newer', content: '較新', createdAt: { seconds: 5 } },
      { id: 'newest', content: '最新', createdAt: { seconds: 9 } },
    ];
    expect(
      mergeOutboundWithServerMessages(server, outbound, 'dm_pu_alice_bob').map((item) => item.id),
    ).toEqual(['old-fail', 'newer', 'newest']);
  });

  it('does not treat hasPendingWrites snapshots as confirmed delivery', () => {
    const outbound: DmOutboundDraft[] = [
      {
        id: 'pending-1',
        conversationId: 'dm_pu_alice_bob',
        senderId: alice,
        content: '飛行模式送出',
        status: 'sending',
        createdAtMs: 10,
      },
    ];
    const docs = [
      { id: 'pending-1', metadata: { hasPendingWrites: true } },
      { id: 'older', metadata: { hasPendingWrites: false } },
    ];
    const confirmed = confirmedServerMessageIds(docs);
    expect(confirmed.has('pending-1')).toBe(false);
    expect(confirmed.has('older')).toBe(true);
    expect(pruneConfirmedOutbound(outbound, confirmed)).toEqual(outbound);
    const merged = mergeOutboundWithServerMessages(
      [{ id: 'pending-1', content: '飛行模式送出' }],
      outbound,
      'dm_pu_alice_bob',
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ id: 'pending-1', local: true, status: 'sending' });
  });

  it('restores outbound drafts by conversation after leaving the chat', () => {
    clearOutboundDraftsForUser(null);
    const draft: DmOutboundDraft = {
      id: 'retry-1',
      conversationId: 'dm_pu_alice_bob',
      senderId: alice,
      content: '回來還能重試',
      status: 'unconfirmed',
      createdAtMs: 5,
    };
    writeOutboundDrafts('dm_pu_alice_bob', [draft]);
    expect(readOutboundDrafts('dm_pu_alice_bob', alice)).toEqual([draft]);
    expect(readOutboundDrafts('dm_pu_alice_bob', 'bob')).toEqual([]);
    clearOutboundDraftsForUser(alice);
    expect(readOutboundDrafts('dm_pu_alice_bob', alice)).toEqual([]);
  });

  it('picks the newest outbound draft for inbox preview', () => {
    const rows: DmOutboundDraft[] = [
      {
        id: 'a',
        conversationId: 'dm_1',
        senderId: alice,
        content: '舊',
        status: 'failed',
        createdAtMs: 1,
      },
      {
        id: 'b',
        conversationId: 'dm_1',
        senderId: alice,
        content: '新',
        status: 'unconfirmed',
        createdAtMs: 9,
      },
    ];
    expect(latestOutboundDraft(rows, 'dm_1')?.content).toBe('新');
  });

  it('surfaces outbound preview on the inbox without claiming delivery', () => {
    const conversation = row();
    expect(conversationListPreview(conversation, alice)).toBe('今天上課嗎？');
    setOutboundPreview(conversation.id, {
      uid: alice,
      status: 'sending',
      text: '等等我',
    });
    expect(conversationListPreview(conversation, alice)).toBe(
      inboxPreviewForOutbound('等等我', 'sending'),
    );
    expect(conversationListPreview(conversation, 'other')).toBe('今天上課嗎？');
    setOutboundPreview(conversation.id, {
      uid: alice,
      status: 'failed',
      text: '等等我',
    });
    expect(conversationListPreview(conversation, alice)).toContain('送出失敗');
    clearOutboundPreview(conversation.id, alice);
    expect(readOutboundPreview(conversation.id, alice)).toBeNull();
    expect(conversationListPreview(conversation, alice)).toBe('今天上課嗎？');
  });

  it('drops another account preview when the signed-in user changes', () => {
    setOutboundPreview('dm_1', { uid: alice, status: 'unconfirmed', text: 'A' });
    setOutboundPreview('dm_2', { uid: 'bob', status: 'failed', text: 'B' });
    clearOutboundPreviewsForUser(alice);
    expect(readOutboundPreview('dm_1', alice)).toBeNull();
    expect(readOutboundPreview('dm_2', 'bob')?.text).toBe('B');
  });
});

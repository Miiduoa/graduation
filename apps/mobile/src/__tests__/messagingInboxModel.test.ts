import {
  canRetryDmSend,
  classifyDmSendFailure,
  clearOutboundPreview,
  clearOutboundPreviewsForUser,
  conversationListPreview,
  dmSendStatusLabel,
  filterInbox,
  inboxPreviewForOutbound,
  mergeOutboundWithServerMessages,
  nextDmSendStatus,
  pruneConfirmedOutbound,
  readOutboundPreview,
  schoolConversations,
  setOutboundPreview,
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
    const server = [{ id: 'local-2', content: '已確認' }];
    const merged = mergeOutboundWithServerMessages(server, outbound, 'dm_pu_alice_bob');
    expect(merged.map((item) => item.id)).toEqual(['local-2', 'local-1']);
    expect(pruneConfirmedOutbound(outbound, new Set(['local-2'])).map((item) => item.id)).toEqual([
      'local-1',
    ]);
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

import { filterInbox, schoolConversations, unreadConversation, type InboxConversation } from '../screens/messagingInboxModel';

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

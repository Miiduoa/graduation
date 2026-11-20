import {
  deriveDmConversationId,
  isConversationMember,
  isConversationUnread,
} from '../../utils/conversationAccess';

describe('conversationAccess.deriveDmConversationId', () => {
  it('produces a deterministic id regardless of argument order', () => {
    const aThenB = deriveDmConversationId('tw-nchu', 'alice', 'bob');
    const bThenA = deriveDmConversationId('tw-nchu', 'bob', 'alice');
    expect(aThenB).toBe(bThenA);
    expect(aThenB).toBe('dm_tw-nchu_alice_bob');
  });

  it('isolates ids by school so the same pair across schools cannot collide', () => {
    expect(deriveDmConversationId('tw-nchu', 'alice', 'bob')).not.toBe(
      deriveDmConversationId('tw-pu', 'alice', 'bob'),
    );
  });
});

describe('conversationAccess.isConversationMember', () => {
  it('rejects when memberIds is missing or my uid is not present', () => {
    expect(isConversationMember('me', undefined)).toBe(false);
    expect(isConversationMember('me', null)).toBe(false);
    expect(isConversationMember('me', ['someone-else'])).toBe(false);
    expect(isConversationMember(undefined, ['me'])).toBe(false);
  });

  it('accepts when uid is in memberIds', () => {
    expect(isConversationMember('me', ['someone-else', 'me'])).toBe(true);
  });
});

describe('conversationAccess.isConversationUnread', () => {
  it('returns false if the last message was sent by me', () => {
    expect(
      isConversationUnread({
        uid: 'me',
        lastMessageAt: new Date(),
        lastReadAt: undefined,
        lastMessageSenderId: 'me',
      }),
    ).toBe(false);
  });

  it('returns true if there is a peer message and I have never read', () => {
    expect(
      isConversationUnread({
        uid: 'me',
        lastMessageAt: new Date('2026-05-15T10:00:00Z'),
        lastReadAt: undefined,
        lastMessageSenderId: 'peer',
      }),
    ).toBe(true);
  });

  it('returns false if I have already read past the last message', () => {
    expect(
      isConversationUnread({
        uid: 'me',
        lastMessageAt: new Date('2026-05-15T10:00:00Z'),
        lastReadAt: new Date('2026-05-15T11:00:00Z'),
        lastMessageSenderId: 'peer',
      }),
    ).toBe(false);
  });

  it('accepts Firestore Timestamp-like shapes', () => {
    expect(
      isConversationUnread({
        uid: 'me',
        lastMessageAt: { seconds: 1_700_000_000 },
        lastReadAt: { seconds: 1_600_000_000 },
        lastMessageSenderId: 'peer',
      }),
    ).toBe(true);
  });
});

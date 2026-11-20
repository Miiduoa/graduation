import {
  createGroupOwnershipOrigin,
  isGroupOwnershipOriginCurrent,
  transferGroupOwnershipErrorMessage,
} from '../services/groupOwnership';

describe('groupOwnership origin fencing', () => {
  test('same-operation origin stays current only for matching generation and identity', () => {
    const origin = createGroupOwnershipOrigin({
      generation: 4,
      uid: 'alice',
      schoolId: 'pu',
      groupId: 'g1',
      targetUid: 'bob',
      operationId: 'op-stable',
    });
    expect(origin.operationId).toBe('op-stable');
    expect(
      isGroupOwnershipOriginCurrent(origin, {
        generation: 4,
        uid: 'alice',
        schoolId: 'pu',
        groupId: 'g1',
      }),
    ).toBe(true);
    expect(
      isGroupOwnershipOriginCurrent(origin, {
        generation: 5,
        uid: 'alice',
        schoolId: 'pu',
        groupId: 'g1',
      }),
    ).toBe(false);
    expect(
      isGroupOwnershipOriginCurrent(origin, {
        generation: 4,
        uid: 'carol',
        schoolId: 'pu',
        groupId: 'g1',
      }),
    ).toBe(false);
    expect(
      isGroupOwnershipOriginCurrent(origin, {
        generation: 4,
        uid: 'alice',
        schoolId: 'nthu',
        groupId: 'g1',
      }),
    ).toBe(false);
  });

  test('maps recoverable server failures to Traditional Chinese copy', () => {
    expect(
      transferGroupOwnershipErrorMessage({
        code: 'functions/permission-denied',
        message: 'denied',
      }),
    ).toMatch(/權限|資格/);
    expect(
      transferGroupOwnershipErrorMessage({
        code: 'functions/failed-precondition',
        message: '群組擁有者狀態不一致，無法安全轉讓。請稍後再試或聯絡管理員。',
      }),
    ).toMatch(/不一致/);
    expect(transferGroupOwnershipErrorMessage(new Error('請先登入'))).toMatch(/登入/);
  });
});

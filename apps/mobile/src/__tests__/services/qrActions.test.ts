import { httpsCallable } from 'firebase/functions';
import { joinCampusGroupFromQr, parseCampusQrAction } from '../../features/qrActions';

jest.mock('../../firebase', () => ({
  getFunctionsInstance: () => 'functions',
  isFirebaseMockMode: () => false,
}));
jest.mock('firebase/functions', () => ({ httpsCallable: jest.fn() }));
const call = jest.fn();
const confirmed = {
  success: true,
  ownerUid: 'user-a',
  groupId: 'group-a',
  groupName: '課程群組',
  status: 'active',
};
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(httpsCallable).mockReturnValue(call as never);
  call.mockResolvedValue({ data: confirmed });
});

test('recognizes the existing eight-character invitation and canonical friend link without executing them', () => {
  expect(parseCampusQrAction('campus://group/join/abcd1234')).toEqual({
    kind: 'group',
    joinCode: 'ABCD1234',
  });
  expect(parseCampusQrAction('campus://add-friend?uid=user-a')).toEqual({
    kind: 'friend',
    uid: 'user-a',
  });
  expect(call).not.toHaveBeenCalled();
});

test.each([
  'campus://group/join/SHORT',
  'campus://group/join/ABCDEFGH?schoolId=other',
  'campus://group/join?data=legacy',
  'campus://group',
])('does not turn an unsupported group payload into an invitation: %s', (raw) => {
  expect(parseCampusQrAction(raw)).toEqual({ kind: 'unsupported', purpose: 'group' });
});

test.each([
  'campus://add-friend?uid=user-a&uid=user-b',
  'campus://add-friend?uid=user-a&action=join',
  'campus://add-friend?uid=other%2Fuser',
  'campus://add-friend?uid=%0auser',
  'campus://group/join/ABCDEFGH#ignored',
  'campus://admin@group/join/ABCDEFGH',
])('rejects ambiguous or malformed action payloads: %s', (raw) => {
  expect(parseCampusQrAction(raw)).toEqual({ kind: 'invalid' });
});

test('never interprets legacy checksums, expired payloads or private attendance tokens as authorization', () => {
  const expired = btoa(JSON.stringify({ v: '1', t: 'checkin', ts: 0, sig: 'anything' }));
  expect(parseCampusQrAction(`campus://checkin?data=${expired}`)).toEqual({
    kind: 'unsupported',
    purpose: 'attendance',
  });
  expect(parseCampusQrAction('campus://attendance?sessionId=private&token=secret')).toEqual({
    kind: 'unsupported',
    purpose: 'attendance',
  });
  expect(parseCampusQrAction('campus://checkin')).toEqual({
    kind: 'unsupported',
    purpose: 'attendance',
  });
  expect(call).not.toHaveBeenCalled();
});

test('plain text remains content and unsupported schemes cannot launch account actions', () => {
  expect(parseCampusQrAction('hello')).toEqual({ kind: 'text', text: 'hello' });
  expect(parseCampusQrAction('javascript:alert(1)')).toEqual({
    kind: 'unsupported',
    purpose: 'other',
  });
  expect(parseCampusQrAction('https://school.example/path')).toEqual({
    kind: 'link',
    url: 'https://school.example/path',
  });
  expect(parseCampusQrAction('https://someone:password@school.example')).toEqual({
    kind: 'invalid',
  });
  expect(parseCampusQrAction('x'.repeat(4097))).toEqual({ kind: 'invalid' });
});

test('joins through the authorized callable and accepts only its confirmed current-owner membership', async () => {
  expect(
    await joinCampusGroupFromQr({ uid: 'user-a', schoolId: 'pu', joinCode: 'ABCDEFGH' }),
  ).toEqual({ groupId: 'group-a', name: '課程群組' });
  expect(httpsCallable).toHaveBeenCalledWith('functions', 'joinGroupByCode');
  expect(call).toHaveBeenCalledWith({ schoolId: 'pu', joinCode: 'ABCDEFGH' });
});

test.each([
  { success: false },
  { ownerUid: 'other-user' },
  { status: 'pending' },
  { groupId: '' },
  { groupId: 'bad/path' },
  { ownerUid: undefined },
])('cannot confirm a malformed, rejected or foreign-owner result: %j', async (patch) => {
  call.mockResolvedValue({ data: { ...confirmed, ...patch } });
  await expect(
    joinCampusGroupFromQr({ uid: 'user-a', schoolId: 'pu', joinCode: 'ABCDEFGH' }),
  ).rejects.toThrow('group-join-unconfirmed');
});

test('propagates permission failures and rejects invalid identity or code before calling', async () => {
  call.mockRejectedValue(new Error('permission-denied'));
  await expect(
    joinCampusGroupFromQr({ uid: 'user-a', schoolId: 'other-school', joinCode: 'ABCDEFGH' }),
  ).rejects.toThrow('permission-denied');
  call.mockClear();
  await expect(
    joinCampusGroupFromQr({ uid: '', schoolId: 'pu', joinCode: 'ABCDEFGH' }),
  ).rejects.toThrow();
  await expect(
    joinCampusGroupFromQr({ uid: 'user-a', schoolId: '../pu', joinCode: 'ABCDEFGH' }),
  ).rejects.toThrow();
  await expect(
    joinCampusGroupFromQr({ uid: 'user-a', schoolId: 'pu', joinCode: 'code' }),
  ).rejects.toThrow();
  expect(call).not.toHaveBeenCalled();
});

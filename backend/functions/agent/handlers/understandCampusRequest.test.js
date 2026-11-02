'use strict';

const mockGetUser = jest.fn().mockResolvedValue({ exists: false, data: () => ({}) });
const mockAssertMember = jest.fn().mockResolvedValue({ status: 'active' });
jest.mock('firebase-functions/v2/https', () => ({
  ...jest.requireActual('firebase-functions/v2/https'),
  onCall: (_, handler) => handler,
}));
jest.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({ collection: () => ({ doc: () => ({ get: mockGetUser }) }) }),
}));
jest.mock('../../authz', () => ({
  createAuthzHelpers: () => ({ assertActiveSchoolMember: mockAssertMember }),
}));
jest.mock('../semanticCampusIntent', () => ({
  ...jest.requireActual('../semanticCampusIntent'),
  understandCampusUtterance: jest.fn(async () => ({
    status: 'understood',
    source: 'model',
    summary: '課表',
    destinations: ['/timetable'],
    clarifyingQuestion: null,
  })),
}));
jest.mock('../semanticCampusData', () => ({ connectCampusServiceData: jest.fn() }));
const handler = require('./understandCampusRequest');
const { connectCampusServiceData } = require('../semanticCampusData');
const { understandCampusUtterance } = require('../semanticCampusIntent');
const { GROQ_MODEL } = require('../freeCloudModel');
let sequence = 0;
function input() {
  return {
    schoolId: 'pu',
    utterance: '我要交作業',
    requestId: 'handler-' + ++sequence,
    consent: {
      version: 1,
      purpose: 'campus-service-entry',
      provider: 'groq',
      model: GROQ_MODEL,
      schoolId: 'pu',
      utterance: '我要交作業',
    },
  };
}
beforeEach(() => {
  jest.clearAllMocks();
  mockGetUser.mockResolvedValue({ exists: false, data: () => ({}) });
  mockAssertMember.mockResolvedValue({ status: 'active' });
});

test('rejects unauthenticated callers without reading account or calling model', async () => {
  await expect(handler({ data: input() })).rejects.toMatchObject({ code: 'unauthenticated' });
  expect(mockGetUser).not.toHaveBeenCalled();
  expect(understandCampusUtterance).not.toHaveBeenCalled();
});
test('rejects large input before account and model calls', async () => {
  await expect(
    handler({ auth: { uid: 'student-large' }, data: { ...input(), utterance: '中'.repeat(500) } }),
  ).rejects.toMatchObject({ code: 'invalid-argument' });
  expect(mockGetUser).not.toHaveBeenCalled();
  expect(understandCampusUtterance).not.toHaveBeenCalled();
});
test('requires exact disclosure consent before any model or private preview read', async () => {
  await expect(
    handler({
      auth: { uid: 'student-missing-consent' },
      data: { utterance: '我要查課表', schoolId: 'pu' },
    }),
  ).rejects.toMatchObject({
    code: 'failed-precondition',
    details: { reason: 'cloud-consent-required' },
  });
  expect(understandCampusUtterance).not.toHaveBeenCalled();
  expect(connectCampusServiceData).not.toHaveBeenCalled();
  expect(mockGetUser).not.toHaveBeenCalled();
});
test('keeps the existing closing-account preflight', async () => {
  mockGetUser.mockResolvedValueOnce({
    exists: true,
    data: () => ({ accountDeletionInProgress: true }),
  });
  await expect(handler({ auth: { uid: 'student-closing' }, data: input() })).rejects.toMatchObject({
    code: 'failed-precondition',
  });
  expect(understandCampusUtterance).not.toHaveBeenCalled();
});
test('passes only disclosed school and text to the model and never reads private previews', async () => {
  const data = input();
  await expect(handler({ auth: { uid: 'student-okay' }, data })).resolves.toMatchObject({
    source: 'model',
    destinations: ['/timetable'],
    previews: [],
    provider: 'groq',
    model: GROQ_MODEL,
    requestId: data.requestId,
  });
  expect(understandCampusUtterance).toHaveBeenCalledWith({
    utterance: data.utterance,
    schoolId: 'pu',
    signal: expect.any(AbortSignal),
  });
  expect(connectCampusServiceData).not.toHaveBeenCalled();
  expect(mockAssertMember).toHaveBeenCalledTimes(2);
});
test('rejects a revoked membership before requesting a model', async () => {
  mockAssertMember.mockRejectedValueOnce(new Error('revoked'));
  expect(await handler({ auth: { uid: 'student-revoked' }, data: input() })).toMatchObject({
    status: 'unavailable',
    reason: 'permission_changed',
  });
  expect(understandCampusUtterance).not.toHaveBeenCalled();
  expect(connectCampusServiceData).not.toHaveBeenCalled();
});
test('does not expose a model result when the account closes during the request', async () => {
  mockGetUser
    .mockResolvedValueOnce({ exists: false, data: () => ({}) })
    .mockResolvedValueOnce({ exists: false, data: () => ({}) })
    .mockResolvedValueOnce({ exists: true, data: () => ({ accountDeletionInProgress: true }) });
  expect(await handler({ auth: { uid: 'student-closes-later' }, data: input() })).toMatchObject({
    status: 'unavailable',
    reason: 'account_changed',
    destinations: [],
    previews: [],
  });
  expect(understandCampusUtterance).toHaveBeenCalledTimes(1);
  expect(connectCampusServiceData).not.toHaveBeenCalled();
});

'use strict';

const getUser = jest.fn().mockResolvedValue({ exists: false, data: () => ({}) });
jest.mock('firebase-functions/v2/https', () => ({
  ...jest.requireActual('firebase-functions/v2/https'),
  onCall: (_, handler) => handler,
}));
jest.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({ collection: () => ({ doc: () => ({ get: getUser }) }) }),
}));
jest.mock('../semanticCampusIntent', () => ({
  understandCampusUtterance: jest.fn(async () => ({
    status: 'understood', source: 'model', summary: '課表',
    destinations: ['/timetable'], clarifyingQuestion: null,
  })),
}));
const handler = require('./understandCampusRequest');
const { understandCampusUtterance } = require('../semanticCampusIntent');

beforeEach(() => {
  getUser.mockResolvedValue({ exists: false, data: () => ({}) });
  getUser.mockClear();
  understandCampusUtterance.mockClear();
});

test('rejects unauthenticated callers', async () => {
  await expect(handler({ data: { utterance: '今天上什麼課' } }))
    .rejects.toMatchObject({ code: 'unauthenticated' });
  expect(understandCampusUtterance).not.toHaveBeenCalled();
});

test('rejects large inputs before model calls', async () => {
  await expect(handler({ auth: { uid: 'student-large' }, data: { utterance: '中'.repeat(500) } }))
    .rejects.toMatchObject({ code: 'invalid-argument' });
  expect(understandCampusUtterance).not.toHaveBeenCalled();
});

test('rejects requests from closing accounts', async () => {
  getUser.mockResolvedValueOnce({ exists: true, data: () => ({ accountDeletionInProgress: true }) });
  await expect(handler({ auth: { uid: 'student-closing' }, data: { utterance: '今天有課嗎' } }))
    .rejects.toMatchObject({ code: 'failed-precondition' });
  expect(understandCampusUtterance).not.toHaveBeenCalled();
});

test('only passes bounded school and utterance to the model', async () => {
  await expect(handler({ auth: { uid: 'student-okay' }, data: { utterance: '我要交作業', schoolId: 'pu' } }))
    .resolves.toMatchObject({ source: 'model', destinations: ['/timetable'] });
  expect(understandCampusUtterance).toHaveBeenCalledWith({ utterance: '我要交作業', schoolId: 'pu' });
});

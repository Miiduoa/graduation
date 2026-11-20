'use strict';

const mockGetUser = jest.fn().mockResolvedValue({ exists: false, data: () => ({}) });
jest.mock('firebase-functions/v2/https', () => ({
  ...jest.requireActual('firebase-functions/v2/https'),
  onCall: (_, handler) => handler,
}));
jest.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({ collection: () => ({ doc: () => ({ get: mockGetUser }) }) }),
}));
jest.mock('../semanticCampusIntent', () => ({
  understandCampusUtterance: jest.fn(async () => ({
    status: 'understood', source: 'model', summary: '課表',
    destinations: ['/timetable'], clarifyingQuestion: null,
  })),
}));
jest.mock('../semanticCampusData', () => ({
  connectCampusServiceData: jest.fn(async () => [
    { destination: '/timetable', status: 'unavailable', source: 'none', message: '尚未接通正式課表', items: [] },
  ]),
}));
const handler = require('./understandCampusRequest');
const { connectCampusServiceData } = require('../semanticCampusData');
const { understandCampusUtterance } = require('../semanticCampusIntent');

beforeEach(() => {
  mockGetUser.mockResolvedValue({ exists: false, data: () => ({}) });
  mockGetUser.mockClear();
  understandCampusUtterance.mockClear();
  connectCampusServiceData.mockClear();
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
  mockGetUser.mockResolvedValueOnce({ exists: true, data: () => ({ accountDeletionInProgress: true }) });
  await expect(handler({ auth: { uid: 'student-closing' }, data: { utterance: '今天有課嗎' } }))
    .rejects.toMatchObject({ code: 'failed-precondition' });
  expect(understandCampusUtterance).not.toHaveBeenCalled();
});

test('only passes bounded school and utterance to the model', async () => {
  await expect(handler({ auth: { uid: 'student-okay' }, data: { utterance: '我要交作業', schoolId: 'pu' } }))
    .resolves.toMatchObject({ source: 'model', destinations: ['/timetable'] });
  expect(understandCampusUtterance).toHaveBeenCalledWith({ utterance: '我要交作業', schoolId: 'pu' });
  expect(connectCampusServiceData).toHaveBeenCalledWith({
    uid: 'student-okay', schoolId: 'pu', utterance: '我要交作業', destinations: ['/timetable'],
  });
});


test('only reads verified service data after a model-understood intent', async () => {
  understandCampusUtterance.mockResolvedValueOnce({
    status: 'clarify', source: 'model', summary: '需要更多資訊',
    destinations: [], clarifyingQuestion: '要查哪個服務？',
  });
  const response = await handler({
    auth: { uid: 'student-okay' },
    data: { utterance: '幫幫我', schoolId: 'pu' },
  });
  expect(response).toMatchObject({ status: 'clarify', previews: [] });
  expect(connectCampusServiceData).not.toHaveBeenCalled();
});

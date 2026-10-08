jest.mock('./index', () => ({ existingCallable: () => 'unchanged' }));
jest.mock('firebase-functions/v2/https', () => ({
  onCall: jest.fn((options, handler) => ({ options, handler })),
  HttpsError: class extends Error {},
}));
jest.mock('firebase-admin/firestore', () => ({
  getFirestore: jest.fn(() => ({ marker: 'db' })), FieldValue: {}, Timestamp: {},
}));
jest.mock('./attendance/verifyClaim', () => ({
  createVerifyAttendanceClaim: jest.fn(() => 'verified-handler'),
}));

test('the declared entrypoint preserves existing exports and registers the new callable in asia-east1', () => {
  const entrypoint = require('./entrypoint');
  expect(require('./package.json').main).toBe('entrypoint.js');
  expect(entrypoint.existingCallable()).toBe('unchanged');
  expect(entrypoint.verifyAttendanceClaim).toEqual({
    options: { region: 'asia-east1' }, handler: 'verified-handler',
  });
});

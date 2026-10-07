jest.mock('firebase-admin/firestore', () => ({
  ...jest.requireActual('firebase-admin/firestore'),
  getFirestore: jest.fn(),
}));

const { getFirestore } = require('firebase-admin/firestore');
const firestore = {
  collection: jest.fn(),
  runTransaction: jest.fn(),
  batch: jest.fn(),
};
getFirestore.mockReturnValue(firestore);

// Exercise the actual exported handlers, including guards before any existing ledger logic.
const { submitPrintJob, createPaymentIntent } = require('./index');
const originalEnv = process.env;

beforeEach(() => {
  jest.clearAllMocks();
  firestore.collection.mockImplementation(() => {
    throw new Error('Unexpected database access for an unavailable service');
  });
});
afterEach(() => {
  process.env = originalEnv;
});

function expectNoDatabaseActivity() {
  expect(firestore.collection).not.toHaveBeenCalled();
  expect(firestore.runTransaction).not.toHaveBeenCalled();
  expect(firestore.batch).not.toHaveBeenCalled();
}

describe('unavailable remote printing', () => {
  test('requires authentication before revealing service availability', async () => {
    await expect(submitPrintJob.run({ data: {} })).rejects.toMatchObject({
      code: 'unauthenticated',
    });
    expectNoDatabaseActivity();
  });

  test.each(['production', 'preview', 'development'])(
    'does not create jobs or increase printer queues in %s',
    async (environment) => {
      process.env = {
        ...originalEnv,
        APP_ENV: environment,
        REMOTE_PRINTING_ENABLED: 'true',
        PRINTER_DELIVERY_ENABLED: 'true',
      };
      await expect(
        submitPrintJob.run({
          auth: { uid: 'student-1' },
          data: {
            schoolId: 'pu',
            printerId: 'library-printer',
            fileName: 'report.pdf',
            fileUrl: 'https://example.test/report.pdf',
            copies: 2,
            pages: 5,
            color: true,
            duplex: true,
            enabled: true,
            providerReady: true,
          },
        }),
      ).rejects.toMatchObject({
        code: 'failed-precondition',
        message: '遠端校園列印尚未開放，請使用裝置的列印或分享功能。',
      });
      expectNoDatabaseActivity();
    },
  );
});

describe('unavailable account transfers', () => {
  test.each(['campus_card', 'linepay', 'credit_card'])(
    'rejects transfer intents before creating a %s intent or debiting a wallet',
    async (paymentMethod) => {
      await expect(
        createPaymentIntent.run({
          auth: { uid: 'sender' },
          data: { schoolId: 'pu', merchantId: 'transfer:recipient', amount: 100, paymentMethod },
        }),
      ).rejects.toMatchObject({ code: 'failed-precondition', message: '帳號間轉帳尚未開放。' });
      expectNoDatabaseActivity();
    },
  );

  test.each([' transfer:recipient ', 'TRANSFER:recipient', 'transfer:'])(
    'does not bypass the transfer boundary with merchantId %j',
    async (merchantId) => {
      await expect(
        createPaymentIntent.run({
          auth: { uid: 'sender' },
          data: { schoolId: 'pu', merchantId, amount: 100, paymentMethod: 'campus_card' },
        }),
      ).rejects.toMatchObject({ code: 'failed-precondition' });
      expectNoDatabaseActivity();
    },
  );

  test('preserves the authentication boundary for transfer requests', async () => {
    await expect(
      createPaymentIntent.run({
        data: { merchantId: 'transfer:recipient', amount: 100, paymentMethod: 'campus_card' },
      }),
    ).rejects.toMatchObject({ code: 'unauthenticated' });
    expectNoDatabaseActivity();
  });

  test('continues normal merchant requests into the existing payment path', async () => {
    const profileRead = jest.fn(async () => ({ exists: true, data: () => ({ schoolId: 'pu' }) }));
    const reference = { get: profileRead };
    firestore.collection.mockReturnValue({ doc: () => reference });
    // Amount validation runs after school resolution in the unchanged merchant flow.
    await expect(
      createPaymentIntent.run({
        auth: { uid: 'sender' },
        data: { merchantId: 'library-transfer-supplies', amount: 0, paymentMethod: 'campus_card' },
      }),
    ).rejects.toMatchObject({ code: 'invalid-argument', message: 'Invalid amount' });
    expect(profileRead).toHaveBeenCalledTimes(1);
    expect(firestore.runTransaction).not.toHaveBeenCalled();
  });
});

// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import {
  getStudentCardService,
  isStudentCardToken,
  isStudentCardVerification,
  isStudentCardVerificationId,
  maskStudentId,
} from '@campus/shared/src/studentCard';
import {
  cardIdentity,
  issueStudentCard,
  redeemStudentCard,
  studentCardRequest,
} from './studentCard';

const admin = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('./firebaseAdmin', () => ({ getFirebaseAdmin: admin.get }));

const now = Date.now();
const account = {
  uid: 'alice',
  role: 'student',
  schoolId: 'pu',
  campusCardStudentId: 'S1234567',
  firebase: { sign_in_provider: 'custom' },
  auth_time: Math.floor(now / 1000),
};
const verificationId = '12345678-1234-4123-8123-123456789abc';

afterEach(() => {
  vi.restoreAllMocks();
  admin.get.mockReset();
});

function issuanceDatabase(initial?: Record<string, unknown>) {
  let record = initial;
  const user: Record<string, unknown> = { schoolId: 'pu', primarySchoolId: 'pu', role: 'student' };
  const transaction = {
    get: vi.fn(async () => ({
      exists: record !== undefined,
      get: (field: string) => record?.[field],
    })),
    getAll: async () => [
      { exists: true, get: (field: string) => user[field] },
      { get: (field: string) => (field === 'status' ? 'active' : undefined) },
    ],
    set: vi.fn((_ref: unknown, value: Record<string, unknown>) => {
      record = value;
    }),
  };
  const db = {
    doc: (path: string) => ({ path }),
    collection: (path: string) => ({ doc: (uid: string) => ({ path: path + '/' + uid }) }),
    runTransaction: vi.fn((work: (tx: typeof transaction) => Promise<unknown>) =>
      work(transaction),
    ),
  } as unknown as Firestore;
  return { db, transaction, user, readRecord: () => record };
}

it.each(['deleted', 'disabled', 'suspended', 'inactive'])(
  'refuses issuance for an unavailable account (%s)',
  async (status) => {
    const store = issuanceDatabase();
    store.user.status = status;
    await expect(issueStudentCard(store.db, account, 'pu')).rejects.toThrow(
      'SCHOOL_SIGN_IN_REQUIRED',
    );
    expect(store.transaction.set).not.toHaveBeenCalled();
    expect(store.readRecord()).toBeUndefined();
  },
);

describe('student card identity', () => {
  it('takes the number from the authenticated school login', () => {
    expect(cardIdentity(account, 'tw-pu', now)).toEqual({ schoolId: 'pu', studentId: 'S1234567' });
  });
  it.each([
    [{ ...account, studentId: 'S1234567', campusCardStudentId: undefined }, 'pu'],
    [{ ...account, role: 'teacher' }, 'pu'],
    [{ ...account, firebase: { sign_in_provider: 'password' } }, 'pu'],
    [account, 'thu'],
    [account, null],
    [account, '__proto__'],
    [{ ...account, schoolId: 'unknown' }, 'unknown'],
    [{ ...account, auth_time: account.auth_time - 86400 }, 'pu'],
  ] as const)('refuses unsupported evidence %#', (claims, school) => {
    expect(() => cardIdentity(claims, school, now)).toThrow('SCHOOL_SIGN_IN_REQUIRED');
  });
  it('provides verified school destinations and masks short IDs completely', () => {
    expect(maskStudentId('S1234567')).toBe('•••• 4567');
    expect(maskStudentId('1234')).toBe('••••');
    expect(getStudentCardService('tw-pu', 'ios')).toEqual(getStudentCardService('pu', 'ios'));
    expect(getStudentCardService('fcu', 'android')?.url).toContain('com.fcuapp.app');
    expect(getStudentCardService('thu')?.url).toContain('page.line.me');
    expect(getStudentCardService('__proto__')).toBeNull();
    expect(isStudentCardToken('a'.repeat(31))).toBe(false);
    expect(isStudentCardToken('a'.repeat(32))).toBe(true);
    expect(isStudentCardToken('a'.repeat(32) + '\n')).toBe(false);
  });
});

it('accepts only canonical UUID v4 verification IDs', () => {
  expect(isStudentCardVerificationId(verificationId)).toBe(true);
  expect(isStudentCardVerificationId('87654321-4321-4321-b321-cba987654321')).toBe(true);
  expect(isStudentCardVerificationId(undefined)).toBe(false);
});

it.each(
  [
    null,
    [],
    '',
    'a'.repeat(36),
    verificationId.toUpperCase(),
    verificationId + '\n',
    verificationId.replace('4123', '5123'),
    verificationId.replace('8123', '7123'),
  ].map((id) => ({ id })),
)('rejects a malformed verification ID before accessing Firebase (%#)', async ({ id }) => {
  expect(isStudentCardVerificationId(id)).toBe(false);
  const response = await studentCardRequest(
    new Request('https://example.test/api/student-card/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'a'.repeat(32), verificationId: id }),
    }),
    'verify',
  );
  expect(response.status).toBe(400);
  expect(admin.get).not.toHaveBeenCalled();
});

it('shares the existing receipt bounds across web and mobile', () => {
  const receipt = { schoolName: '靜宜大學', maskedId: '•••• 4567', verifiedAt: now };
  expect(isStudentCardVerification(receipt, now)).toBe(true);
  expect(isStudentCardVerification({ ...receipt, verifiedAt: now - 60_000 }, now)).toBe(true);
  expect(isStudentCardVerification({ ...receipt, verifiedAt: now - 60_001 }, now)).toBe(false);
  expect(isStudentCardVerification({ ...receipt, verifiedAt: now + 5_000 }, now)).toBe(true);
  expect(isStudentCardVerification({ ...receipt, verifiedAt: now + 5_001 }, now)).toBe(false);
  expect(isStudentCardVerification({ ...receipt, schoolName: '校'.repeat(160) }, now)).toBe(true);
  expect(isStudentCardVerification({ ...receipt, schoolName: '校'.repeat(161) }, now)).toBe(false);
  expect(isStudentCardVerification({ ...receipt, maskedId: '•••• 4567\n' }, now)).toBe(false);
});

it.each([
  ['present', '{"schoolId":"pu"}', 401],
  ['verify', '{"token":"x"}', 400],
  ['verify', JSON.stringify({ token: 'x'.repeat(32) + '\n' }), 400],
  ['verify', '[]', 400],
  ['verify', 'x'.repeat(1025), 413],
] as const)('rejects invalid %s requests without caching (%#)', async (action, body, expected) => {
  const req = new Request('https://example.test/api/student-card/' + action, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
  const response = await studentCardRequest(req, action);
  expect(response.status).toBe(expected);
  expect(response.headers.get('Cache-Control')).toContain('no-store');
});

it.each([false, true])(
  'rechecks expiration after reading membership for a used=%s card',
  async (used) => {
    const token = 'a'.repeat(32);
    const fields: Record<string, unknown> = {
      digest: createHash('sha256').update(token).digest('hex'),
      schoolId: 'pu',
      expiresAt: now + 60_000,
      maskedId: '•••• 4567',
      verificationDigest: createHash('sha256').update(verificationId).digest('hex'),
      receipt: used
        ? { schoolName: '靜宜大學', maskedId: '•••• 4567', verifiedAt: now }
        : undefined,
    };
    const ref = { path: '_studentCardPresentations/alice' };
    const record = { id: 'alice', ref, get: (field: string) => fields[field] };
    const user: Record<string, unknown> = {
      schoolId: 'pu',
      primarySchoolId: 'pu',
      role: 'student',
    };
    const transaction = {
      get: async () => record,
      getAll: async () => [
        { exists: true, get: (field: string) => user[field] },
        { get: (field: string) => (field === 'status' ? 'active' : undefined) },
      ],
      update: vi.fn(),
    };
    const query = { where: () => query, limit: () => query, get: async () => ({ docs: [record] }) };
    const db = {
      doc: (path: string) => ({ path }),
      collection: () => query,
      runTransaction: (work: (tx: typeof transaction) => unknown) => work(transaction),
    } as unknown as Firestore;
    const clock = vi
      .spyOn(Date, 'now')
      .mockReturnValueOnce(now)
      .mockReturnValue(now + 60_000);
    try {
      await expect(redeemStudentCard(db, token, verificationId)).rejects.toThrow(
        'CARD_UNAVAILABLE',
      );
      expect(transaction.update).not.toHaveBeenCalled();
    } finally {
      clock.mockRestore();
    }
  },
);

it('captures request order before slow ID token verification', async () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
  const store = issuanceDatabase();
  let releaseOld!: (value: typeof account) => void;
  const oldIdentity = new Promise<typeof account>((resolve) => {
    releaseOld = resolve;
  });
  let entered!: () => void;
  const verifying = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const verifyIdToken = vi
    .fn()
    .mockResolvedValue(account)
    .mockImplementationOnce(() => {
      entered();
      return oldIdentity;
    });
  admin.get.mockResolvedValue({ db: store.db, verifyIdToken });
  const request = () =>
    new Request('https://example.test/api/student-card/present', {
      method: 'POST',
      headers: { Authorization: 'Bearer signed-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ schoolId: 'pu' }),
    });

  const old = studentCardRequest(request(), 'present');
  await verifying;
  clock.mockReturnValue(now + 1_000);
  const latest = await studentCardRequest(request(), 'present');
  expect(latest.status).toBe(200);
  const latestCode = await latest.json();
  clock.mockReturnValue(now + 4_000);
  releaseOld(account);
  const lateResponse = await old;
  expect(lateResponse.status).toBe(409);
  await expect(lateResponse.json()).resolves.toEqual({ error: 'PRESENTATION_SUPERSEDED' });
  expect(store.transaction.set).toHaveBeenCalledTimes(1);
  expect(store.readRecord()?.digest).toBe(
    createHash('sha256').update(latestCode.token).digest('hex'),
  );
});

it('allows a later request that started before the preceding transaction committed', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(now);
  const store = issuanceDatabase({ requestedAt: now - 5_000, issuedAt: now - 3_000 });
  await expect(
    issueStudentCard(store.db, account, 'pu', { requestedAt: now - 4_000 }),
  ).resolves.toMatchObject({ studentId: account.campusCardStudentId });
  expect(store.readRecord()?.requestedAt).toBe(now - 4_000);
});

it('uses the existing issuedAt fence for a record from an older app release', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(now);
  const store = issuanceDatabase({ issuedAt: now - 3_000 });
  await expect(
    issueStudentCard(store.db, account, 'pu', { requestedAt: now - 4_000 }),
  ).rejects.toThrow('PRESENTATION_SUPERSEDED');
  expect(store.transaction.set).not.toHaveBeenCalled();
});

it('does not start an already cancelled issuance transaction', async () => {
  const controller = new AbortController();
  controller.abort();
  const store = issuanceDatabase();
  await expect(
    issueStudentCard(store.db, account, 'pu', { signal: controller.signal }),
  ).rejects.toThrow('PRESENTATION_CANCELLED');
  expect(store.db.runTransaction).not.toHaveBeenCalled();
});

it('rechecks cancellation after the transactional reads', async () => {
  const controller = new AbortController();
  const store = issuanceDatabase();
  store.transaction.get.mockImplementationOnce(async () => {
    controller.abort();
    return { exists: false, get: () => undefined };
  });
  await expect(
    issueStudentCard(store.db, account, 'pu', { signal: controller.signal }),
  ).rejects.toThrow('PRESENTATION_CANCELLED');
  expect(store.transaction.set).not.toHaveBeenCalled();
});

it('keeps the request abort signal through ID token verification', async () => {
  const controller = new AbortController();
  const store = issuanceDatabase();
  admin.get.mockResolvedValue({
    db: store.db,
    verifyIdToken: async () => {
      controller.abort();
      return account;
    },
  });
  const response = await studentCardRequest(
    new Request('https://example.test/api/student-card/present', {
      method: 'POST',
      headers: { Authorization: 'Bearer signed-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ schoolId: 'pu' }),
      signal: controller.signal,
    }),
    'present',
  );
  expect(response.status).toBe(409);
  await expect(response.json()).resolves.toEqual({ error: 'PRESENTATION_CANCELLED' });
  expect(store.transaction.set).not.toHaveBeenCalled();
});

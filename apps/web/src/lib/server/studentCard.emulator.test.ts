// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initializeApp, deleteApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { issueStudentCard, redeemStudentCard } from './studentCard';

const local = /^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? '');
describe.skipIf(!local)('student card presentation', { timeout: 25000 }, () => {
  let app: App;
  let db: Firestore;
  const account = {
    uid: 'alice',
    role: 'student',
    schoolId: 'pu',
    campusCardStudentId: 'S1234567',
    firebase: { sign_in_provider: 'custom' },
    auth_time: Math.floor(Date.now() / 1000),
  };
  const verificationId = '12345678-1234-4123-8123-123456789abc';
  const otherVerificationId = '87654321-4321-4321-9321-cba987654321';
  beforeAll(() => {
    app = initializeApp({ projectId: 'demo-campus-cards' }, 'student-cards');
    db = getFirestore(app);
  });
  beforeEach(async () => {
    await db.doc('_studentCardPresentations/alice').delete();
    await db.doc('users/alice').set({
      schoolId: 'pu',
      primarySchoolId: 'pu',
      role: 'student',
      studentId: 'FORGED',
      displayName: 'Private name',
    });
    await db.doc('schools/pu/members/alice').set({ status: 'active' });
  });
  afterAll(() => deleteApp(app));

  it('issues an opaque code and allows exactly one concurrent redemption', async () => {
    const card = await issueStudentCard(db, account, 'pu');
    expect(card.studentId).toBe(account.campusCardStudentId);
    expect(card.token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    await expect(issueStudentCard(db, account, 'pu')).rejects.toThrow('TRY_LATER');
    const scans = await Promise.allSettled([
      redeemStudentCard(db, card.token),
      redeemStudentCard(db, card.token),
    ]);
    expect(scans.filter((result) => result.status === 'fulfilled')).toEqual([
      {
        status: 'fulfilled',
        value: { schoolName: '靜宜大學', maskedId: '•••• 4567', verifiedAt: expect.any(Number) },
      },
    ]);
    await expect(redeemStudentCard(db, card.token)).rejects.toThrow('CARD_UNAVAILABLE');
  });
  it('accepts the documented PU alias consistently on the current profile', async () => {
    await db.doc('users/alice').update({ schoolId: 'tw-pu', primarySchoolId: 'tw-pu' });
    const card = await issueStudentCard(db, account, 'tw-pu');
    await expect(redeemStudentCard(db, card.token)).resolves.toMatchObject({
      schoolName: '靜宜大學',
    });
  });

  it('rejects replaced and expired codes', async () => {
    const first = await issueStudentCard(db, account, 'pu');
    const ref = db.doc('_studentCardPresentations/alice');
    await ref.update({ issuedAt: 0 });
    const next = await issueStudentCard(db, account, 'pu');
    await expect(redeemStudentCard(db, first.token)).rejects.toThrow('CARD_UNAVAILABLE');
    await ref.update({ expiresAt: Date.now() - 1 });
    await expect(redeemStudentCard(db, next.token)).rejects.toThrow('CARD_UNAVAILABLE');
  });

  it('returns the original receipt to retries of the same confirmation only', async () => {
    const card = await issueStudentCard(db, account, 'pu');
    const [first, retry] = await Promise.all([
      redeemStudentCard(db, card.token, verificationId),
      redeemStudentCard(db, card.token, verificationId),
    ]);
    expect(retry).toEqual(first);
    await expect(redeemStudentCard(db, card.token, verificationId)).resolves.toEqual(first);
    await expect(redeemStudentCard(db, card.token, otherVerificationId)).rejects.toThrow(
      'CARD_UNAVAILABLE',
    );
    await expect(redeemStudentCard(db, card.token)).rejects.toThrow('CARD_UNAVAILABLE');
    const stored = await db.doc('_studentCardPresentations/alice').get();
    expect(stored.get('receipt')).toEqual(first);
    expect(JSON.stringify(stored.data())).not.toContain(verificationId);
    expect(JSON.stringify(stored.data())).not.toContain(account.campusCardStudentId);
    await stored.ref.update({ 'receipt.studentId': account.campusCardStudentId });
    await expect(redeemStudentCard(db, card.token, verificationId)).resolves.toEqual(first);
  });

  it('allows only one of two different concurrent confirmation IDs', async () => {
    const card = await issueStudentCard(db, account, 'pu');
    const scans = await Promise.allSettled([
      redeemStudentCard(db, card.token, verificationId),
      redeemStudentCard(db, card.token, otherVerificationId),
    ]);
    expect(scans.filter((scan) => scan.status === 'fulfilled')).toHaveLength(1);
    const rejected = scans.find((scan) => scan.status === 'rejected');
    expect(rejected).toMatchObject({ reason: { message: 'CARD_UNAVAILABLE' } });
  });

  it('does not let an ID claim a receipt already consumed by a legacy client', async () => {
    const card = await issueStudentCard(db, account, 'pu');
    await redeemStudentCard(db, card.token);
    await expect(redeemStudentCard(db, card.token, verificationId)).rejects.toThrow(
      'CARD_UNAVAILABLE',
    );
  });

  it('does not return a saved receipt after the presentation expires', async () => {
    const card = await issueStudentCard(db, account, 'pu');
    await redeemStudentCard(db, card.token, verificationId);
    await db.doc('_studentCardPresentations/alice').update({ expiresAt: Date.now() - 1 });
    await expect(redeemStudentCard(db, card.token, verificationId)).rejects.toThrow(
      'CARD_UNAVAILABLE',
    );
  });

  it('rechecks the current account and membership before returning a saved receipt', async () => {
    const card = await issueStudentCard(db, account, 'pu');
    await redeemStudentCard(db, card.token, verificationId);
    const user = db.doc('users/alice');
    await user.update({ primarySchoolId: 'thu' });
    await expect(redeemStudentCard(db, card.token, verificationId)).rejects.toThrow(
      'CARD_UNAVAILABLE',
    );
    await user.update({ primarySchoolId: 'pu', role: 'teacher' });
    await expect(redeemStudentCard(db, card.token, verificationId)).rejects.toThrow(
      'CARD_UNAVAILABLE',
    );
    await user.update({ role: 'student', accountDeletionInProgress: true });
    await expect(redeemStudentCard(db, card.token, verificationId)).rejects.toThrow(
      'CARD_UNAVAILABLE',
    );
    await user.update({ accountDeletionInProgress: false });
    await db.doc('schools/pu/members/alice').delete();
    await expect(redeemStudentCard(db, card.token, verificationId)).rejects.toThrow(
      'CARD_UNAVAILABLE',
    );
  });

  it.each([undefined, verificationId])(
    'keeps the issuance fence after a code has been consumed (%s)',
    async (id) => {
      const startedBefore = Date.now() - 1_000;
      const card = await issueStudentCard(db, account, 'pu');
      const receipt = await redeemStudentCard(db, card.token, id);
      const ref = db.doc('_studentCardPresentations/alice');
      await ref.update({ issuedAt: 0 });
      await expect(
        issueStudentCard(db, account, 'pu', { requestedAt: startedBefore }),
      ).rejects.toThrow('PRESENTATION_SUPERSEDED');
      expect((await ref.get()).get('receipt')).toEqual(receipt);
    },
  );

  it.each(['removed', 'deleting', 'school-changed', 'primary-school-changed', 'role-changed'])(
    'rechecks account and membership before redemption (%s)',
    async (reason) => {
      const card = await issueStudentCard(db, account, 'pu');
      if (reason === 'removed') await db.doc('schools/pu/members/alice').delete();
      else if (reason === 'deleting')
        await db.doc('users/alice').update({ accountDeletionInProgress: true });
      else if (reason === 'school-changed') await db.doc('users/alice').update({ schoolId: 'thu' });
      else if (reason === 'primary-school-changed')
        await db.doc('users/alice').update({ primarySchoolId: 'thu' });
      else await db.doc('users/alice').update({ role: 'teacher' });
      await expect(redeemStudentCard(db, card.token)).rejects.toThrow('CARD_UNAVAILABLE');
      await expect(issueStudentCard(db, account, 'pu')).rejects.toThrow('SCHOOL_SIGN_IN_REQUIRED');
    },
  );
});

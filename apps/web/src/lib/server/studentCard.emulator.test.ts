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

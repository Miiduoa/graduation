// @vitest-environment node
import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import { initializeApp, deleteApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { createCareerInternshipHandlers } from './careerInternshipHandlers';
import {
  createInternshipService,
  type InternshipCommand,
} from '@campus/shared/src/careerInternship';
import { internshipRule, internshipRecord } from '@campus/shared/testFixtures/careerInternship';
const host = process.env.FIRESTORE_EMULATOR_HOST || '';
const suite = /^(127\.0\.0\.1|localhost):\d+$/.test(host) ? describe : describe.skip;
suite('internship real Firestore transactions', () => {
  let app: App, db: Firestore, handler: ReturnType<typeof createCareerInternshipHandlers>;
  const call = (uid: string | null, c: InternshipCommand, schoolId = 'pu') =>
    handler({ auth: uid ? { uid } : null, data: { ...c, schoolId } });
  const create = (): InternshipCommand => ({
    action: 'create',
    id: 'record',
    ruleId: 'rule',
    ruleRevision: 1,
    organization: '測試用機構',
    teacher: '測試指導老師',
    teacherUid: 'teacher',
  });
  beforeAll(() => {
    app = initializeApp({ projectId: 'demo-career-internship' }, 'internship');
    db = getFirestore(app);
    handler = createCareerInternshipHandlers({
      db,
      now: () => new Date('2026-11-14T10:00:00.000Z'),
    });
  });
  afterAll(async () => {
    await db.terminate();
    await deleteApp(app);
  });
  beforeEach(async () => {
    await db.recursiveDelete(db.collection('schools'));
    for (const uid of ['student', 'other', 'staff', 'dept', 'wrongDept', 'teacher', 'admin'])
      await db.doc(`schools/pu/members/${uid}`).set({
        status: 'active',
        role: uid === 'admin' ? 'admin' : uid === 'teacher' ? 'teacher' : 'member',
      });
    await db.doc('schools/pu/serviceRoles/staff').set({ status: 'active', career_staff: true });
    await db
      .doc('schools/pu/serviceRoles/dept')
      .set({ status: 'active', internship_departments: ['測試系'] });
    await db
      .doc('schools/pu/serviceRoles/wrongDept')
      .set({ status: 'active', internship_departments: ['其他系'] });
    await db.doc('schools/pu/internshipRules/rule').set(internshipRule);
  });
  it('runs student creation, hours, staff document review and teacher confirmation through service', async () => {
    const student = createInternshipService('pu', (s, c) => call('student', c, s));
    await student.execute(create() as Exclude<InternshipCommand, { action: 'list' }>);
    let revision = 1;
    for (let i = 0; i < 5; i++) {
      await call('student', {
        action: 'document',
        id: 'record',
        revision: revision++,
        index: i,
        url: 'https://example.test/proof',
        submitted: true,
      });
      await call('dept', {
        action: 'verifyDocument',
        id: 'record',
        revision: revision++,
        index: i,
        verified: true,
        message: '',
      });
    }
    for (let i = 0; i < 3; i++) {
      await call('student', {
        action: 'hours',
        id: 'record',
        revision: revision++,
        entry: { id: `h${i}`, date: `2026-11-${10 + i}`, hours: 20, note: '測試佐證' },
      });
      await call('staff', {
        action: 'verifyHours',
        id: 'record',
        revision: revision++,
        entryId: `h${i}`,
        verified: true,
      });
    }
    await expect(
      call('staff', { action: 'confirm', id: 'record', revision }),
    ).rejects.toMatchObject({ code: 'permission-denied' });
    await call('teacher', { action: 'confirm', id: 'record', revision: revision++ });
    expect((await student.load('student')).records[0]).toMatchObject({ confirmed: true, revision });
    expect((await db.collection('schools/pu/adminLogs').get()).size).toBe(18);
  });
  it('coalesces duplicate creation at transaction level and rejects stale concurrent writes', async () => {
    await Promise.all([call('student', create()), call('student', create())]);
    expect((await db.collection('schools/pu/internshipRecords').get()).size).toBe(1);
    const results = await Promise.allSettled(
      [1, 2].map((i) =>
        call('student', {
          action: 'hours',
          id: 'record',
          revision: 1,
          entry: { id: `h${i}`, date: '2026-11-13', hours: 2, note: '測試' },
        }),
      ),
    );
    expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((x) => x.status === 'rejected')).toHaveLength(1);
  }, 30000);
  it('limits students, department staff and teacher to assigned records; ops omits personal data', async () => {
    await call('student', create());
    expect(
      (await call('other', { action: 'list', audience: 'student' })).snapshot?.records,
    ).toEqual([]);
    expect(
      (await call('wrongDept', { action: 'list', audience: 'staff' })).snapshot?.records,
    ).toEqual([]);
    for (const uid of ['teacher', 'dept', 'staff'])
      expect(
        (await call(uid, { action: 'list', audience: uid === 'teacher' ? 'student' : 'staff' }))
          .snapshot?.records,
      ).toHaveLength(1);
    expect((await call('admin', { action: 'list', audience: 'ops' })).snapshot?.records).toEqual(
      [],
    );
    await expect(
      call('staff', { action: 'list', audience: 'staff' }, 'other'),
    ).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(call(null, { action: 'list', audience: 'student' })).rejects.toMatchObject({
      code: 'unauthenticated',
    });
    await expect(call('other', { action: 'list', audience: 'staff' })).rejects.toMatchObject({
      code: 'permission-denied',
    });
    await expect(
      call('wrongDept', {
        action: 'verifyHours',
        id: 'record',
        revision: 1,
        entryId: 'h',
        verified: true,
      }),
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });
  it('snapshots department rules, prevents out-of-department editing and stale rule creation', async () => {
    await call('student', create());
    await call('dept', { action: 'rule', rule: { ...internshipRule, credits: 2 } });
    expect(
      (await call('student', { action: 'list', audience: 'student' })).snapshot?.records[0].rule
        .credits,
    ).toBe(1);
    await expect(
      call('student', { ...create(), id: 'new' } as InternshipCommand),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
    await expect(
      call('wrongDept', { action: 'rule', rule: { ...internshipRule, revision: 2 } }),
    ).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(
      call('staff', { action: 'rule', rule: { ...internshipRule, hoursPerCredit: 59 } }),
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });
  it.each([0, -1, 25, 1.1, NaN])('rejects invalid hours %s', async (hours) => {
    await call('student', create());
    await expect(
      call('student', {
        action: 'hours',
        id: 'record',
        revision: 1,
        entry: { id: 'h', date: '2026-11-13', hours, note: '測試' },
      }),
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });
  it('rejects daily overflow, future dates, unsubmitted document review, premature final confirmation', async () => {
    const r = internshipRecord();
    r.hours = [{ id: 'old', date: '2026-11-13', hours: 20, note: '測試', verified: false }];
    await db.doc('schools/pu/internshipRecords/record').set(r);
    for (const entry of [
      { id: 'new', date: '2026-11-13', hours: 5, note: '測試' },
      { id: 'new', date: '2026-11-15', hours: 1, note: '測試' },
    ])
      await expect(
        call('student', { action: 'hours', id: 'record', revision: 1, entry }),
      ).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(
      call('staff', {
        action: 'verifyDocument',
        id: 'record',
        revision: 1,
        index: 0,
        verified: true,
        message: '',
      }),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
    await expect(
      call('teacher', { action: 'confirm', id: 'record', revision: 1 }),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });
  it('returns document corrections, prevents student verification and reevaluates revoked privileges', async () => {
    await call('student', create());
    await call('student', {
      action: 'document',
      id: 'record',
      revision: 1,
      index: 0,
      url: 'https://example.test/proof',
      submitted: true,
    });
    await call('dept', {
      action: 'verifyDocument',
      id: 'record',
      revision: 2,
      index: 0,
      verified: false,
      message: '請補簽名',
    });
    expect(
      (await call('student', { action: 'list', audience: 'student' })).snapshot?.records[0]
        .documents[0].message,
    ).toBe('請補簽名');
    await expect(
      call('student', {
        action: 'verifyDocument',
        id: 'record',
        revision: 3,
        index: 0,
        verified: true,
        message: '',
      }),
    ).rejects.toMatchObject({ code: 'permission-denied' });
    await db.doc('schools/pu/serviceRoles/dept').update({ status: 'inactive' });
    await expect(
      call('dept', {
        action: 'verifyDocument',
        id: 'record',
        revision: 3,
        index: 0,
        verified: true,
        message: '',
      }),
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });
  it('allows removal of mistaken unverified entries but requires staff to revoke verified hours first', async () => {
    const r = internshipRecord();
    r.hours = [{ id: 'h', date: '2026-11-13', hours: 8, note: '測試', verified: true }];
    await db.doc('schools/pu/internshipRecords/record').set(r);
    await expect(
      call('student', { action: 'removeHours', id: 'record', revision: 1, entryId: 'h' }),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
    await call('staff', {
      action: 'verifyHours',
      id: 'record',
      revision: 1,
      entryId: 'h',
      verified: false,
    });
    await call('student', { action: 'removeHours', id: 'record', revision: 2, entryId: 'h' });
    expect(
      (await call('student', { action: 'list', audience: 'student' })).snapshot?.records[0].hours,
    ).toEqual([]);
  });
  it('rejects client-forged identity fields and unsafe proof links', async () => {
    await call('student', create());
    await expect(
      call('student', {
        action: 'document',
        id: 'record',
        revision: 1,
        index: 0,
        url: 'javascript:alert(1)',
        submitted: true,
      }),
    ).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(call('other', create())).rejects.toMatchObject({ code: 'already-exists' });
  });
});

// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initializeApp, deleteApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { createCareerWorkstudyHandlers } from './careerWorkstudyHandlers';
import { createWorkstudyService, type CareerCommand } from '@campus/shared/src/careerWorkstudy';
import { opportunity } from '@campus/shared/testFixtures/careerWorkstudy';
const host = process.env.FIRESTORE_EMULATOR_HOST || '';
const suite = /^(127\.0\.0\.1|localhost):\d+$/.test(host) ? describe : describe.skip;
suite('career transactions against the real Firestore emulator', () => {
  let app: App, db: Firestore, handler: ReturnType<typeof createCareerWorkstudyHandlers>;
  const at = '2026-11-14T10:00:00.000Z';
  const command = (uid: string | null, data: CareerCommand, schoolId = 'pu') =>
    handler({ auth: uid ? { uid } : null, data: { ...data, schoolId } });
  const apply = (revision = 1, confirmed = true): CareerCommand => ({
    action: 'apply',
    opportunityId: opportunity.id,
    revision,
    confirmed,
    contact: 'student@example.test',
    introduction: '測試',
  });
  beforeAll(() => {
    app = initializeApp({ projectId: 'demo-career-workstudy' }, 'career-workstudy');
    db = getFirestore(app);
    handler = createCareerWorkstudyHandlers({ db, now: () => new Date(at) });
  });
  afterAll(async () => {
    await db.terminate();
    await deleteApp(app);
  });
  beforeEach(async () => {
    await db.recursiveDelete(db.collection('schools'));
    for (const uid of ['student', 'other', 'staff', 'admin'])
      await db
        .doc(`schools/pu/members/${uid}`)
        .set({ status: 'active', role: uid === 'admin' ? 'admin' : 'member' });
    await db.doc('schools/pu/serviceRoles/staff').set({ status: 'active', career_staff: true });
    await db.doc(`schools/pu/careerOpportunities/${opportunity.id}`).set(opportunity);
  });
  it.each([false, true])('preserves an omitted reply and only clears an explicit empty reply (%s)', async (clear) => {
    const created = await command('student', apply());
    const ref = db.doc(`schools/pu/careerApplications/${created.id}`);
    await ref.update({ state: 'interview', message: '12/1 職產處，請洽承辦' });
    await command('staff', {
      action: 'review', applicationId: created.id!, revision: 1, state: 'accepted',
      ...(clear ? { message: '' } : {}),
    });
    expect((await ref.get()).data()).toMatchObject({
      state: 'accepted', message: clear ? '' : '12/1 職產處，請洽承辦', revision: 2,
    });
  });
  it('runs service -> apply -> review -> refreshed student receipt; retains exact confirmed rights', async () => {
    const student = createWorkstudyService('pu', (schoolId, data) =>
      handler({ auth: { uid: 'student' }, data: { ...data, schoolId } }),
    );
    expect((await student.load('student')).opportunities).toHaveLength(1);
    const created = await student.execute(apply() as Exclude<CareerCommand, { action: 'list' }>);
    let receipt = (await student.load('student')).applications[0];
    expect(receipt).toMatchObject({
      id: created.id,
      state: 'submitted',
      uid: 'student',
      rights: { text: opportunity.rightsText, confirmedAt: at, revision: 1 },
    });
    for (const [index, state] of (['read', 'interview', 'accepted'] as const).entries()) {
      await command('staff', {
        action: 'review',
        applicationId: created.id!,
        revision: index + 1,
        state,
        message: '測試面談時間與地點',
      });
    }
    receipt = (await student.load('student')).applications[0];
    expect(receipt.state).toBe('accepted');
    const audit = await db.collection('schools/pu/adminLogs').get();
    expect(audit.size).toBe(4);
    expect(audit.docs[0].data().createdAt.toDate().toISOString()).toBe(at);
  });
  it('allows visitors to see only published openings and no application data', async () => {
    await command('student', apply());
    await db
      .doc('schools/pu/careerOpportunities/hidden')
      .set({ ...opportunity, id: 'hidden', published: false });
    const result = await command(null, { action: 'list', audience: 'student' });
    expect(result.snapshot?.opportunities.map((o) => o.id)).toEqual([opportunity.id]);
    expect(result.snapshot?.applications).toEqual([]);
    await expect(command(null, apply())).rejects.toMatchObject({ code: 'unauthenticated' });
  });
  it('never returns another student’s application or allows forged staff audience', async () => {
    await command('student', apply());
    expect(
      (await command('other', { action: 'list', audience: 'student' })).snapshot?.applications,
    ).toEqual([]);
    await expect(command('other', { action: 'list', audience: 'staff' })).rejects.toMatchObject({
      code: 'permission-denied',
    });
    await expect(command('staff', { action: 'list', audience: 'ops' })).rejects.toMatchObject({
      code: 'permission-denied',
    });
  });
  it('isolates schools, inactive memberships and revoked service assignments', async () => {
    await expect(
      command('staff', { action: 'save', opportunity }, 'other-school'),
    ).rejects.toMatchObject({ code: 'permission-denied' });
    await db.doc('schools/pu/serviceRoles/staff').update({ status: 'inactive' });
    await expect(command('staff', { action: 'save', opportunity })).rejects.toMatchObject({
      code: 'permission-denied',
    });
    await db.doc('schools/pu/members/student').update({ status: 'inactive' });
    await expect(command('student', apply())).rejects.toMatchObject({ code: 'permission-denied' });
  });
  it('requires a current rights revision and affirmative consent', async () => {
    await expect(command('student', apply(0))).rejects.toMatchObject({
      code: 'failed-precondition',
    });
    await expect(command('student', apply(1, false))).rejects.toMatchObject({
      code: 'failed-precondition',
    });
    expect((await db.collection('schools/pu/careerApplications').get()).size).toBe(0);
    expect((await db.collection('schools/pu/adminLogs').get()).size).toBe(0);
  });
  it.each([{ published: false }, { deadline: at }, { type: 'internship' }])(
    'rejects a closed/unavailable/wrong type opportunity: %j',
    async (patch) => {
      await db.doc(`schools/pu/careerOpportunities/${opportunity.id}`).update(patch);
      await expect(command('student', apply())).rejects.toMatchObject({
        code: 'failed-precondition',
      });
    },
  );
  it('deduplicates concurrent submissions and preserves the original receipt after closing', async () => {
    const receipts = await Promise.all([command('student', apply()), command('student', apply())]);
    expect(receipts[0].id).toBe(receipts[1].id);
    expect((await db.collection('schools/pu/careerApplications').get()).size).toBe(1);
    expect((await db.collection('schools/pu/adminLogs').get()).size).toBe(1);
    await db
      .doc(`schools/pu/careerOpportunities/${opportunity.id}`)
      .update({ published: false, revision: 2 });
    expect((await command('student', apply())).id).toBe(receipts[0].id);
  });
  it('serializes concurrent reviews; blocks skipped, backward and terminal transitions', async () => {
    const { id } = await command('student', apply());
    await expect(
      command('staff', {
        action: 'review',
        applicationId: id!,
        revision: 1,
        state: 'accepted',
        message: '',
      }),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
    const results = await Promise.allSettled(
      [1, 2].map(() =>
        command('staff', {
          action: 'review',
          applicationId: id!,
          revision: 1,
          state: 'read',
          message: '',
        }),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    await expect(
      command('staff', {
        action: 'review',
        applicationId: id!,
        revision: 2,
        state: 'interview',
        message: '',
      }),
    ).rejects.toMatchObject({ code: 'invalid-argument' });
    await command('staff', {
      action: 'review',
      applicationId: id!,
      revision: 2,
      state: 'rejected',
      message: '測試回覆',
    });
    await expect(
      command('staff', {
        action: 'review',
        applicationId: id!,
        revision: 3,
        state: 'read',
        message: '',
      }),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });
  it('publishes and unpublishes with revision checks and audit, without deleting applications', async () => {
    await command('student', apply());
    await command('staff', { action: 'save', opportunity: { ...opportunity, published: false } });
    const publicResult = await command(null, { action: 'list', audience: 'student' });
    expect(publicResult.snapshot?.opportunities).toEqual([]);
    expect(
      (await command('student', { action: 'list', audience: 'student' })).snapshot?.applications,
    ).toHaveLength(1);
    await expect(command('staff', { action: 'save', opportunity })).rejects.toMatchObject({
      code: 'aborted',
    });
    await command('staff', { action: 'save', opportunity: { ...opportunity, revision: 2 } });
    expect((await db.collection('schools/pu/adminLogs').get()).size).toBe(3);
  });
  it.each([
    { sourceUrl: 'https://evil.example/' },
    { rightsUrl: 'javascript:alert(1)' },
    { rightsText: '' },
    { places: -1 },
    { deadline: '2099-02-31T09:00:00.000Z' },
    { slots: [{ day: 1, start: '10:00', end: '09:00' }] },
  ])('rejects invalid publication without writing: %j', async (patch) => {
    await expect(
      command('staff', { action: 'save', opportunity: { ...opportunity, ...patch } }),
    ).rejects.toMatchObject({ code: 'invalid-argument' });
    expect((await db.doc(`schools/pu/careerOpportunities/${opportunity.id}`).get()).data()).toEqual(
      opportunity,
    );
    expect((await db.collection('schools/pu/adminLogs').get()).size).toBe(0);
  });
  it('allows only the school admin to change sources and inspect audit; no module kill switch', async () => {
    const sources = { office: true, departments: false, taiwanjobs: true, revision: 0 };
    await expect(command('staff', { action: 'sources', sources })).rejects.toMatchObject({
      code: 'permission-denied',
    });
    await command('admin', { action: 'sources', sources });
    const result = await command('admin', { action: 'list', audience: 'ops' });
    expect(result.snapshot?.sources).toEqual({ ...sources, revision: 1 });
    expect(result.snapshot?.audit).toHaveLength(1);
    expect(result.snapshot?.applications).toEqual([]);
    await expect(command('admin', { action: 'sources', sources })).rejects.toMatchObject({
      code: 'aborted',
    });
    expect(
      (await command(null, { action: 'list', audience: 'student' })).snapshot?.opportunities,
    ).toHaveLength(1);
  });
  it('uses only this school’s existing career-category events and preserves registration source', async () => {
    await db
      .doc('schools/pu/clubEvents/career')
      .set({ title: '測試職涯講座', category: 'career', startsAt: '2099-01-01T00:00:00Z' });
    await db
      .doc('schools/pu/events/career')
      .set({ title: '測試校徵', category: 'career', startsAt: '2099-01-02T00:00:00Z' });
    await db.doc('schools/pu/clubEvents/other').set({ title: '其他類別', category: 'sports' });
    await db.doc('schools/other/events/career').set({ title: '別校活動', category: 'career' });
    const result = await command('staff', { action: 'list', audience: 'staff' });
    expect(result.snapshot?.events.map((e) => e.title)).toEqual(['測試職涯講座', '測試校徵']);
    expect(result.snapshot?.events[0].source).toBe('school-club-events');
  });
  it('does not accept caller supplied identity or initial application status', async () => {
    const { id } = await handler({
      auth: { uid: 'student' },
      data: { ...apply(), schoolId: 'pu', uid: 'other', state: 'accepted' },
    });
    expect((await db.doc(`schools/pu/careerApplications/${id}`).get()).data()).toMatchObject({
      uid: 'student',
      state: 'submitted',
    });
  });
});

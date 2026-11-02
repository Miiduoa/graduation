'use strict';

const {
  FANOUT_BATCH_SIZE,
  hashEventKey,
  claimNotificationEvent,
  releaseNotificationClaim,
  createAssignmentPublishedNotifyHandler,
  createSubmissionNotifyHandler,
  createSchoolAnnouncementNotifyHandler,
} = require('./coherenceNotify');

function memoryDb(seed = {}) {
  const docs = new Map(Object.entries(seed));
  const api = {
    docs,
    collection(name) {
      return {
        doc(id) {
          const path = `${name}/${id}`;
          return makeRef(api, path);
        },
      };
    },
  };
  return api;
}

function makeRef(db, path) {
  return {
    path,
    id: path.split('/').pop(),
    collection(sub) {
      return {
        doc(id) {
          return makeRef(db, `${path}/${sub}/${id}`);
        },
        where() {
          return {
            async get() {
              const memberPrefix = `${path}/members/`;
              const memberRows = [...db.docs.entries()]
                .filter(
                  ([key]) =>
                    key.startsWith(memberPrefix) && !key.slice(memberPrefix.length).includes('/'),
                )
                .map(([key, data]) => ({
                  id: key.slice(memberPrefix.length),
                  data: () => data,
                }));
              return { docs: memberRows };
            },
          };
        },
        async get() {
          const prefix = `${path}/`;
          const rows = [...db.docs.entries()]
            .filter(([key]) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'))
            .map(([key, data]) => ({ id: key.slice(prefix.length), data: () => data }));
          return { docs: rows };
        },
      };
    },
    async get() {
      if (!db.docs.has(path)) return { exists: false, data: () => undefined, id: this.id };
      return { exists: true, data: () => db.docs.get(path), id: this.id };
    },
    async create(data) {
      if (db.docs.has(path)) {
        const error = new Error('ALREADY_EXISTS');
        error.code = 6;
        throw error;
      }
      db.docs.set(path, { ...data });
    },
    async set(data) {
      const prev = db.docs.get(path) || {};
      db.docs.set(path, { ...prev, ...data });
    },
    async delete() {
      db.docs.delete(path);
    },
  };
}

describe('claimNotificationEvent', () => {
  test('first claim wins; retry is duplicate; stores original eventKey under sha256 id', async () => {
    const db = memoryDb();
    expect(await claimNotificationEvent(db, 'evt_1', { kind: 't' })).toBe(true);
    expect(await claimNotificationEvent(db, 'evt_1', { kind: 't' })).toBe(false);
    const docId = hashEventKey('evt_1');
    expect(db.docs.has(`notificationClaims/${docId}`)).toBe(true);
    expect(db.docs.get(`notificationClaims/${docId}`).eventKey).toBe('evt_1');
  });

  test('long eventKey is claimed via sha256 instead of silent duplicate', async () => {
    const db = memoryDb();
    const longKey = `assignment_submission__${'g'.repeat(40)}__${'a'.repeat(40)}__${'u'.repeat(28)}`;
    expect(longKey.length).toBeGreaterThan(128);
    expect(await claimNotificationEvent(db, longKey, { kind: 'assignment_submission' })).toBe(
      true,
    );
    expect(await claimNotificationEvent(db, longKey, { kind: 'assignment_submission' })).toBe(
      false,
    );
    const docId = hashEventKey(longKey);
    expect(docId).toHaveLength(64);
    expect(db.docs.get(`notificationClaims/${docId}`).eventKey).toBe(longKey);
  });

  test('release allows reclaim after failure', async () => {
    const db = memoryDb();
    expect(await claimNotificationEvent(db, 'evt_rel', {})).toBe(true);
    await releaseNotificationClaim(db, 'evt_rel');
    expect(await claimNotificationEvent(db, 'evt_rel', {})).toBe(true);
  });
});

describe('assignment published notify', () => {
  test('notifies active students once with assignment deep-link data', async () => {
    const db = memoryDb({
      'groups/c1/members/stu1': { status: 'active', role: 'student' },
      'groups/c1/members/stu2': { status: 'active', role: 'member' },
      'groups/c1/members/teach': { status: 'active', role: 'instructor' },
    });
    const pushes = [];
    const handler = createAssignmentPublishedNotifyHandler({
      db,
      sendPushToUser: async (uid, note, data, category) => {
        pushes.push({ uid, note, data, category });
      },
    });
    const event = {
      params: { groupId: 'c1', assignmentId: 'a1' },
      data: {
        data: () => ({
          title: '作業一',
          type: 'assignment',
          published: true,
          status: 'published',
          createdBy: 'teach',
          schoolId: 'pu',
        }),
      },
    };
    expect(await handler(event)).toMatchObject({ status: 'sent', recipients: 2 });
    expect(await handler(event)).toMatchObject({ status: 'duplicate' });
    expect(pushes).toHaveLength(2);
    expect(pushes.map((row) => row.uid).sort()).toEqual(['stu1', 'stu2']);
    expect(pushes[0].data).toMatchObject({
      type: 'assignment',
      groupId: 'c1',
      assignmentId: 'a1',
      schoolId: 'pu',
    });
    const inboxId = hashEventKey('assignment_published__c1__a1');
    expect(db.docs.has(`users/stu1/notifications/${inboxId}`)).toBe(true);
  });

  test('partial push failure releases unfinished claims; retry only fills gaps', async () => {
    const db = memoryDb({
      'groups/c1/members/stu1': { status: 'active', role: 'student' },
      'groups/c1/members/stu2': { status: 'active', role: 'student' },
      'groups/c1/members/stu3': { status: 'active', role: 'student' },
    });
    let attempt = 0;
    const pushes = [];
    const handler = createAssignmentPublishedNotifyHandler({
      db,
      sendPushToUser: async (uid, note, data) => {
        if (attempt === 0 && uid === 'stu2') {
          throw new Error('push unavailable');
        }
        pushes.push({ uid, note, data });
      },
    });
    const event = {
      params: { groupId: 'c1', assignmentId: 'a2' },
      data: {
        data: () => ({
          title: '作業二',
          type: 'assignment',
          published: true,
          createdBy: 'teach',
          schoolId: 'pu',
        }),
      },
    };

    await expect(handler(event)).rejects.toThrow(/push unavailable/);
    attempt = 1;
    // stu1 已送達應保留 claim；stu2／stu3 應可補送
    expect(await handler(event)).toMatchObject({ status: 'sent', recipients: 2 });
    expect(pushes.map((row) => row.uid).sort()).toEqual(['stu1', 'stu2', 'stu3']);
    expect(await handler(event)).toMatchObject({ status: 'duplicate' });
  });
});

describe('submission notify', () => {
  test('student submit notifies teacher; grade publish notifies student', async () => {
    const db = memoryDb({
      'groups/c1/assignments/a1': {
        title: '作業一',
        createdBy: 'teach',
        schoolId: 'pu',
        type: 'assignment',
      },
    });
    const pushes = [];
    const handler = createSubmissionNotifyHandler({
      db,
      sendPushToUser: async (uid, note, data, category) => {
        pushes.push({ uid, note, data, category });
      },
    });

    await handler({
      params: { groupId: 'c1', assignmentId: 'a1', studentUid: 'stu1' },
      data: {
        before: { data: () => ({}) },
        after: {
          data: () => ({
            userId: 'stu1',
            submittedAt: { seconds: 1 },
          }),
        },
      },
    });
    expect(pushes).toHaveLength(1);
    expect(pushes[0]).toMatchObject({
      uid: 'teach',
      data: { type: 'assignment_submission', groupId: 'c1', assignmentId: 'a1' },
    });

    await handler({
      params: { groupId: 'c1', assignmentId: 'a1', studentUid: 'stu1' },
      data: {
        before: {
          data: () => ({ userId: 'stu1', submittedAt: { seconds: 1 } }),
        },
        after: {
          data: () => ({
            userId: 'stu1',
            submittedAt: { seconds: 1 },
            gradePublished: true,
            gradeScore: 95,
          }),
        },
      },
    });
    expect(pushes).toHaveLength(2);
    expect(pushes[1]).toMatchObject({
      uid: 'stu1',
      data: { type: 'feedback', groupId: 'c1', assignmentId: 'a1', channel: 'grades' },
    });

    // idempotent re-entry
    await handler({
      params: { groupId: 'c1', assignmentId: 'a1', studentUid: 'stu1' },
      data: {
        before: {
          data: () => ({ userId: 'stu1', submittedAt: { seconds: 1 } }),
        },
        after: {
          data: () => ({
            userId: 'stu1',
            submittedAt: { seconds: 1 },
            gradePublished: true,
            gradeScore: 95,
          }),
        },
      },
    });
    expect(pushes).toHaveLength(2);
  });

  test('long composite eventKey still delivers submission notify', async () => {
    const groupId = 'g'.repeat(40);
    const assignmentId = 'a'.repeat(40);
    const studentUid = 's'.repeat(28);
    const eventKey = `assignment_submission__${groupId}__${assignmentId}__${studentUid}`;
    expect(eventKey.length).toBeGreaterThan(128);

    const db = memoryDb({
      [`groups/${groupId}/assignments/${assignmentId}`]: {
        title: '長鍵作業',
        createdBy: 'teach',
        schoolId: 'pu',
      },
    });
    const pushes = [];
    const handler = createSubmissionNotifyHandler({
      db,
      sendPushToUser: async (uid, note, data) => {
        pushes.push({ uid, note, data });
      },
    });

    await handler({
      params: { groupId, assignmentId, studentUid },
      data: {
        before: { data: () => ({}) },
        after: { data: () => ({ userId: studentUid, submittedAt: { seconds: 1 } }) },
      },
    });
    expect(pushes).toHaveLength(1);
    expect(pushes[0].uid).toBe('teach');
    expect(db.docs.has(`notificationClaims/${hashEventKey(eventKey)}`)).toBe(true);
  });
});

describe('school announcement notify', () => {
  test('notifies school audience with announcementId deep link', async () => {
    const db = memoryDb({
      'schools/pu/members/stu1': { status: 'active', role: 'student' },
      'schools/pu/members/teach': { status: 'active', role: 'teacher' },
      'schools/pu/members/admin1': { status: 'active', role: 'admin' },
    });
    const pushes = [];
    const handler = createSchoolAnnouncementNotifyHandler({
      db,
      sendPushToUser: async (uid, note, data) => {
        pushes.push({ uid, note, data });
      },
    });
    const event = {
      params: { schoolId: 'pu', announcementId: 'ann1' },
      data: {
        data: () => ({
          title: '停課通知',
          body: '明日停課',
          createdBy: 'admin1',
        }),
      },
    };
    expect(await handler(event)).toMatchObject({ status: 'sent', recipients: 2 });
    expect(await handler(event)).toMatchObject({ status: 'duplicate' });
    expect(pushes.map((row) => row.uid).sort()).toEqual(['stu1', 'teach']);
    expect(pushes[0].data).toMatchObject({
      type: 'announcement',
      announcementId: 'ann1',
      schoolId: 'pu',
    });
  });

  test('empty role is excluded from campus audience allowlist', async () => {
    const db = memoryDb({
      'schools/pu/members/stu1': { status: 'active', role: 'student' },
      'schools/pu/members/norole': { status: 'active', role: '' },
      'schools/pu/members/missing': { status: 'active' },
      'schools/pu/members/vendor1': { status: 'active', role: 'vendor' },
      'schools/pu/members/admin1': { status: 'active', role: 'admin' },
    });
    const pushes = [];
    const handler = createSchoolAnnouncementNotifyHandler({
      db,
      sendPushToUser: async (uid, note, data) => {
        pushes.push({ uid, note, data });
      },
    });
    const event = {
      params: { schoolId: 'pu', announcementId: 'ann2' },
      data: {
        data: () => ({
          title: '公告',
          body: '內容',
          createdBy: 'admin1',
        }),
      },
    };
    expect(await handler(event)).toMatchObject({ status: 'sent', recipients: 1 });
    expect(pushes.map((row) => row.uid)).toEqual(['stu1']);
  });

  test('large audience is fanout in batches of at most 1000 via sendPushToMultipleUsers', async () => {
    const seed = {
      'schools/pu/members/admin1': { status: 'active', role: 'admin' },
    };
    const totalStudents = FANOUT_BATCH_SIZE + 25;
    for (let i = 0; i < totalStudents; i += 1) {
      seed[`schools/pu/members/stu${String(i).padStart(4, '0')}`] = {
        status: 'active',
        role: 'student',
      };
    }
    const db = memoryDb(seed);
    const batchSizes = [];
    const handler = createSchoolAnnouncementNotifyHandler({
      db,
      sendPushToUser: async () => {
        throw new Error('should use sendPushToMultipleUsers');
      },
      sendPushToMultipleUsers: async (uids) => {
        batchSizes.push(uids.length);
        expect(uids.length).toBeLessThanOrEqual(FANOUT_BATCH_SIZE);
        return uids.map((uid) => ({ uid, status: 'accepted', accepted: 1, failed: 0 }));
      },
    });
    const result = await handler({
      params: { schoolId: 'pu', announcementId: 'ann-big' },
      data: {
        data: () => ({
          title: '全校公告',
          body: '測試分批',
          createdBy: 'admin1',
        }),
      },
    });
    expect(result).toMatchObject({ status: 'sent', recipients: totalStudents });
    expect(batchSizes.length).toBeGreaterThanOrEqual(2);
    expect(Math.max(...batchSizes)).toBeLessThanOrEqual(FANOUT_BATCH_SIZE);
    expect(batchSizes.reduce((sum, n) => sum + n, 0)).toBe(totalStudents);
  });

  test('partial fanout failure then retry only delivers remaining recipients', async () => {
    const db = memoryDb({
      'schools/pu/members/stu1': { status: 'active', role: 'student' },
      'schools/pu/members/stu2': { status: 'active', role: 'student' },
      'schools/pu/members/stu3': { status: 'active', role: 'teacher' },
      'schools/pu/members/admin1': { status: 'active', role: 'admin' },
    });
    let attempt = 0;
    const pushes = [];
    const handler = createSchoolAnnouncementNotifyHandler({
      db,
      sendPushToUser: async (uid, note, data) => {
        if (attempt === 0 && uid === 'stu2') {
          throw new Error('transient push error');
        }
        pushes.push(uid);
      },
    });
    const event = {
      params: { schoolId: 'pu', announcementId: 'ann3' },
      data: {
        data: () => ({
          title: '補送測試',
          body: '內容',
          createdBy: 'admin1',
        }),
      },
    };

    await expect(handler(event)).rejects.toThrow(/transient push error/);
    attempt = 1;
    expect(await handler(event)).toMatchObject({ status: 'sent', recipients: 2 });
    expect([...pushes].sort()).toEqual(['stu1', 'stu2', 'stu3']);
    expect(await handler(event)).toMatchObject({ status: 'duplicate' });
  });
});

'use strict';

const {
  claimNotificationEvent,
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
              const prefix = `${path}/`;
              const rows = [...db.docs.entries()]
                .filter(([key]) => {
                  if (!key.startsWith(prefix)) return false;
                  const rest = key.slice(prefix.length);
                  return rest.split('/').length === 2 && rest.startsWith('members/');
                })
                .map(([key, data]) => ({
                  id: key.split('/').pop(),
                  data: () => data,
                }));
              // Prefer exact subcollection listing for members / notifications under path
              const memberPrefix = `${path}/members/`;
              const memberRows = [...db.docs.entries()]
                .filter(([key]) => key.startsWith(memberPrefix) && !key.slice(memberPrefix.length).includes('/'))
                .map(([key, data]) => ({ id: key.slice(memberPrefix.length), data: () => data }));
              if (memberRows.length || path.includes('/groups/') || path.includes('/schools/')) {
                return { docs: memberRows.length ? memberRows : rows };
              }
              return { docs: rows };
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
  };
}

describe('claimNotificationEvent', () => {
  test('first claim wins; retry is duplicate', async () => {
    const db = memoryDb();
    expect(await claimNotificationEvent(db, 'evt_1', { kind: 't' })).toBe(true);
    expect(await claimNotificationEvent(db, 'evt_1', { kind: 't' })).toBe(false);
    expect(db.docs.has('notificationClaims/evt_1')).toBe(true);
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
    expect(db.docs.has('users/stu1/notifications/assignment_published__c1__a1')).toBe(true);
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
});

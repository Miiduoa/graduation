'use strict';

const {
  FANOUT_BATCH_SIZE,
  DEFAULT_LEASE_TTL_MS,
  hashEventKey,
  claimNotificationEvent,
  completeNotificationClaim,
  releaseNotificationClaim,
  createAssignmentPublishedNotifyHandler,
  createSubmissionNotifyHandler,
  createSchoolAnnouncementNotifyHandler,
} = require('./coherenceNotify');

function memoryDb(seed = {}) {
  const docs = new Map(Object.entries(seed));
  let txChain = Promise.resolve();
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
    async runTransaction(callback) {
      // 序列化交易，模擬 Firestore 對同一文件的互斥，供併發測試使用
      const run = txChain.then(async () => {
        const base = new Map(docs);
        const writes = [];
        const tx = {
          get: async (ref) => {
            const path = ref.path;
            if (!base.has(path)) return { exists: false, data: () => undefined, id: ref.id };
            return { exists: true, data: () => ({ ...base.get(path) }), id: ref.id };
          },
          create: (ref, data) => writes.push({ type: 'create', path: ref.path, data }),
          set: (ref, data, opts = {}) =>
            writes.push({ type: 'set', path: ref.path, data, merge: !!opts.merge }),
          update: (ref, data) => writes.push({ type: 'update', path: ref.path, data }),
          delete: (ref) => writes.push({ type: 'delete', path: ref.path }),
        };
        const result = await callback(tx);
        for (const write of writes) {
          if (write.type === 'create') {
            if (docs.has(write.path)) {
              const error = new Error('ALREADY_EXISTS');
              error.code = 6;
              throw error;
            }
            docs.set(write.path, { ...write.data });
          } else if (write.type === 'set') {
            const prev = write.merge ? docs.get(write.path) || {} : {};
            docs.set(write.path, { ...prev, ...write.data });
          } else if (write.type === 'update') {
            if (!docs.has(write.path)) throw new Error('missing document');
            docs.set(write.path, { ...docs.get(write.path), ...write.data });
          } else if (write.type === 'delete') {
            docs.delete(write.path);
          }
        }
        return result;
      });
      txChain = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
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
    async set(data, opts = {}) {
      const prev = opts.merge ? db.docs.get(path) || {} : db.docs.get(path) || {};
      // merge:true 與預設皆合併既有欄位，與既有測試／inbox merge 行為一致
      db.docs.set(path, { ...prev, ...data });
    },
    async update(data) {
      if (!db.docs.has(path)) throw new Error('missing document');
      db.docs.set(path, { ...db.docs.get(path), ...data });
    },
    async delete() {
      db.docs.delete(path);
    },
  };
}

describe('claimNotificationEvent', () => {
  test('first claim wins; active lease is duplicate; stores original eventKey under sha256 id', async () => {
    const db = memoryDb();
    const t0 = 1_700_000_000_000;
    expect(
      await claimNotificationEvent(db, 'evt_1', { kind: 't' }, { nowMs: t0, leaseTtlMs: 60_000 }),
    ).toBe(true);
    expect(
      await claimNotificationEvent(db, 'evt_1', { kind: 't' }, { nowMs: t0 + 1000, leaseTtlMs: 60_000 }),
    ).toBe(false);
    const docId = hashEventKey('evt_1');
    expect(db.docs.has(`notificationClaims/${docId}`)).toBe(true);
    expect(db.docs.get(`notificationClaims/${docId}`).eventKey).toBe('evt_1');
    expect(db.docs.get(`notificationClaims/${docId}`).status).toBe('processing');
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

  test('release allows reclaim after failure; completed blocks reclaim', async () => {
    const db = memoryDb();
    expect(await claimNotificationEvent(db, 'evt_rel', {})).toBe(true);
    await releaseNotificationClaim(db, 'evt_rel');
    expect(await claimNotificationEvent(db, 'evt_rel', {})).toBe(true);
    await completeNotificationClaim(db, 'evt_rel');
    expect(await claimNotificationEvent(db, 'evt_rel', {})).toBe(false);
    await releaseNotificationClaim(db, 'evt_rel');
    expect(db.docs.get(`notificationClaims/${hashEventKey('evt_rel')}`).status).toBe('completed');
  });

  test('expired lease can be taken over; legacy claim without status is treated completed', async () => {
    const db = memoryDb();
    const t0 = 1_700_000_000_000;
    const leaseTtlMs = 10_000;
    expect(
      await claimNotificationEvent(db, 'evt_lease', {}, { nowMs: t0, leaseTtlMs }),
    ).toBe(true);
    expect(
      await claimNotificationEvent(db, 'evt_lease', {}, { nowMs: t0 + leaseTtlMs - 1, leaseTtlMs }),
    ).toBe(false);
    expect(
      await claimNotificationEvent(db, 'evt_lease', {}, { nowMs: t0 + leaseTtlMs + 1, leaseTtlMs }),
    ).toBe(true);

    const legacyKey = 'evt_legacy';
    db.docs.set(`notificationClaims/${hashEventKey(legacyKey)}`, {
      eventKey: legacyKey,
      claimedAt: { sentinel: true },
    });
    expect(await claimNotificationEvent(db, legacyKey, {}, { nowMs: t0, leaseTtlMs })).toBe(false);
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
    const claimStu1 = db.docs.get(
      `notificationClaims/${hashEventKey('assignment_published__c1__a1__uid__stu1')}`,
    );
    expect(claimStu1.status).toBe('completed');
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
    // stu1 已送達應保留 completed；stu2／stu3 應可補送
    expect(await handler(event)).toMatchObject({ status: 'sent', recipients: 2 });
    expect(pushes.map((row) => row.uid).sort()).toEqual(['stu1', 'stu2', 'stu3']);
    expect(await handler(event)).toMatchObject({ status: 'duplicate' });
  });

  test('process kill mid-fanout without release: retry after lease expiry fills gaps only', async () => {
    const db = memoryDb({
      'groups/c1/members/stu1': { status: 'active', role: 'student' },
      'groups/c1/members/stu2': { status: 'active', role: 'student' },
      'groups/c1/members/stu3': { status: 'active', role: 'student' },
    });
    let clock = 1_700_000_000_000;
    const leaseTtlMs = 30_000;
    const pushes = [];
    let simulateKill = true;
    const event = {
      params: { groupId: 'c1', assignmentId: 'a-kill' },
      data: {
        data: () => ({
          title: '中斷測試',
          type: 'assignment',
          published: true,
          createdBy: 'teach',
          schoolId: 'pu',
        }),
      },
    };
    const makeHandler = (releaseClaim) =>
      createAssignmentPublishedNotifyHandler({
        db,
        now: () => clock,
        leaseTtlMs,
        releaseClaim,
        sendPushToUser: async (uid, note, data) => {
          pushes.push({ uid, note, data });
          // stu1 已成功返回後才輪到 stu2；在此拋錯模擬進程被殺
          if (simulateKill && uid === 'stu2') {
            throw new Error('PROCESS_KILLED');
          }
        },
      });

    // release 為 no-op：模擬逾時／被殺來不及跑 release
    // stu2 在 throw 前記錄一次（未 complete）；真正送達成功的只有 stu1
    await expect(makeHandler(async () => undefined)(event)).rejects.toThrow(/PROCESS_KILLED/);
    expect(pushes.map((row) => row.uid)).toEqual(['stu1', 'stu2']);
    expect(
      db.docs.get(
        `notificationClaims/${hashEventKey('assignment_published__c1__a-kill__uid__stu1')}`,
      ).status,
    ).toBe('completed');
    expect(
      db.docs.get(
        `notificationClaims/${hashEventKey('assignment_published__c1__a-kill__uid__stu2')}`,
      ).status,
    ).toBe('processing');
    expect(
      db.docs.get(
        `notificationClaims/${hashEventKey('assignment_published__c1__a-kill__uid__stu3')}`,
      ).status,
    ).toBe('processing');

    simulateKill = false;
    const retryHandler = makeHandler(releaseNotificationClaim);
    // lease 未過期：略過 processing，不重送 completed
    expect(await retryHandler(event)).toMatchObject({ status: 'duplicate', recipients: 0 });
    expect(pushes.map((row) => row.uid)).toEqual(['stu1', 'stu2']);

    // lease 過期後接手補送 stu2／stu3，不重發 stu1
    clock += leaseTtlMs + 1;
    expect(await retryHandler(event)).toMatchObject({ status: 'sent', recipients: 2 });
    expect(pushes.map((row) => row.uid).sort()).toEqual(['stu1', 'stu2', 'stu2', 'stu3']);
    expect(pushes.filter((row) => row.uid === 'stu1')).toHaveLength(1);
    expect(pushes.filter((row) => row.uid === 'stu2')).toHaveLength(2); // 中斷一次 + 補送一次
    expect(pushes.filter((row) => row.uid === 'stu3')).toHaveLength(1);
    expect(await retryHandler(event)).toMatchObject({ status: 'duplicate' });
  });

  test('expired lease takeover delivers remaining recipient', async () => {
    const db = memoryDb({
      'groups/c1/members/stu1': { status: 'active', role: 'student' },
    });
    const leaseTtlMs = 5_000;
    let clock = 1_000_000;
    const eventKey = 'assignment_published__c1__a-expire';
    await claimNotificationEvent(
      db,
      `${eventKey}__uid__stu1`,
      { uid: 'stu1' },
      { nowMs: clock, leaseTtlMs },
    );
    const pushes = [];
    const handler = createAssignmentPublishedNotifyHandler({
      db,
      now: () => clock,
      leaseTtlMs,
      sendPushToUser: async (uid) => {
        pushes.push(uid);
      },
    });
    const event = {
      params: { groupId: 'c1', assignmentId: 'a-expire' },
      data: {
        data: () => ({
          title: '過期接手',
          type: 'assignment',
          published: true,
          createdBy: 'teach',
          schoolId: 'pu',
        }),
      },
    };
    expect(await handler(event)).toMatchObject({ status: 'duplicate' });
    clock += leaseTtlMs + 1;
    expect(await handler(event)).toMatchObject({ status: 'sent', recipients: 1 });
    expect(pushes).toEqual(['stu1']);
  });

  test('concurrent fanout executions do not double-send', async () => {
    const db = memoryDb({
      'groups/c1/members/stu1': { status: 'active', role: 'student' },
      'groups/c1/members/stu2': { status: 'active', role: 'student' },
    });
    const pushes = [];
    let gate = null;
    let releaseGate = null;
    const handler = createAssignmentPublishedNotifyHandler({
      db,
      sendPushToUser: async (uid, note, data) => {
        if (uid === 'stu1' && !gate) {
          gate = new Promise((resolve) => {
            releaseGate = resolve;
          });
          await gate;
        }
        pushes.push({ uid, note, data });
      },
    });
    const event = {
      params: { groupId: 'c1', assignmentId: 'a-conc' },
      data: {
        data: () => ({
          title: '併發',
          type: 'assignment',
          published: true,
          createdBy: 'teach',
          schoolId: 'pu',
        }),
      },
    };

    const runA = handler(event);
    // 等 A 取得 lease 並卡在 stu1 push
    for (let i = 0; i < 50 && !releaseGate; i += 1) {
      await new Promise((r) => setImmediate(r));
    }
    expect(typeof releaseGate).toBe('function');
    const runB = handler(event);
    releaseGate();
    const [resultA, resultB] = await Promise.all([runA, runB]);
    const statuses = [resultA.status, resultB.status].sort();
    expect(statuses).toEqual(['duplicate', 'sent']);
    expect(pushes.map((row) => row.uid).sort()).toEqual(['stu1', 'stu2']);
    expect(pushes).toHaveLength(2);
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
    expect(db.docs.get(`notificationClaims/${hashEventKey(eventKey)}`).status).toBe('completed');
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
      sendPushToUser: async (uid) => {
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

describe('lease defaults', () => {
  test('DEFAULT_LEASE_TTL_MS is positive', () => {
    expect(DEFAULT_LEASE_TTL_MS).toBeGreaterThan(0);
  });
});

'use strict';

const {
  paramsFromPath,
  policyFor,
  startFirestoreTriggerRunner,
  tryAcquireLease,
} = require('./firestoreTriggerRunner');

function stamp(ms) {
  return {
    toMillis: () => ms,
    toDate: () => new Date(ms),
    isEqual(other) {
      return other?.toMillis?.() === ms;
    },
  };
}

function makeRef(path) {
  const segments = path.split('/').filter(Boolean);
  return {
    path,
    id: segments[segments.length - 1],
    parent: segments.length > 1 ? { id: segments[segments.length - 2] } : null,
  };
}

function docSnap(path, data, ms, exists = true) {
  const ref = makeRef(path);
  return {
    id: ref.id,
    ref,
    exists,
    data: () => (exists ? data : undefined),
    updateTime: exists ? stamp(ms) : undefined,
  };
}

function snapshotOf(changes) {
  return {
    docChanges: () => changes,
  };
}

function createMemoryDb() {
  const store = new Map();
  const listeners = new Map();

  function recordToSnap(path, rec) {
    const ref = makeRef(path);
    if (!rec) {
      return { exists: false, id: ref.id, ref, data: () => undefined };
    }
    return {
      exists: true,
      id: ref.id,
      ref,
      data: () => rec.data,
      updateTime: rec.updateTime,
    };
  }

  function makeDoc(path) {
    return {
      path,
      id: path.split('/').pop(),
      collection(name) {
        return makeCollection(`${path}/${name}`);
      },
      async get() {
        return recordToSnap(path, store.get(path));
      },
      async set(data, opts = {}) {
        const prev = store.get(path);
        store.set(path, {
          data: opts.merge && prev ? { ...prev.data, ...data } : { ...data },
          updateTime: stamp(Date.now()),
        });
      },
    };
  }

  function makeCollection(prefix) {
    return {
      doc(id) {
        return makeDoc(`${prefix}/${id}`);
      },
      onSnapshot(onNext) {
        const key = `col:${prefix}`;
        const list = listeners.get(key) || [];
        list.push(onNext);
        listeners.set(key, list);
        return () => {
          listeners.set(
            key,
            (listeners.get(key) || []).filter((cb) => cb !== onNext),
          );
        };
      },
    };
  }

  return {
    collection: (name) => makeCollection(name),
    collectionGroup(name) {
      return {
        onSnapshot(onNext) {
          const key = `cg:${name}`;
          const list = listeners.get(key) || [];
          list.push(onNext);
          listeners.set(key, list);
          return () => {
            listeners.set(
              key,
              (listeners.get(key) || []).filter((cb) => cb !== onNext),
            );
          };
        },
      };
    },
    doc: (path) => makeDoc(path),
    async runTransaction(fn) {
      const tx = {
        get: (ref) => ref.get(),
        set: (ref, data, opts) => ref.set(data, opts),
      };
      return fn(tx);
    },
    emit(key, snapshot) {
      for (const cb of listeners.get(key) || []) cb(snapshot);
    },
    store,
  };
}

describe('firestore trigger runner', () => {
  test('matches nested document params and ignores other collection groups', () => {
    expect(paramsFromPath('users/{uid}', 'users/u1')).toEqual({ uid: 'u1' });
    expect(paramsFromPath('schools/{schoolId}/members/{uid}', 'schools/pu/members/u1')).toEqual({
      schoolId: 'pu',
      uid: 'u1',
    });
    expect(paramsFromPath('schools/{schoolId}/members/{uid}', 'groups/g1/members/u1')).toBeNull();
    expect(policyFor({ name: 'onInspectionWritten' })).toEqual({
      sideEffect: 'sync',
      createdOnly: false,
    });
    expect(policyFor({ name: 'groupQuestionAssistantReply' })).toEqual({
      sideEffect: 'notify',
      createdOnly: true,
    });
  });

  test('permission sync runs on initial snapshot and skips the same version after restart', async () => {
    const db = createMemoryDb();
    const claims = {};
    const handler = jest.fn(async (event) => {
      const after = event.data.after?.data();
      const uid = event.params.uid;
      if (!after) {
        delete claims[uid];
        return;
      }
      claims[uid] = { role: after.role, schoolId: after.schoolId };
    });
    const trigger = {
      name: 'onUserProfileChanged',
      document: 'users/{uid}',
      handler,
      eventType: 'google.cloud.firestore.document.v1.written',
    };

    const first = await startFirestoreTriggerRunner({
      db,
      triggers: [trigger],
      holderId: 'm1',
      now: () => 1_000,
      heartbeatMs: 60_000,
    });
    db.emit(
      'col:users',
      snapshotOf([
        { type: 'added', doc: docSnap('users/u1', { role: 'admin', schoolId: 'pu' }, 10) },
      ]),
    );
    await first.flush();
    expect(claims.u1).toEqual({ role: 'admin', schoolId: 'pu' });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].data.after.data()).toEqual({ role: 'admin', schoolId: 'pu' });
    first.stop();

    const second = await startFirestoreTriggerRunner({
      db,
      triggers: [trigger],
      holderId: 'm1',
      now: () => 2_000,
      heartbeatMs: 60_000,
    });
    db.emit(
      'col:users',
      snapshotOf([
        { type: 'added', doc: docSnap('users/u1', { role: 'admin', schoolId: 'pu' }, 10) },
      ]),
    );
    await second.flush();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(claims.u1).toEqual({ role: 'admin', schoolId: 'pu' });

    db.emit(
      'col:users',
      snapshotOf([
        { type: 'modified', doc: docSnap('users/u1', { role: 'teacher', schoolId: 'pu' }, 20) },
      ]),
    );
    await second.flush();
    expect(claims.u1).toEqual({ role: 'teacher', schoolId: 'pu' });
    expect(handler).toHaveBeenCalledTimes(2);
    second.stop();
  });

  test('membership and operator sync use before/after events', async () => {
    const db = createMemoryDb();
    const memberships = [];
    const operators = [];
    const runner = await startFirestoreTriggerRunner({
      db,
      triggers: [
        {
          name: 'onSchoolMembershipChanged',
          document: 'schools/{schoolId}/members/{uid}',
          handler: async (event) => {
            memberships.push({
              params: event.params,
              after: event.data.after?.data() || null,
            });
          },
        },
        {
          name: 'onCafeteriaOperatorChanged',
          document: 'schools/{schoolId}/cafeterias/{cafeteriaId}/operators/{uid}',
          handler: async (event) => {
            operators.push(event.params);
          },
        },
      ],
      holderId: 'm1',
      now: () => 1_000,
      heartbeatMs: 60_000,
    });

    db.emit(
      'cg:members',
      snapshotOf([
        {
          type: 'added',
          doc: docSnap('schools/pu/members/u1', { status: 'active' }, 11),
        },
        {
          type: 'added',
          doc: docSnap('groups/g1/members/u1', { status: 'active' }, 11),
        },
      ]),
    );
    db.emit(
      'cg:operators',
      snapshotOf([
        {
          type: 'added',
          doc: docSnap(
            'schools/pu/cafeterias/cafe-1/operators/op-1',
            { status: 'active' },
            12,
          ),
        },
      ]),
    );
    await runner.flush();
    expect(memberships).toEqual([
      { params: { schoolId: 'pu', uid: 'u1' }, after: { status: 'active' } },
    ]);
    expect(operators).toEqual([{ schoolId: 'pu', cafeteriaId: 'cafe-1', uid: 'op-1' }]);
    runner.stop();
  });

  test('notifications are not re-sent on the initial snapshot after restart', async () => {
    const db = createMemoryDb();
    const handler = jest.fn();
    const trigger = {
      name: 'gradePublishedNotification',
      document: 'schools/{schoolId}/grades/{gradeId}',
      handler,
      eventType: 'google.cloud.firestore.document.v1.created',
    };

    const first = await startFirestoreTriggerRunner({
      db,
      triggers: [trigger],
      holderId: 'm1',
      now: () => 1_000,
      heartbeatMs: 60_000,
    });
    db.emit(
      'cg:grades',
      snapshotOf([
        {
          type: 'added',
          doc: docSnap('schools/pu/grades/g1', { userId: 'u1', courseName: '微積分' }, 5),
        },
      ]),
    );
    await first.flush();
    expect(handler).not.toHaveBeenCalled();
    expect(policyFor(trigger).sideEffect).toBe('notify');

    db.emit(
      'cg:grades',
      snapshotOf([
        {
          type: 'added',
          doc: docSnap('schools/pu/grades/g2', { userId: 'u1', courseName: '線性代數' }, 6),
        },
      ]),
    );
    await first.flush();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].params).toEqual({ schoolId: 'pu', gradeId: 'g2' });
    first.stop();

    const second = await startFirestoreTriggerRunner({
      db,
      triggers: [trigger],
      holderId: 'm1',
      now: () => 2_000,
      heartbeatMs: 60_000,
    });
    db.emit(
      'cg:grades',
      snapshotOf([
        {
          type: 'added',
          doc: docSnap('schools/pu/grades/g2', { userId: 'u1', courseName: '線性代數' }, 6),
        },
      ]),
    );
    await second.flush();
    expect(handler).toHaveBeenCalledTimes(1);
    second.stop();
  });

  test('a second machine does not double-process while the lease is held', async () => {
    const db = createMemoryDb();
    const firstHandler = jest.fn();
    const secondHandler = jest.fn();
    const clock = { now: 1_000 };

    const first = await startFirestoreTriggerRunner({
      db,
      triggers: [
        {
          name: 'onUserProfileChanged',
          document: 'users/{uid}',
          handler: firstHandler,
        },
      ],
      holderId: 'machine-a',
      now: () => clock.now,
      leaseMs: 30_000,
      heartbeatMs: 60_000,
    });
    const second = await startFirestoreTriggerRunner({
      db,
      triggers: [
        {
          name: 'onUserProfileChanged',
          document: 'users/{uid}',
          handler: secondHandler,
        },
      ],
      holderId: 'machine-b',
      now: () => clock.now,
      leaseMs: 30_000,
      heartbeatMs: 60_000,
    });

    expect(first.isHoldingLease()).toBe(true);
    expect(second.isHoldingLease()).toBe(false);

    db.emit(
      'col:users',
      snapshotOf([{ type: 'added', doc: docSnap('users/u1', { role: 'student' }, 1) }]),
    );
    await first.flush();
    await second.flush();
    expect(firstHandler).toHaveBeenCalledTimes(1);
    expect(secondHandler).not.toHaveBeenCalled();

    first.stop();
    second.stop();
  });

  test('expired lease can be taken by another machine', async () => {
    const db = createMemoryDb();
    let now = 1_000;
    expect(await tryAcquireLease(db, { holderId: 'a', now: () => now, leaseMs: 1_000 })).toBe(true);
    expect(await tryAcquireLease(db, { holderId: 'b', now: () => now, leaseMs: 1_000 })).toBe(false);
    now = 3_000;
    expect(await tryAcquireLease(db, { holderId: 'b', now: () => now, leaseMs: 1_000 })).toBe(true);
  });
});

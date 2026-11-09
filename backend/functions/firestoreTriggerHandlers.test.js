'use strict';

const {
  createUserProfileChangedHandler,
  createSchoolMembershipChangedHandler,
  createCafeteriaOperatorChangedHandler,
  createGroupQuestionAssistantReplyTrigger,
  createGradePublishedNotificationHandler,
} = require('./firestoreTriggerHandlers');

function writtenEvent(params, after, before) {
  return {
    params,
    data: {
      before: {
        exists: before != null,
        data: () => before,
      },
      after: {
        exists: after != null,
        data: () => after,
      },
    },
  };
}

describe('firestore trigger handlers (permission sync)', () => {
  test('profile write syncs custom claims and directory from after data', async () => {
    const claims = {};
    const directory = {};
    const handler = createUserProfileChangedHandler({
      syncAuthClaims: async (uid, userData) => {
        claims[uid] = { role: userData.role, schoolId: userData.schoolId };
      },
      syncDirectoryEntriesForUser: async (uid, userData) => {
        if (!userData) {
          delete directory[uid];
          return;
        }
        directory[uid] = { schoolId: userData.schoolId, role: userData.role };
      },
    });

    await handler(
      writtenEvent({ uid: 'u1' }, { role: 'admin', schoolId: 'pu' }, { role: 'student' }),
    );

    expect(claims.u1).toEqual({ role: 'admin', schoolId: 'pu' });
    expect(directory.u1).toEqual({ schoolId: 'pu', role: 'admin' });
  });

  test('profile delete clears directory entries', async () => {
    const directory = { u1: { schoolId: 'pu' } };
    const leftover = [];
    const handler = createUserProfileChangedHandler({
      syncAuthClaims: async () => {
        throw new Error('should not set claims on delete');
      },
      syncDirectoryEntriesForUser: async (uid, userData) => {
        if (!userData) delete directory[uid];
      },
      inactivateLeftoverSchoolMemberships: async (uid) => {
        leftover.push(uid);
      },
    });

    await handler(writtenEvent({ uid: 'u1' }, null, { role: 'admin' }));
    expect(directory.u1).toBeUndefined();
    expect(leftover).toEqual(['u1']);
  });

  test('closed or rebuilt profiles revoke leftover story stamps', async () => {
    const leftover = [];
    const handler = createUserProfileChangedHandler({
      syncAuthClaims: async () => {},
      syncDirectoryEntriesForUser: async () => {},
      inactivateLeftoverSchoolMemberships: async (uid) => {
        leftover.push(uid);
      },
    });

    await handler(writtenEvent({ uid: 'u2' }, { status: 'suspended' }, { status: 'active' }));
    await handler(writtenEvent({ uid: 'u3' }, { role: 'student' }, null));
    await handler(writtenEvent({ uid: 'u4' }, { status: 'active', displayName: 'Still here' }, { status: 'active' }));
    expect(leftover).toEqual(['u2', 'u3']);
  });

  test('membership change syncs the school directory entry', async () => {
    const entries = [];
    const bindings = [];
    const handler = createSchoolMembershipChangedHandler({
      syncSchoolDirectoryEntry: async (payload) => {
        entries.push(payload);
      },
      syncProfileSchoolBinding: async (payload) => {
        bindings.push(payload);
      },
    });

    await handler(
      writtenEvent(
        { schoolId: 'pu', uid: 'u1' },
        { status: 'active', role: 'student' },
        null,
      ),
    );

    expect(entries).toEqual([
      { schoolId: 'pu', uid: 'u1', membership: { status: 'active', role: 'student' } },
    ]);
    expect(bindings).toEqual([
      { schoolId: 'pu', uid: 'u1', membership: { status: 'active', role: 'student' } },
    ]);
  });

  test('operator change recounts cafeteria operators', async () => {
    const counts = [];
    const handler = createCafeteriaOperatorChangedHandler({
      syncCafeteriaOperatorCount: async (schoolId, cafeteriaId) => {
        counts.push({ schoolId, cafeteriaId });
        return 2;
      },
    });

    await handler(
      writtenEvent(
        { schoolId: 'pu', cafeteriaId: 'cafe-1', uid: 'op-1' },
        { status: 'active' },
        null,
      ),
    );

    expect(counts).toEqual([{ schoolId: 'pu', cafeteriaId: 'cafe-1' }]);
  });

  test('group question trigger reuses the assistant reply handler', async () => {
    const seen = [];
    const handler = createGroupQuestionAssistantReplyTrigger({
      handleGroupQuestion: async (payload) => {
        seen.push(payload);
      },
    });
    await handler({
      params: { groupId: 'g1', postId: 'p1' },
      data: { data: () => ({ kind: 'question', authorId: 'u1' }) },
    });
    expect(seen).toEqual([
      { groupId: 'g1', postId: 'p1', post: { kind: 'question', authorId: 'u1' } },
    ]);
  });

  test('grade published trigger sends a push once per handler call', async () => {
    const pushes = [];
    const handler = createGradePublishedNotificationHandler({
      sendPushToUser: async (uid, note, meta) => {
        pushes.push({ uid, note, meta });
      },
    });
    await handler({
      params: { schoolId: 'pu', gradeId: 'gr1' },
      data: { data: () => ({ userId: 'u1', courseName: '微積分', letterGrade: 'A' }) },
    });
    expect(pushes).toHaveLength(1);
    expect(pushes[0].uid).toBe('u1');
    expect(pushes[0].meta).toMatchObject({ type: 'grade', gradeId: 'gr1', schoolId: 'pu' });
  });
});

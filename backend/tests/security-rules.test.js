const { after, before, beforeEach, describe, test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} = require('@firebase/rules-unit-testing');

const projectId = 'demo-campus-security';
const firestoreRules = fs.readFileSync(
  path.resolve(__dirname, '../firestore/firestore.rules'),
  'utf8',
);
const storageRules = fs.readFileSync(path.resolve(__dirname, '../storage/storage.rules'), 'utf8');

let testEnv;

async function seedFirestore(writeFn) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await writeFn(context.firestore());
  });
}

function uploadString(ref, value, contentType) {
  return ref.putString(value, 'raw', { contentType });
}

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId,
    firestore: { rules: firestoreRules },
    storage: { rules: storageRules },
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.clearStorage();
});

after(async () => {
  if (testEnv) {
    await testEnv.cleanup();
  }
});

describe('firestore security rules', () => {
  test("deny reading another user's private profile", async () => {
    await seedFirestore(async (db) => {
      await db.collection('users').doc('alice').set({
        displayName: 'Alice',
        phone: '0900000000',
      });
    });

    const db = testEnv.authenticatedContext('mallory').firestore();
    await assertFails(db.collection('users').doc('alice').get());
  });

  test('deny unauthenticated writes to root announcements', async () => {
    const db = testEnv.unauthenticatedContext().firestore();

    await assertFails(
      db.collection('announcements').doc('announcement-1').set({
        title: 'Security notice',
        schoolId: 'tw-demo-uni',
        createdAt: '2026-03-20T00:00:00.000Z',
      }),
    );
  });

  test('deny client-created school membership documents', async () => {
    const db = testEnv.authenticatedContext('alice').firestore();

    await assertFails(
      db.collection('schools').doc('tw-demo-uni').collection('members').doc('mallory').set({
        role: 'admin',
        status: 'active',
      }),
    );
  });

  test('deny reading another school member document without elevated role', async () => {
    await seedFirestore(async (db) => {
      await db.collection('schools').doc('tw-demo-uni').collection('members').doc('alice').set({
        role: 'member',
        status: 'active',
      });
      await db.collection('schools').doc('tw-demo-uni').collection('members').doc('bob').set({
        role: 'member',
        status: 'active',
      });
    });

    const db = testEnv.authenticatedContext('alice').firestore();
    await assertFails(
      db.collection('schools').doc('tw-demo-uni').collection('members').doc('bob').get(),
    );
  });

  test('deny ordinary members from writing school announcements', async () => {
    await seedFirestore(async (db) => {
      await db.collection('schools').doc('tw-demo-uni').collection('members').doc('alice').set({
        role: 'member',
        status: 'active',
      });
    });

    const db = testEnv.authenticatedContext('alice').firestore();
    await assertFails(
      db
        .collection('schools')
        .doc('tw-demo-uni')
        .collection('announcements')
        .doc('announcement-1')
        .set({
          title: 'Private admin announcement',
          body: 'Only callable functions should write this',
        }),
    );
  });

  test('deny client-created orders', async () => {
    const db = testEnv.authenticatedContext('alice').firestore();

    await assertFails(
      db.collection('orders').doc('order-1').set({
        userId: 'alice',
        amount: 500,
        status: 'paid',
      }),
    );
  });

  test('deny client-created school orders', async () => {
    const db = testEnv.authenticatedContext('alice').firestore();

    await assertFails(
      db.collection('schools').doc('tw-demo-uni').collection('orders').doc('order-1').set({
        userId: 'alice',
        schoolId: 'tw-demo-uni',
        cafeteriaId: 'cafeteria-1',
        status: 'pending',
      }),
    );
  });

  test("allow matching cafeteria operator to read orders but require callable writes", async () => {
    await seedFirestore(async (db) => {
      await db
        .collection('schools')
        .doc('tw-demo-uni')
        .collection('cafeterias')
        .doc('cafeteria-1')
        .set({
          name: '第一餐廳',
          orderingEnabled: true,
          pilotStatus: 'live',
        });
      await db
        .collection('schools')
        .doc('tw-demo-uni')
        .collection('cafeterias')
        .doc('cafeteria-1')
        .collection('operators')
        .doc('merchant-1')
        .set({
          status: 'active',
          role: 'manager',
        });
      await db.collection('schools').doc('tw-demo-uni').collection('orders').doc('order-1').set({
        userId: 'alice',
        schoolId: 'tw-demo-uni',
        cafeteriaId: 'cafeteria-1',
        status: 'pending',
      });
    });

    const db = testEnv.authenticatedContext('merchant-1').firestore();
    await assertSucceeds(
      db.collection('schools').doc('tw-demo-uni').collection('orders').doc('order-1').get(),
    );
    await assertFails(
      db.collection('schools').doc('tw-demo-uni').collection('orders').doc('order-1').update({
        status: 'ready',
      }),
    );
  });

  test("deny other cafeteria reads and require server writes even for administrators", async () => {
    await seedFirestore(async (db) => {
      await db.collection('schools').doc('tw-demo-uni').collection('members').doc('admin-1').set({
        role: 'admin',
        status: 'active',
      });
      await db
        .collection('schools')
        .doc('tw-demo-uni')
        .collection('cafeterias')
        .doc('cafeteria-1')
        .set({
          name: '第一餐廳',
          orderingEnabled: true,
          pilotStatus: 'live',
        });
      await db
        .collection('schools')
        .doc('tw-demo-uni')
        .collection('cafeterias')
        .doc('cafeteria-2')
        .set({
          name: '第二餐廳',
          orderingEnabled: true,
          pilotStatus: 'pilot',
        });
      await db
        .collection('schools')
        .doc('tw-demo-uni')
        .collection('cafeterias')
        .doc('cafeteria-2')
        .collection('operators')
        .doc('merchant-2')
        .set({
          status: 'active',
          role: 'staff',
        });
      await db.collection('schools').doc('tw-demo-uni').collection('orders').doc('order-2').set({
        userId: 'alice',
        schoolId: 'tw-demo-uni',
        cafeteriaId: 'cafeteria-1',
        status: 'pending',
      });
    });

    const operatorDb = testEnv.authenticatedContext('merchant-2').firestore();
    await assertFails(
      operatorDb.collection('schools').doc('tw-demo-uni').collection('orders').doc('order-2').get(),
    );

    const adminDb = testEnv.authenticatedContext('admin-1').firestore();
    await assertSucceeds(adminDb.collection('schools').doc('tw-demo-uni').collection('orders').doc('order-2').get());
    await assertFails(
      adminDb.collection('schools').doc('tw-demo-uni').collection('orders').doc('order-2').update({
        status: 'confirmed',
      }),
    );
  });

  test('prevent owners from forging canonical or mirrored order receipts, including cancellation writes', async () => {
    const canonical = 'schools/tw-demo-uni/orders/receipt';
    const mirror = 'users/alice/schools/tw-demo-uni/orders/receipt';
    const receipt = { userId: 'alice', schoolId: 'tw-demo-uni', cafeteriaId: 'cafe', requestId: 'attempt', total: 100, paymentStatus: 'pending', status: 'pending' };
    await seedFirestore(async (db) => {
      await db.doc(canonical).set(receipt);
      await db.doc(mirror).set(receipt);
    });
    const db = testEnv.authenticatedContext('alice').firestore();
    await assertSucceeds(db.doc(canonical).get());
    await assertSucceeds(db.doc(mirror).get());
    for (const path of [canonical, mirror]) {
      await assertFails(db.doc(path).update({ status: 'cancelled', total: 0, paymentStatus: 'paid' }));
      await assertFails(db.doc(path).update({ status: 'cancelled' }));
      await assertFails(db.doc(path).update({ requestId: 'new-attempt' }));
      await assertFails(db.doc(path).delete());
    }
    await assertFails(db.doc('users/alice/schools/tw-demo-uni/orders/forged').set(receipt));
    await assertFails(db.doc('_orderRequests/forged').set(receipt));
    await assertFails(testEnv.authenticatedContext('bob').firestore().doc(mirror).get());
  });

  test('deny group post impersonation on create', async () => {
    await seedFirestore(async (db) => {
      await db.collection('groups').doc('group-1').set({ schoolId: 'tw-demo-uni' });
      await db.collection('groups').doc('group-1').collection('members').doc('alice').set({
        role: 'student',
        status: 'active',
      });
    });

    const db = testEnv.authenticatedContext('alice').firestore();
    await assertFails(
      db.collection('groups').doc('group-1').collection('posts').doc('post-1').set({
        title: 'Impersonated post',
        body: 'This should fail',
        authorId: 'bob',
        kind: 'discussion',
      }),
    );
  });

  test('deny group comment impersonation on create', async () => {
    await seedFirestore(async (db) => {
      await db.collection('groups').doc('group-1').set({ schoolId: 'tw-demo-uni' });
      await db.collection('groups').doc('group-1').collection('members').doc('alice').set({
        role: 'student',
        status: 'active',
      });
      await db
        .collection('groups')
        .doc('group-1')
        .collection('posts')
        .doc('post-1')
        .set({
          title: 'Post',
          body: 'Body',
          authorId: 'alice',
        });
    });

    const db = testEnv.authenticatedContext('alice').firestore();
    await assertFails(
      db
        .collection('groups')
        .doc('group-1')
        .collection('posts')
        .doc('post-1')
        .collection('comments')
        .doc('comment-1')
        .set({
          body: 'Impersonated comment',
          authorId: 'bob',
        }),
    );
  });

  test('deny live question impersonation on create', async () => {
    await seedFirestore(async (db) => {
      await db.collection('groups').doc('group-1').set({ schoolId: 'tw-demo-uni' });
      await db.collection('groups').doc('group-1').collection('members').doc('alice').set({
        role: 'student',
        status: 'active',
      });
      await db
        .collection('groups')
        .doc('group-1')
        .collection('liveSessions')
        .doc('session-1')
        .set({
          active: true,
          teacherId: 'teacher-1',
        });
    });

    const db = testEnv.authenticatedContext('alice').firestore();
    await assertFails(
      db
        .collection('groups')
        .doc('group-1')
        .collection('liveSessions')
        .doc('session-1')
        .collection('questions')
        .doc('question-1')
        .set({
          text: 'Impersonated question',
          authorId: 'bob',
          answered: false,
        }),
    );
  });

  test('deny students from directly writing attendance records', async () => {
    await seedFirestore(async (db) => {
      await db.collection('groups').doc('group-1').set({ schoolId: 'tw-demo-uni' });
      await db.collection('groups').doc('group-1').collection('members').doc('alice').set({
        role: 'student',
        status: 'active',
      });
      await db
        .collection('groups')
        .doc('group-1')
        .collection('attendanceSessions')
        .doc('session-1')
        .set({
          active: true,
          teacherId: 'teacher-1',
        });
    });

    const db = testEnv.authenticatedContext('alice').firestore();
    await assertFails(
      db
        .collection('groups')
        .doc('group-1')
        .collection('attendanceSessions')
        .doc('session-1')
        .collection('attendanceRecords')
        .doc('alice')
        .set({
          uid: 'alice',
          status: 'present',
        }),
    );
  });

  test('deny client-created wallet transactions', async () => {
    const db = testEnv.authenticatedContext('alice').firestore();

    await assertFails(
      db.collection('transactions').doc('txn-1').set({
        userId: 'alice',
        amount: 500,
        type: 'topup',
      }),
    );
  });

  test('deny message reads for users outside the conversation', async () => {
    await seedFirestore(async (db) => {
      await db
        .collection('conversations')
        .doc('conversation-1')
        .set({
          schoolId: 'tw-demo-uni',
          memberIds: ['alice', 'bob'],
        });

      await db.collection('messages').doc('message-1').set({
        conversationId: 'conversation-1',
        senderId: 'alice',
        text: 'private message',
        createdAt: '2026-03-20T00:00:00.000Z',
      });
    });

    const db = testEnv.authenticatedContext('mallory').firestore();
    await assertFails(db.collection('messages').doc('message-1').get());
  });

  test('deny conversation creation when schoolId is missing', async () => {
    const db = testEnv.authenticatedContext('alice').firestore();

    await assertFails(
      db
        .collection('conversations')
        .doc('conversation-2')
        .set({
          memberIds: ['alice', 'bob'],
          createdAt: '2026-03-20T00:00:00.000Z',
        }),
    );
  });

  test('allow conversation members to update nested message readBy only', async () => {
    await seedFirestore(async (db) => {
      await db.collection('schools').doc('tw-demo-uni').collection('members').doc('alice').set({
        role: 'student',
        status: 'active',
      });
      await db.collection('schools').doc('tw-demo-uni').collection('members').doc('bob').set({
        role: 'student',
        status: 'active',
      });
      await db
        .collection('conversations')
        .doc('conversation-2')
        .set({
          schoolId: 'tw-demo-uni',
          memberIds: ['alice', 'bob'],
          createdAt: '2026-03-20T00:00:00.000Z',
          updatedAt: '2026-03-20T00:00:00.000Z',
        });
      await db
        .collection('conversations')
        .doc('conversation-2')
        .collection('messages')
        .doc('message-2')
        .set({
          conversationId: 'conversation-2',
          senderId: 'alice',
          content: 'hello',
          readBy: ['alice'],
          createdAt: '2026-03-20T00:00:00.000Z',
        });
    });

    const db = testEnv.authenticatedContext('bob').firestore();
    await assertSucceeds(
      db
        .collection('conversations')
        .doc('conversation-2')
        .collection('messages')
        .doc('message-2')
        .update({
          readBy: ['alice', 'bob'],
        }),
    );
  });

  test("deny students from reading classmates' gradebook rows", async () => {
    await seedFirestore(async (db) => {
      await db.collection('groups').doc('group-1').set({
        schoolId: 'tw-demo-uni',
        name: 'Secure Systems',
      });
      await db.collection('groups').doc('group-1').collection('members').doc('alice').set({
        role: 'member',
        status: 'active',
      });
      await db.collection('groups').doc('group-1').collection('members').doc('bob').set({
        role: 'member',
        status: 'active',
      });
      await db.collection('groups').doc('group-1').collection('gradebook').doc('bob').set({
        userId: 'bob',
        finalScore: 92,
      });
    });

    const db = testEnv.authenticatedContext('alice').firestore();
    await assertFails(
      db.collection('groups').doc('group-1').collection('gradebook').doc('bob').get(),
    );
  });

  test("deny students from reading classmates' submissions", async () => {
    await seedFirestore(async (db) => {
      await db.collection('groups').doc('group-1').set({
        schoolId: 'tw-demo-uni',
        name: 'Secure Systems',
      });
      await db.collection('groups').doc('group-1').collection('members').doc('alice').set({
        role: 'member',
        status: 'active',
      });
      await db.collection('groups').doc('group-1').collection('members').doc('bob').set({
        role: 'member',
        status: 'active',
      });
      await db
        .collection('groups')
        .doc('group-1')
        .collection('assignments')
        .doc('assignment-1')
        .set({
          title: 'Lab 1',
          createdBy: 'teacher-1',
        });
      await db
        .collection('groups')
        .doc('group-1')
        .collection('assignments')
        .doc('assignment-1')
        .collection('submissions')
        .doc('bob')
        .set({
          userId: 'bob',
          text: 'Bob submission',
        });
    });

    const db = testEnv.authenticatedContext('alice').firestore();
    await assertFails(
      db
        .collection('groups')
        .doc('group-1')
        .collection('assignments')
        .doc('assignment-1')
        .collection('submissions')
        .doc('bob')
        .get(),
    );
  });

  test('allow only the assigned reviewer to read a peer-reviewed submission', async () => {
    await seedFirestore(async (db) => {
      await db.collection('groups').doc('group-1').set({
        schoolId: 'tw-demo-uni',
        name: 'Secure Systems',
      });
      for (const uid of ['alice', 'bob', 'charlie']) {
        await db.collection('groups').doc('group-1').collection('members').doc(uid).set({
          role: 'member',
          status: 'active',
        });
      }
      await db
        .collection('groups')
        .doc('group-1')
        .collection('assignments')
        .doc('assignment-1')
        .set({
          title: 'Lab 1',
          createdBy: 'teacher-1',
        });
      await db
        .collection('groups')
        .doc('group-1')
        .collection('assignments')
        .doc('assignment-1')
        .collection('submissions')
        .doc('bob')
        .set({
          userId: 'bob',
          text: 'Bob submission',
        });
      await db
        .collection('groups')
        .doc('group-1')
        .collection('assignments')
        .doc('assignment-1')
        .collection('peerReviews')
        .doc('alice')
        .set({
          reviewerId: 'alice',
          submissionOwnerId: 'bob',
          comment: '',
          scores: {},
          submittedAt: null,
        });
    });

    const reviewerDb = testEnv.authenticatedContext('alice').firestore();
    await assertSucceeds(
      reviewerDb
        .collection('groups')
        .doc('group-1')
        .collection('assignments')
        .doc('assignment-1')
        .collection('submissions')
        .doc('bob')
        .get(),
    );

    const unrelatedDb = testEnv.authenticatedContext('charlie').firestore();
    await assertFails(
      unrelatedDb
        .collection('groups')
        .doc('group-1')
        .collection('assignments')
        .doc('assignment-1')
        .collection('submissions')
        .doc('bob')
        .get(),
    );
  });

  test('allow public pulse aggregate reads but deny raw pulse reports and aggregate writes', async () => {
    await seedFirestore(async (db) => {
      await db
        .collection('schools')
        .doc('tw-demo-uni')
        .collection('pulseAggregates')
        .doc('library')
        .set({
          schoolId: 'tw-demo-uni',
          locationId: 'library',
          locationName: 'Library',
          currentLevel: 3,
        });
      await db
        .collection('schools')
        .doc('tw-demo-uni')
        .collection('pulseReports')
        .doc('report-1')
        .set({
          reporterHash: 'anonymous',
          level: 4,
        });
    });

    const publicDb = testEnv.unauthenticatedContext().firestore();
    await assertSucceeds(
      publicDb
        .collection('schools')
        .doc('tw-demo-uni')
        .collection('pulseAggregates')
        .doc('library')
        .get(),
    );
    await assertFails(
      publicDb
        .collection('schools')
        .doc('tw-demo-uni')
        .collection('pulseReports')
        .doc('report-1')
        .get(),
    );

    const aliceDb = testEnv.authenticatedContext('alice').firestore();
    await assertFails(
      aliceDb
        .collection('schools')
        .doc('tw-demo-uni')
        .collection('pulseAggregates')
        .doc('library')
        .set({
          currentLevel: 5,
        }),
    );
  });

  test('protect Campus Agent OS private risk snapshots and action queue', async () => {
    await seedFirestore(async (db) => {
      await db.collection('users').doc('alice').collection('riskSnapshots').doc('today').set({
        userId: 'alice',
        score: 44,
      });
      await db.collection('users').doc('alice').collection('aiSessions').doc('session-1').set({
        title: 'Private AI session',
      });
    });

    const aliceDb = testEnv.authenticatedContext('alice').firestore();
    await assertSucceeds(
      aliceDb.collection('users').doc('alice').collection('riskSnapshots').doc('today').get(),
    );
    await assertSucceeds(
      aliceDb.collection('users').doc('alice').collection('actionQueue').doc('action-1').set({
        userId: 'alice',
        action: 'draft_message',
        label: '請假草稿',
        requiresConfirmation: true,
        status: 'pending_confirmation',
        actorRole: 'student',
        permissionScope: 'user_private',
      }),
    );
    await assertFails(
      aliceDb.collection('users').doc('alice').collection('actionQueue').doc('action-2').set({
        userId: 'alice',
        action: 'draft_message',
        label: 'unsafe',
        requiresConfirmation: false,
        status: 'confirmed',
        actorRole: 'student',
        permissionScope: 'user_private',
      }),
    );

    await assertFails(
      aliceDb.collection('users').doc('alice').collection('actionQueue').doc('action-3').set({
        userId: 'alice',
        action: 'draft_message',
        label: 'invalid-role',
        requiresConfirmation: true,
        status: 'pending_confirmation',
        actorRole: 'guest',
        permissionScope: 'user_private',
      }),
    );

    const malloryDb = testEnv.authenticatedContext('mallory').firestore();
    await assertFails(
      malloryDb.collection('users').doc('alice').collection('riskSnapshots').doc('today').get(),
    );
    await assertFails(
      malloryDb.collection('users').doc('alice').collection('aiSessions').doc('session-1').get(),
    );
  });

  test('agentRuns: owner can read, others cannot; client cannot write', async () => {
    await seedFirestore(async (db) => {
      await db.collection('users').doc('alice').collection('agentRuns').doc('run-1').set({
        runId: 'run-1',
        userId: 'alice',
        status: 'completed',
      });
    });

    const aliceDb = testEnv.authenticatedContext('alice').firestore();
    await assertSucceeds(
      aliceDb.collection('users').doc('alice').collection('agentRuns').doc('run-1').get(),
    );
    await assertFails(
      aliceDb.collection('users').doc('alice').collection('agentRuns').doc('run-2').set({
        runId: 'run-2',
        status: 'running',
      }),
    );

    const malloryDb = testEnv.authenticatedContext('mallory').firestore();
    await assertFails(
      malloryDb.collection('users').doc('alice').collection('agentRuns').doc('run-1').get(),
    );
  });

  test('postLoginRuns: owner can read, client cannot write', async () => {
    await seedFirestore(async (db) => {
      await db.collection('users').doc('alice').collection('postLoginRuns').doc('r1').set({
        resolvedRole: 'student',
      });
    });

    const aliceDb = testEnv.authenticatedContext('alice').firestore();
    await assertSucceeds(
      aliceDb.collection('users').doc('alice').collection('postLoginRuns').doc('r1').get(),
    );
    await assertFails(
      aliceDb.collection('users').doc('alice').collection('postLoginRuns').doc('r2').set({
        resolvedRole: 'teacher',
      }),
    );

    const malloryDb = testEnv.authenticatedContext('mallory').firestore();
    await assertFails(
      malloryDb.collection('users').doc('alice').collection('postLoginRuns').doc('r1').get(),
    );
  });

  test('courseRosters: active member in accessUids can read; others cannot', async () => {
    await seedFirestore(async (db) => {
      await db.collection('schools').doc('tw-demo-uni').collection('members').doc('alice').set({
        status: 'active',
        role: 'member',
      });
      await db.collection('schools').doc('tw-demo-uni').collection('members').doc('bob').set({
        status: 'active',
        role: 'member',
      });
      await db
        .collection('schools')
        .doc('tw-demo-uni')
        .collection('courseRosters')
        .doc('tron_1')
        .set({ accessUids: ['alice'], tronCourseId: 1 });
    });

    const aliceDb = testEnv.authenticatedContext('alice').firestore();
    await assertSucceeds(
      aliceDb.collection('schools').doc('tw-demo-uni').collection('courseRosters').doc('tron_1').get(),
    );

    const bobDb = testEnv.authenticatedContext('bob').firestore();
    await assertFails(
      bobDb.collection('schools').doc('tw-demo-uni').collection('courseRosters').doc('tron_1').get(),
    );
  });
});

describe('storage security rules', () => {
  test('deny print uploads for another user', async () => {
    const storage = testEnv.authenticatedContext('alice').storage();

    await assertFails(
      uploadString(
        storage.ref('printjobs/bob/job-1/report.pdf'),
        'fake document',
        'application/pdf',
      ),
    );
  });

  test('deny group post attachments for non-members', async () => {
    await seedFirestore(async (db) => {
      await db.collection('groups').doc('group-1').set({
        schoolId: 'tw-demo-uni',
        name: 'Secure Systems',
      });

      await db.collection('groups').doc('group-1').collection('members').doc('alice').set({
        role: 'owner',
        status: 'active',
      });
    });

    const storage = testEnv.authenticatedContext('mallory').storage();

    await assertFails(
      uploadString(
        storage.ref('groups/group-1/posts/post-1/notes.pdf'),
        'private notes',
        'application/pdf',
      ),
    );
  });

  test('allow avatar uploads for the file owner', async () => {
    const storage = testEnv.authenticatedContext('alice').storage();

    await assertSucceeds(
      uploadString(storage.ref('avatars/alice.jpg'), 'fake image', 'image/jpeg'),
    );
  });
});

describe('course assignment submissions', () => {
  const { serverTimestamp, Timestamp } = require('firebase/firestore');
  const pathTo = (db, uid = 'alice') => db.doc(`groups/course-1/assignments/work-1/submissions/${uid}`);
  const answer = (overrides = {}) => ({
    userId: 'alice', groupId: 'course-1', assignmentId: 'work-1', content: 'My answer',
    status: 'submitted', submittedAt: serverTimestamp(), updatedAt: serverTimestamp(), ...overrides,
  });
  async function seedAssignment(overrides = {}) {
    await seedFirestore(async (db) => {
      await db.doc('groups/course-1').set({ name: 'Course', schoolId: 'school-1' });
      await db.doc('groups/course-1/members/alice').set({ role: 'member', status: 'active' });
      await db.doc('groups/course-1/members/teacher').set({ role: 'instructor', status: 'active' });
      await db.doc('groups/course-1/assignments/work-1').set({ title: 'Work', published: true, ...overrides });
    });
  }
  test('student reads an empty own submission and submits using server timestamps', async () => {
    await seedAssignment();
    const ref = pathTo(testEnv.authenticatedContext('alice').firestore());
    await assertSucceeds(ref.get());
    await assertSucceeds(ref.set(answer()));
    const saved = await ref.get();
    if (saved.data().content !== 'My answer') throw new Error('submission was not persisted');
  });
  test('student cannot forge grades when creating or updating a submission', async () => {
    await seedAssignment();
    const ref = pathTo(testEnv.authenticatedContext('alice').firestore());
    await assertFails(ref.set(answer({ grade: 100 })));
    await assertSucceeds(ref.set(answer()));
    await assertFails(ref.update({ grade: 100, gradedBy: 'teacher' }));
    await assertFails(ref.update({ feedback: 'Excellent' }));
    await assertFails(ref.update({ content: 'replacement', userId: 'bob' }));
  });
  test('student cannot submit as another user or overwrite a confirmed answer', async () => {
    await seedAssignment();
    const db = testEnv.authenticatedContext('alice').firestore();
    await assertFails(pathTo(db, 'bob').set(answer({ userId: 'bob' })));
    await assertSucceeds(pathTo(db).set(answer()));
    await assertFails(pathTo(db).set(answer({ content: 'replacement' })));
  });
  test('quiz answers can be submitted but client scores cannot', async () => {
    await seedAssignment({ type: 'quiz' });
    const ref = pathTo(testEnv.authenticatedContext('alice').firestore());
    await assertFails(ref.set(answer({ content: '', answers: { q1: 'b' }, autoScore: { percentage: 100 } })));
    await assertSucceeds(ref.set(answer({ content: '', answers: { q1: 'b' } })));
    await assertFails(ref.update({ answers: { q1: 'a' } }));
  });
  test('teacher can grade a submitted answer', async () => {
    await seedAssignment();
    await assertSucceeds(pathTo(testEnv.authenticatedContext('alice').firestore()).set(answer()));
    await assertSucceeds(pathTo(testEnv.authenticatedContext('teacher').firestore()).update({ grade: 90, feedback: 'Reviewed' }));
  });
  test('removed members cannot submit or alter previous work', async () => {
    await seedAssignment();
    await seedFirestore((db) => db.doc('groups/course-1/members/alice').update({ status: 'removed' }));
    await assertFails(pathTo(testEnv.authenticatedContext('alice').firestore()).set(answer()));
  });
  test('unpublished, closed and overdue assignments reject submissions', async () => {
    for (const overrides of [{ published: false }, { status: 'draft' }, { status: 'closed' }, { dueAt: Timestamp.fromMillis(0) }, { dueAt: '2000-01-01T00:00:00Z' }]) {
      await seedAssignment(overrides);
      await assertFails(pathTo(testEnv.authenticatedContext('alice').firestore()).set(answer()));
    }
  });
  test('explicit late allowance accepts an overdue submission', async () => {
    await seedAssignment({ dueAt: Timestamp.fromMillis(0), allowLateSubmission: true });
    await assertSucceeds(pathTo(testEnv.authenticatedContext('alice').firestore()).set(answer()));
  });
  test('empty content, oversized text and client supplied timestamps are rejected', async () => {
    await seedAssignment();
    const ref = pathTo(testEnv.authenticatedContext('alice').firestore());
    await assertFails(ref.set(answer({ content: '' })));
    await assertFails(ref.set(answer({ content: 'a'.repeat(20001) })));
    await assertFails(ref.set(answer({ submittedAt: '2026-10-07T00:00:00Z' })));
    await assertSucceeds(ref.set(answer({ content: '', attachments: [{ url: 'https://example.test/answer.pdf' }] })));
  });
});

describe('protected attendance records', () => {
  async function seedAttendance() {
    await seedFirestore(async (db) => {
      const group = db.collection('groups').doc('attendance-class');
      await group.set({ schoolId: 'tw-demo-uni' });
      for (const [uid, role, status = 'active'] of [
        ['alice', 'student'], ['bob', 'student'], ['teacher', 'instructor'],
        ['owner', 'owner'], ['admin', 'admin'], ['removed', 'instructor', 'inactive'],
      ]) {
        await group.collection('members').doc(uid).set({ role, status });
      }
      for (const collection of ['liveSessions', 'attendanceSessions']) {
        await group.collection(collection).doc('current').set({
          schemaVersion: 2, teacherId: 'teacher', active: true, attendeeCount: 1,
          startedAt: new Date(), qrExpiresAt: new Date(Date.now() + 300_000),
        });
        await group.collection(collection).doc('legacy').set({
          teacherId: 'teacher', active: true, qrToken: 'previously-public-token', attendees: { alice: new Date() },
        });
      }
      await group.collection('liveSessionSecrets').doc('current').set({ teacherId: 'teacher', qrToken: 'private-token', qrExpiresAt: new Date(Date.now() + 300_000) });
      await group.collection('attendanceSessions').doc('current').collection('attendanceRecords').doc('alice').set({
        uid: 'alice', status: 'present', checkedInAt: new Date(),
      });
      await group.collection('attendanceSessions').doc('current').collection('attendanceRecords').doc('bob').set({
        uid: 'bob', status: 'present', checkedInAt: new Date(),
      });
    });
  }
  const group = (uid) => testEnv.authenticatedContext(uid).firestore().collection('groups').doc('attendance-class');

  test('students read only safe metadata and their own attendance', async () => {
    await seedAttendance();
    await assertSucceeds(group('alice').collection('liveSessions').doc('current').get());
    await assertSucceeds(group('alice').collection('attendanceSessions').doc('current').get());
    const records = group('alice').collection('attendanceSessions').doc('current').collection('attendanceRecords');
    await assertSucceeds(records.doc('alice').get());
    await assertFails(records.doc('bob').get());
    await assertFails(records.get());
    await assertFails(group('alice').collection('liveSessionSecrets').doc('current').get());
    await assertFails(group('alice').collection('liveSessionSecrets').get());
    await assertFails(group('outsider').collection('liveSessions').doc('current').get());
    await assertFails(group('removed').collection('liveSessions').doc('current').get());
    await assertFails(group('removed').collection('attendanceSessions').doc('current').collection('attendanceRecords').doc('removed').get());
  });

  test('metadata queries must select the safe version; legacy secrets remain unreadable', async () => {
    await seedAttendance();
    for (const collection of ['liveSessions', 'attendanceSessions']) {
      await assertSucceeds(group('alice').collection(collection).where('schemaVersion', '==', 2).orderBy('startedAt', 'desc').limit(50).get());
      await assertFails(group('alice').collection(collection).get());
      await assertFails(group('alice').collection(collection).doc('legacy').get());
      await assertFails(group('teacher').collection(collection).doc('legacy').get());
    }
  });

  test('active instructors can read secrets and managers can read the roster', async () => {
    await seedAttendance();
    for (const uid of ['teacher', 'owner']) {
      await assertSucceeds(group(uid).collection('liveSessionSecrets').doc('current').get());
    }
    for (const uid of ['teacher', 'owner', 'admin']) {
      await assertSucceeds(group(uid).collection('attendanceSessions').doc('current').collection('attendanceRecords').get());
    }
    await assertFails(group('admin').collection('liveSessionSecrets').doc('current').get());
    await assertFails(group('removed').collection('liveSessionSecrets').doc('current').get());
  });

  test('even instructors cannot create, rewrite or delete canonical attendance documents', async () => {
    await seedAttendance();
    for (const uid of ['alice', 'teacher', 'owner', 'admin']) {
      for (const collection of ['liveSessions', 'attendanceSessions', 'liveSessionSecrets']) {
        const sessions = group(uid).collection(collection);
        await assertFails(sessions.doc('forged').set({ schemaVersion: 2, teacherId: uid, active: true }));
        await assertFails(sessions.doc('current').update({ active: false }));
        await assertFails(sessions.doc('current').delete());
      }
      const records = group(uid).collection('attendanceSessions').doc('current').collection('attendanceRecords');
      await assertFails(records.doc('new-student').set({ uid: 'new-student', status: 'present' }));
      await assertFails(records.doc('alice').update({ checkedInAt: new Date(0) }));
      await assertFails(records.doc('alice').delete());
    }
  });

  test('live questions and teacher polls remain available to existing clients', async () => {
    await seedAttendance();
    const studentSession = group('alice').collection('liveSessions').doc('current');
    await assertSucceeds(studentSession.collection('questions').doc('q1').set({ authorId: 'alice', text: '請再說明一次', answered: false }));
    await assertSucceeds(group('teacher').collection('liveSessions').doc('current').collection('polls').doc('p1').set({ title: '選擇答案', options: ['甲', '乙'] }));
    await assertSucceeds(studentSession.collection('polls').doc('p1').get());
  });
});

describe('attendance transactions on Firestore', () => {
  const assert = require('node:assert/strict');
  const requireFunctions = require('node:module').createRequire(path.resolve(__dirname, '../functions/package.json'));
  const { initializeApp, deleteApp } = requireFunctions('firebase-admin/app');
  const { getFirestore } = requireFunctions('firebase-admin/firestore');
  const { createLiveSessionHandlers } = require('../functions/attendanceSessions');
  let app;
  let db;
  let handlers;
  let currentTime;
  let notifications;
  const startRequest = (data = {}) => ({ auth: { uid: 'teacher' }, data: { groupId: 'transaction-class', requestId: 'start-1', ...data } });
  const request = (session, uid = 'alice') => ({ auth: { uid }, data: { groupId: 'transaction-class', sessionId: session.sessionId, qrToken: session.qrToken } });
  const base = 'groups/transaction-class';
  const sessionDoc = (session, collection) => db.doc(`${base}/${collection}/${session.sessionId}`);

  before(() => {
    // These Admin SDK tests must never fall through to a real Firebase project.
    if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('FIRESTORE_EMULATOR_HOST is required');
    app = initializeApp({ projectId }, 'attendance-transaction-tests');
    db = getFirestore(app);
  });
  beforeEach(async () => {
    currentTime = Date.now();
    notifications = 0;
    handlers = createLiveSessionHandlers({ db, now: () => currentTime, notifyStarted: async () => { notifications++; } });
    await db.doc(base).set({ name: '交易測試課程' });
    await db.doc(`${base}/members/teacher`).set({ role: 'instructor', status: 'active' });
    for (const uid of ['alice', 'bob', 'carol']) await db.doc(`${base}/members/${uid}`).set({ role: 'student', status: 'active', displayName: uid });
  });
  after(async () => { if (app) await deleteApp(app); });

  test('parallel starts with the same key create one synchronized session', async () => {
    const starts = await Promise.all(Array.from({ length: 4 }, () => handlers.startLiveSession(startRequest())));
    assert.equal(new Set(starts.map((session) => session.sessionId)).size, 1);
    assert.equal(starts.filter((session) => !session.reused).length, 1);
    assert.equal(notifications, 1);
    const [live, attendance, secrets] = await Promise.all(['liveSessions', 'attendanceSessions', 'liveSessionSecrets'].map((collection) => db.collection(`${base}/${collection}`).get()));
    assert.equal(live.size, 1);
    assert.equal(attendance.size, 1);
    assert.equal(secrets.size, 1);
    assert.equal(live.docs[0].data().startedAt.toMillis(), attendance.docs[0].data().startedAt.toMillis());
    assert.equal(live.docs[0].data().qrToken, undefined);
    assert.equal(attendance.docs[0].data().qrToken, undefined);
  });

  test('concurrent retrying students each increment both counters once and keep their first check-in', async () => {
    const session = await handlers.startLiveSession(startRequest());
    const initial = await handlers.joinLiveSession(request(session));
    currentTime += 1000;
    const joins = await Promise.all(['alice', 'alice', 'bob', 'bob', 'carol'].map((uid) => handlers.joinLiveSession(request(session, uid))));
    assert.equal(joins[0].checkedInAt, initial.checkedInAt);
    assert.equal(joins[1].checkedInAt, initial.checkedInAt);
    const live = (await sessionDoc(session, 'liveSessions').get()).data();
    const attendance = (await sessionDoc(session, 'attendanceSessions').get()).data();
    const records = await sessionDoc(session, 'attendanceSessions').collection('attendanceRecords').get();
    assert.equal(live.attendeeCount, 3);
    assert.equal(attendance.attendeeCount, 3);
    assert.equal(records.size, 3);
    assert.equal(live.attendees, undefined);
    assert.equal(attendance.attendees, undefined);
    assert.equal(records.docs.find((doc) => doc.id === 'alice').data().checkedInAt.toDate().toISOString(), initial.checkedInAt);
  });

  test('closing races with a join without splitting status, counts or attendance records', async () => {
    const session = await handlers.startLiveSession(startRequest());
    const [join, end] = await Promise.allSettled([
      handlers.joinLiveSession(request(session)),
      handlers.endLiveSession(request(session, 'teacher')),
    ]);
    assert.equal(end.status, 'fulfilled');
    if (join.status === 'rejected') assert.equal(join.reason.code, 'failed-precondition');
    const live = (await sessionDoc(session, 'liveSessions').get()).data();
    const attendance = (await sessionDoc(session, 'attendanceSessions').get()).data();
    const records = await sessionDoc(session, 'attendanceSessions').collection('attendanceRecords').get();
    assert.equal(live.active, false);
    assert.equal(attendance.active, false);
    assert.equal(live.endedAt.toMillis(), attendance.endedAt.toMillis());
    assert.equal(live.attendeeCount, records.size);
    assert.equal(attendance.attendeeCount, records.size);
    await assert.rejects(handlers.joinLiveSession(request(session, 'bob')), { code: 'failed-precondition' });
    const retry = await handlers.startLiveSession(startRequest());
    assert.equal(retry.active, false);
    assert.equal(retry.reused, true);
  });

  test('revocation and token expiry are checked before any new attendance write', async () => {
    const session = await handlers.startLiveSession(startRequest());
    await db.doc(`${base}/members/alice`).update({ status: 'inactive' });
    await assert.rejects(handlers.joinLiveSession(request(session)), { code: 'permission-denied' });
    currentTime += 300_000;
    await assert.rejects(handlers.joinLiveSession(request(session, 'bob')), { code: 'deadline-exceeded' });
    await db.doc(`${base}/members/teacher`).update({ status: 'inactive' });
    await assert.rejects(handlers.endLiveSession(request(session, 'teacher')), { code: 'permission-denied' });
    assert.equal((await sessionDoc(session, 'attendanceSessions').collection('attendanceRecords').get()).size, 0);
    assert.equal((await sessionDoc(session, 'liveSessions').get()).data().attendeeCount, 0);
  });
});

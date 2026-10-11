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
  for (const accountState of [{ accountDeletionInProgress: true }, { status: 'deleted' }]) {
    test(`deny new reads and writes for closing accounts ${JSON.stringify(accountState)}`, async () => {
      await seedFirestore(async (db) => {
        await db.doc('users/alice').set({ ...accountState, displayName: 'Alice' });
        await db.doc('users/alice/settings/notifications').set({ enabled: true });
        await db.doc('schools/pu/members/alice').set({ status: 'active', role: 'admin' });
        await db.doc('groups/course/members/alice').set({ status: 'active', role: 'owner' });
        await db.doc('groups/course').set({ name: 'Course' });
      });
      const db = testEnv.authenticatedContext('alice', { role: 'admin' }).firestore();
      await assertFails(db.doc('users/alice').get());
      await assertFails(db.doc('users/alice').update({ accountDeletionInProgress: false, status: 'active' }));
      await assertFails(db.doc('users/alice/settings/notifications').set({ enabled: false }));
      await assertFails(db.doc('users/alice/pushTokens/new').set({ token: 'new-token' }));
      await assertFails(db.doc('groups/course').get());
      await assertFails(db.doc('schools/pu/announcements/new').set({ title: 'Cannot publish' }));
    });
  }

  test('feedback is private and can only be written by the server', async () => {
    await seedFirestore(async (db) => {
      await db
        .collection('feedback')
        .doc('receipt')
        .set({ submittedBy: 'alice', title: 'Private' });
    });
    for (const context of [
      testEnv.authenticatedContext('alice'),
      testEnv.authenticatedContext('bob'),
      testEnv.unauthenticatedContext(),
    ]) {
      const collection = context.firestore().collection('feedback');
      await assertFails(collection.doc('receipt').get());
      await assertFails(collection.get());
      await assertFails(collection.doc('new').set({ submittedBy: 'alice' }));
      await assertFails(collection.doc('receipt').update({ status: 'reviewed' }));
      await assertFails(collection.doc('receipt').delete());
    }
  });

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

  test('allow cafeteria operator to write hours and menus but not ordering flags', async () => {
    await seedFirestore(async (db) => {
      await db
        .collection('schools')
        .doc('tw-demo-uni')
        .collection('cafeterias')
        .doc('cafeteria-1')
        .set({
          name: '第一餐廳',
          orderingEnabled: true,
          openingHours: '11:00-14:00',
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
    });

    const db = testEnv.authenticatedContext('merchant-1').firestore();
    await assertSucceeds(
      db
        .collection('schools')
        .doc('tw-demo-uni')
        .collection('cafeterias')
        .doc('cafeteria-1')
        .update({
          openingHours: '11:00-19:00',
          updatedAt: new Date(),
          sourceLabel: 'shop-dock',
        }),
    );
    await assertFails(
      db
        .collection('schools')
        .doc('tw-demo-uni')
        .collection('cafeterias')
        .doc('cafeteria-1')
        .update({
          orderingEnabled: false,
        }),
    );
    await assertSucceeds(
      db.collection('schools').doc('tw-demo-uni').collection('menus').doc('menu-1').set({
        schoolId: 'tw-demo-uni',
        cafeteriaId: 'cafeteria-1',
        name: '滷肉飯',
      }),
    );
    await assertSucceeds(
      db.collection('schools').doc('tw-demo-uni').collection('menus').doc('menu-1').update({
        cafeteriaId: 'cafeteria-1',
        soldOut: true,
      }),
    );
    await assertSucceeds(
      db.collection('schools').doc('tw-demo-uni').collection('menus').doc('menu-1').delete(),
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

  test('店家即時監聽：只放行查自己這家店的單，別家、不帶店別、停用的店員、學生都查不到', async () => {
    const school = 'schools/tw-demo-uni';
    await seedFirestore(async (db) => {
      await db.doc(`${school}/cafeterias/cafe-a`).set({ name: 'A' });
      await db.doc(`${school}/cafeterias/cafe-b`).set({ name: 'B' });
      await db.doc(`${school}/cafeterias/cafe-a/operators/staff-a`).set({ status: 'active', role: 'staff' });
      await db.doc(`${school}/cafeterias/cafe-a/operators/staff-off`).set({ status: 'inactive', role: 'staff' });
      await db.doc(`${school}/cafeterias/cafe-b/operators/staff-b`).set({ status: 'active', role: 'staff' });
      await db.doc(`${school}/orders/a1`).set({ userId: 'alice', cafeteriaId: 'cafe-a', status: 'pending' });
      await db.doc(`${school}/orders/a2`).set({ userId: 'bob', cafeteriaId: 'cafe-a', status: 'preparing' });
      await db.doc(`${school}/orders/b1`).set({ userId: 'alice', cafeteriaId: 'cafe-b', status: 'pending' });
    });
    const open = ['pending', 'confirmed', 'preparing', 'ready'];
    const listen = (uid, cafeteriaId) =>
      testEnv
        .authenticatedContext(uid)
        .firestore()
        .collection(`${school}/orders`)
        .where('cafeteriaId', '==', cafeteriaId)
        .where('status', 'in', open)
        .limit(100)
        .get();

    const mine = await assertSucceeds(listen('staff-a', 'cafe-a'));
    if (mine.docs.map((d) => d.id).sort().join() !== 'a1,a2') {
      throw new Error(`unexpected docs ${mine.docs.map((d) => d.id)}`);
    }
    await assertSucceeds(
      testEnv.authenticatedContext('staff-a').firestore().collection(`${school}/orders`).where('cafeteriaId', '==', 'cafe-a').limit(100).get(),
    );
    await assertFails(listen('staff-a', 'cafe-b'));
    await assertFails(listen('staff-b', 'cafe-a'));
    await assertFails(listen('staff-off', 'cafe-a'));
    await assertFails(listen('alice', 'cafe-a'));
    await assertFails(testEnv.unauthenticatedContext().firestore().collection(`${school}/orders`).where('cafeteriaId', '==', 'cafe-a').get());
    await assertFails(testEnv.authenticatedContext('staff-a').firestore().collection(`${school}/orders`).limit(100).get());
    await assertFails(testEnv.authenticatedContext('staff-a').firestore().doc(`${school}/orders/b1`).get());
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
  test('closing and deleted accounts cannot reuse issued tokens for private files or uploads', async () => {
    await seedFirestore(async (db) => {
      await db.doc('users/alice').set({ displayName: 'Alice' });
      await db.doc('conversations/private').set({ memberIds: ['alice', 'bob'] });
      await db.doc('repairRequests/one').set({ userId: 'alice' });
    });
    const storage = testEnv.authenticatedContext('alice', { role: 'admin' }).storage();
    const privatePaths = [
      'temp/alice/export.json', 'health/alice/one/file.pdf',
      'printjobs/alice/one/file.pdf', 'conversations/private/messages/one/file.pdf',
      'conversations/private/media/one/file.pdf', 'repairs/one/photo.jpg',
    ];
    for (const file of privatePaths) {
      await assertSucceeds(uploadString(storage.ref(file), 'fixture', file.endsWith('.jpg') ? 'image/jpeg' : 'application/pdf'));
    }
    await assertFails(uploadString(storage.ref('health/alice/one/program.exe'), 'fixture', 'application/x-msdownload'));
    for (const state of [{ accountDeletionInProgress: true }, { status: 'deleted' }]) {
      await seedFirestore(async (db) => db.doc('users/alice').set(state));
      for (const file of privatePaths) {
        await assertFails(storage.ref(file).getMetadata());
        await assertFails(uploadString(storage.ref(file), 'new fixture', file.endsWith('.jpg') ? 'image/jpeg' : 'application/pdf'));
      }
      await assertFails(uploadString(storage.ref('avatars/alice.jpg'), 'image', 'image/jpeg'));
      await assertFails(uploadString(storage.ref('lostfound/one/photo.jpg'), 'image', 'image/jpeg'));
      await assertFails(uploadString(storage.ref('bugreports/one/photo.jpg'), 'image', 'image/jpeg'));
    }
    await assertSucceeds(testEnv.authenticatedContext('bob').storage().ref('conversations/private/messages/one/file.pdf').getMetadata());
  });

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
      await db.doc('groups/course-1').set({ name: 'Course', schoolId: 'school-1', type: 'course' });
      await db.doc('schools/school-1/members/teacher').set({ role: 'faculty', status: 'active' });
      await db.doc('groups/course-1/members/alice').set({ role: 'member', status: 'active' });
      await db.doc('groups/course-1/members/teacher').set({ role: 'instructor', status: 'active' });
      await db.doc('groups/course-1/assignments/work-1').set({ title: 'Work', published: true, ...overrides });
    });
  }
  test('author can edit descriptive fields but not points, identity or published status', async () => {
    await seedAssignment({
      type: 'assignment', createdBy: 'teacher', status: 'published',
      description: 'Original', points: 100, allowLateSubmission: false,
    });
    const teacher = testEnv.authenticatedContext('teacher').firestore();
    const ref = teacher.doc('groups/course-1/assignments/work-1');
    await assertSucceeds(ref.update({
      title: 'Updated', description: 'Revised', allowLateSubmission: true,
      lastEditedBy: 'teacher', updatedAt: serverTimestamp(),
    }));
    await assertFails(ref.update({ points: 999 }));
    await assertFails(ref.update({ published: false }));
    await assertFails(ref.delete());
    await assertFails(ref.update({ createdBy: 'alice' }));
  });
  test('students and other instructors cannot change the original author assignment', async () => {
    await seedAssignment({
      type: 'assignment', createdBy: 'teacher', status: 'published',
      description: 'Original', points: 100, allowLateSubmission: false,
    });
    const student = testEnv.authenticatedContext('alice').firestore();
    await assertFails(student.doc('groups/course-1/assignments/work-1').update({
      title: 'Tampered', lastEditedBy: 'alice', updatedAt: serverTimestamp(),
    }));
    await seedFirestore(async (db) => db.doc('groups/course-1/members/bob').set({
      role: 'instructor', status: 'active',
    }));
    const bob = testEnv.authenticatedContext('bob').firestore();
    await assertFails(bob.doc('groups/course-1/assignments/work-1').update({
      title: 'Tampered', lastEditedBy: 'bob', updatedAt: serverTimestamp(),
    }));
  });
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
  test('teacher cannot alter a submitted answer, its owner or its timestamps', async () => {
    await seedAssignment({ type: 'assignment', points: 100 });
    await assertSucceeds(pathTo(testEnv.authenticatedContext('alice').firestore()).set(answer()));
    const ref = pathTo(testEnv.authenticatedContext('teacher').firestore());
    await assertFails(ref.update({ content: 'Changed by teacher' }));
    await assertFails(ref.update({ userId: 'teacher' }));
    await assertFails(ref.update({ submittedAt: serverTimestamp() }));
    await assertFails(ref.update({ status: 'draft' }));
    await assertFails(ref.update({ gradeScore: 50, content: 'Changed by teacher' }));
    const saved = await ref.get();
    if (saved.data().content !== 'My answer' || saved.data().userId !== 'alice') {
      throw new Error('The original student answer was modified');
    }
  });
  test('published grading validates score, author and server time', async () => {
    await seedAssignment({ type: 'assignment', points: 100 });
    await assertSucceeds(pathTo(testEnv.authenticatedContext('alice').firestore()).set(answer()));
    const ref = pathTo(testEnv.authenticatedContext('teacher').firestore());
    const publish = (overrides = {}) => ({
      gradeScore: 0, gradeFeedback: '重新檢查答案', gradePublished: true,
      gradePublishedBy: 'teacher', gradePublishedAt: serverTimestamp(), ...overrides,
    });
    await assertFails(ref.update(publish({ gradeScore: 101 })));
    await assertFails(ref.update(publish({ gradeScore: -1 })));
    await assertFails(ref.update(publish({ gradePublishedBy: 'alice' })));
    await assertFails(ref.update(publish({ gradePublishedAt: new Date() })));
    await assertFails(ref.update(publish({ gradeFeedback: 'x'.repeat(4001) })));
    await assertFails(ref.update(publish({ submittedAt: serverTimestamp() })));
    await assertSucceeds(ref.update(publish()));
    const saved = await ref.get();
    if (saved.data().gradeScore !== 0 || saved.data().gradePublished !== true) {
      throw new Error('Initial grade was not published');
    }
    await assertFails(ref.update({ gradeScore: 100 }));
    await assertFails(ref.update({ content: 'Quiet rewrite' }));
    await assertFails(ref.update({ grade: 100, feedback: 'Overwrite via old fields' }));
  });
  test('legacy grading accepts the first grade but not an unaudited overwrite', async () => {
    await seedAssignment({ type: 'assignment', points: 100 });
    await assertSucceeds(pathTo(testEnv.authenticatedContext('alice').firestore()).set(answer()));
    const ref = pathTo(testEnv.authenticatedContext('teacher').firestore());
    await assertFails(ref.update({ grade: 110, feedback: 'Over maximum' }));
    await assertFails(ref.update({ grade: -1 }));
    await assertSucceeds(ref.update({ grade: 70, feedback: 'Original review' }));
    await assertFails(ref.update({ grade: 90, feedback: 'Silent rewrite' }));
    await assertFails(ref.update({ feedback: 'Silent rewrite' }));
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

  async function seedPublishedGrade() {
    await seedAssignment({ type: 'assignment', points: 100 });
    await assertSucceeds(pathTo(testEnv.authenticatedContext('alice').firestore()).set(answer()));
    await seedFirestore(async (db) => {
      await db.doc('groups/course-1/assignments/work-1/submissions/alice').update({
        gradeScore: 60, gradeFeedback: '初次評分',
        gradePublished: true, gradePublishedBy: 'teacher',
        gradePublishedAt: Timestamp.fromDate(new Date('2026-10-08T01:00:00Z')),
      });
    });
  }
  function correctionBatch(db, overrides = {}, change = {}) {
    const submission = pathTo(db);
    const revision = submission.collection('gradeRevisions').doc('revision-1234567890');
    const batch = db.batch();
    batch.update(submission, {
      gradeScore: 80, gradeFeedback: '依評分規準調整',
      gradePublishedBy: 'teacher', gradePublishedAt: serverTimestamp(),
      gradeRevisionId: 'revision-1234567890', gradeRevisionCount: 1,
      gradeRevisedAt: serverTimestamp(), gradeRevisionReason: '核對配分後修正',
      ...change,
    });
    batch.set(revision, {
      beforeScore: 60, afterScore: 80, beforeFeedback: '初次評分',
      afterFeedback: '依評分規準調整', reason: '核對配分後修正',
      changedBy: 'teacher', changedAt: serverTimestamp(), revision: 1,
      ...overrides,
    });
    return { batch, revision };
  }
  test('teacher grade changes require an atomic immutable audit trail', async () => {
    await seedPublishedGrade();
    const teacher = testEnv.authenticatedContext('teacher').firestore();
    const submission = pathTo(teacher);
    await assertFails(submission.update({
      gradeScore: 80, gradeFeedback: '依評分規準調整',
    }));
    const { batch, revision } = correctionBatch(teacher);
    await assertSucceeds(batch.commit());
    const saved = await submission.get();
    if (saved.data().gradeScore !== 80 || saved.data().gradeRevisionCount !== 1) {
      throw new Error('The audited correction was not committed');
    }
    await assertSucceeds(revision.get());
    await assertFails(revision.update({ reason: '已修改紀錄' }));
    await assertFails(revision.delete());
    await assertFails(testEnv.authenticatedContext('alice').firestore()
      .doc(revision.path).get());
  });
  test('an audit record alone or with falsified before/after values is rejected', async () => {
    await seedPublishedGrade();
    const teacher = testEnv.authenticatedContext('teacher').firestore();
    const { revision } = correctionBatch(teacher);
    await assertFails(revision.set({
      beforeScore: 60, afterScore: 80, beforeFeedback: '初次評分',
      afterFeedback: '依評分規準調整', reason: '核對配分後修正',
      changedBy: 'teacher', changedAt: serverTimestamp(), revision: 1,
    }));
    const { batch } = correctionBatch(teacher, { beforeScore: 10 });
    await assertFails(batch.commit());
  });
  test('student and revoked teacher cannot rewrite published grades or create revision logs', async () => {
    await seedPublishedGrade();
    const student = testEnv.authenticatedContext('alice').firestore();
    await assertFails(pathTo(student).update({ gradeScore: 99 }));
    const submission = pathTo(student);
    await assertFails(submission.collection('gradeRevisions').doc('revision-1234567890')
      .set({ reason: '自行更正' }));
    await seedFirestore((db) =>
      db.doc('groups/course-1/members/teacher').update({ status: 'removed' }));
    const { batch } = correctionBatch(testEnv.authenticatedContext('teacher').firestore());
    await assertFails(batch.commit());
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

test('owners cannot write during deletion or clear its guards, while active profiles remain editable', async () => {
  const profile = { role: 'student', balance: 0, schoolId: 'pu', primarySchoolId: 'pu', createdAt: '2026-10-08', notificationDeliveryDisabled: true, accountDeletionInProgress: true, displayName: 'Alice' };
  await seedFirestore(async (db) => db.doc('users/alice').set(profile));
  const ref = testEnv.authenticatedContext('alice').firestore().doc('users/alice');
  await assertFails(ref.update({ displayName: 'Updated' }));
  for (const field of ['notificationDeliveryDisabled', 'accountDeletionInProgress']) {
    await assertFails(ref.update({ [field]: false }));
    const replacement = { ...profile }; delete replacement[field];
    await assertFails(ref.set(replacement));
  }
  await seedFirestore(async (db) => db.doc('users/alice').update({ accountDeletionInProgress: false }));
  await assertSucceeds(ref.update({ displayName: 'Updated' }));
  await assertFails(ref.update({ notificationDeliveryDisabled: false }));
});

test('push provider receipts are server-only even for the recipient', async () => {
  for (const name of ['pendingPushReceipts', 'pushReceiptResults']) {
    await seedFirestore(async (db) => db.collection(name).doc('one').set({ uid: 'alice' }));
    for (const context of [testEnv.authenticatedContext('alice'), testEnv.authenticatedContext('bob'), testEnv.unauthenticatedContext()]) {
      const ref = context.firestore().collection(name).doc('one');
      await assertFails(ref.get());
      await assertFails(ref.set({ uid: 'alice' }));
      await assertFails(ref.delete());
    }
  }
});

test('friends can read a shared personal timetable, strangers cannot', async () => {
  const timetable = {
    schoolId: 'pu',
    shareWithFriends: true,
    courses: [{ id: 'db', name: '資料庫', day: 1, start: 3, end: 4 }],
    meta: {},
  };
  await seedFirestore(async (db) => {
    await db.doc('users/alice').set({ displayName: 'Alice' });
    await db.doc('users/bob').set({ displayName: 'Bob' });
    await db.doc('users/carol').set({ displayName: 'Carol' });
    await db.doc('schools/pu/members/alice').set({ status: 'active', role: 'student' });
    await db.doc('schools/pu/members/bob').set({ status: 'active', role: 'student' });
    await db.doc('schools/pu/members/carol').set({ status: 'active', role: 'student' });
    await db.doc('friendships/req_pu_alice_bob').set({
      schoolId: 'pu', fromUid: 'alice', toUid: 'bob', status: 'accepted',
    });
    await db.doc('users/alice/personalTimetable/current').set(timetable);
  });
  await assertSucceeds(
    testEnv.authenticatedContext('alice').firestore().doc('users/alice/personalTimetable/current').get(),
  );
  await assertSucceeds(
    testEnv.authenticatedContext('bob').firestore().doc('users/alice/personalTimetable/current').get(),
  );
  await assertFails(
    testEnv.authenticatedContext('carol').firestore().doc('users/alice/personalTimetable/current').get(),
  );
  await assertFails(
    testEnv.authenticatedContext('bob').firestore().doc('users/alice/personalTimetable/current').update({ courses: [] }),
  );
});

test('public timetable shares are readable until they expire or are revoked', async () => {
  const future = new Date(Date.now() + 86400000);
  const past = new Date(Date.now() - 1000);
  await seedFirestore(async (db) => {
    await db.doc('timetableShares/live').set({
      ownerUid: 'alice', revoked: false, expiresAt: future, courses: [], name: '課表',
    });
    await db.doc('timetableShares/old').set({
      ownerUid: 'alice', revoked: false, expiresAt: past, courses: [], name: '課表',
    });
    await db.doc('timetableShares/gone').set({
      ownerUid: 'alice', revoked: true, expiresAt: future, courses: [], name: '課表',
    });
  });
  const guest = testEnv.unauthenticatedContext().firestore();
  await assertSucceeds(guest.doc('timetableShares/live').get());
  await assertFails(guest.doc('timetableShares/old').get());
  await assertFails(guest.doc('timetableShares/gone').get());
  await assertFails(guest.doc('timetableShares/live').set({ name: 'x' }));
  await assertFails(guest.collection('timetableShares').get());
  await seedFirestore(async (db) => db.doc('timetableShareOwners/live').set({ ownerUid: 'alice' }));
  await assertFails(guest.doc('timetableShareOwners/live').get());
  await assertFails(testEnv.authenticatedContext('alice').firestore().doc('timetableShareOwners/live').get());
});


test('only the invitee can accept a friend request', async () => {
  await seedFirestore(async (db) => {
    for (const uid of ['alice', 'carol', 'mallory']) {
      await db.doc(`schools/pu/members/${uid}`).set({ status: 'active', role: 'student' });
    }
    await db.doc('users/carol').set({ displayName: '丙' });
    await db.doc('users/carol/personalTimetable/current').set({
      schoolId: 'pu',
      shareWithFriends: true,
      courses: [{ id: 'x', name: '丙的課', day: 2, start: 1, end: 2 }],
      meta: {},
    });
  });
  const alice = testEnv.authenticatedContext('alice').firestore();
  const carol = testEnv.authenticatedContext('carol').firestore();
  const mallory = testEnv.authenticatedContext('mallory').firestore();

  await assertSucceeds(
    alice.doc('friendships/req_pu_alice_carol').set({ schoolId: 'pu', fromUid: 'alice', toUid: 'carol', status: 'pending' }),
  );
  // 送出邀請的人不能自己改成已接受，也不能直接建立已接受的邀請
  await assertFails(alice.doc('friendships/req_pu_alice_carol').update({ status: 'accepted' }));
  await assertFails(
    alice.doc('friendships/req_pu_alice_mallory').set({ schoolId: 'pu', fromUid: 'alice', toUid: 'mallory', status: 'accepted' }),
  );
  await assertFails(alice.doc('users/carol/personalTimetable/current').get());

  // 文件編號要跟雙方對得起來，不能借別人的編號
  await assertFails(
    alice.doc('friendships/req_pu_alice_carol2').set({ schoolId: 'pu', fromUid: 'alice', toUid: 'mallory', status: 'pending' }),
  );
  await assertFails(
    mallory.doc('friendships/req_pu_alice_carol').set({ schoolId: 'pu', fromUid: 'mallory', toUid: 'carol', status: 'pending' }),
  );

  // 被邀請的人接受之後，雙方才看得到課表
  await assertSucceeds(carol.doc('friendships/req_pu_alice_carol').update({ status: 'accepted', toName: '丙' }));
  await assertSucceeds(alice.doc('users/carol/personalTimetable/current').get());

  // 已接受之後也不能被任一方改回待確認或改成別人
  await assertFails(alice.doc('friendships/req_pu_alice_carol').update({ status: 'pending' }));
  await assertFails(carol.doc('friendships/req_pu_alice_carol').update({ toUid: 'mallory' }));
  // 封鎖不改這筆的狀態；要斷掉就刪掉好友，再另外記一筆封鎖
  await assertFails(alice.doc('friendships/req_pu_alice_carol').update({ status: 'blocked' }));
  await assertSucceeds(carol.doc('friendBlocks/carol_alice').set({ schoolId: 'pu', blockerUid: 'carol', blockedUid: 'alice' }));
  await assertSucceeds(carol.doc('friendships/req_pu_alice_carol').delete());
  await assertFails(alice.doc('users/carol/personalTimetable/current').get());
  // 被封鎖的人不能再送邀請，也看不到封鎖紀錄
  await assertFails(alice.doc('friendBlocks/carol_alice').get());
  await assertFails(alice.doc('friendships/req_pu_alice_carol').set({ schoolId: 'pu', fromUid: 'alice', toUid: 'carol', status: 'pending' }));
});

test('handles can be looked up one at a time but never listed', async () => {
  await seedFirestore(async (db) => {
    await db.doc('schools/pu/members/alice').set({ status: 'active', role: 'student' });
    await db.doc('schools/pu/members/bob').set({ status: 'active', role: 'student' });
    await db.doc('users/alice').set({ displayName: 'Alice' });
    await db.doc('users/bob').set({ displayName: 'Bob' });
  });
  const alice = testEnv.authenticatedContext('alice').firestore();
  const bob = testEnv.authenticatedContext('bob').firestore();
  // 找人代號上的名字只能是自己個人資料的名字
  await assertFails(alice.doc('schools/pu/handles/alice_02').set({ uid: 'alice', name: '教務處', handle: 'alice_02' }));
  const stranger = testEnv.authenticatedContext('stranger').firestore();
  await assertSucceeds(
    alice.doc('schools/pu/handles/alice_01').set({ uid: 'alice', name: 'Alice', handle: 'alice_01' }),
  );
  await assertFails(bob.doc('schools/pu/handles/bob_01').set({ uid: 'alice', name: 'Bob', handle: 'bob_01' }));
  await assertFails(bob.doc('schools/pu/handles/alice_01').update({ uid: 'bob', name: 'Bob', handle: 'alice_01' }));
  await assertSucceeds(bob.doc('schools/pu/handles/alice_01').get());
  await assertFails(bob.collection('schools/pu/handles').get());
  await assertFails(stranger.doc('schools/pu/handles/alice_01').get());
});

test('assistant replies can only be written by the server, never by a student', async () => {
  await seedFirestore(async (db) => {
    await db.doc('groups/g1').set({ schoolId: 'pu', name: '課' });
    await db.doc('groups/g1/members/alice').set({ status: 'active', role: 'member' });
    await db.doc('groups/g1/members/bob').set({ status: 'active', role: 'member' });
    await db.doc('groups/g1/members/tina').set({ status: 'active', role: 'owner' });
    await db.doc('groups/g1/posts/q1').set({ kind: 'question', authorId: 'alice', title: '問', body: '問' });
    await db.doc('groups/g1/posts/q2').set({ kind: 'question', authorId: 'alice', title: '問2', body: '問2' });
    // 伺服器寫的助理回覆
    await db.doc('groups/g1/posts/q1/comments/assistant').set({
      body: '伺服器的回覆', authorId: 'campus-assistant', authorName: '助理回覆', isAI: true, requestedBy: 'alice', generatedBy: 'server',
    });
    await db.doc('groups/g1/posts/q1').update({ assistantReply: { status: 'done' } });
  });
  const alice = testEnv.authenticatedContext('alice').firestore();
  const bob = testEnv.authenticatedContext('bob').firestore();
  const tina = testEnv.authenticatedContext('tina').firestore();
  const fake = { body: '學校說期末考取消（偽造）', authorId: 'campus-assistant', authorName: '助理回覆', isAI: true, requestedBy: 'alice' };
  // 學生回報的偽造：發問的人在自己的提問底下用助理名義寫 → 擋
  await assertFails(alice.collection('groups/g1/posts/q1/comments').add(fake));
  await assertFails(alice.doc('groups/g1/posts/q1/comments/assistant2').set(fake));
  await assertFails(alice.collection('groups/g1/posts/q1/comments').add({ ...fake, authorId: 'alice' }));
  await assertFails(alice.collection('groups/g1/posts/q1/comments').add({ body: 'x', authorId: 'alice', authorName: '助理回覆' }));
  await assertFails(alice.collection('groups/g1/posts/q1/comments').add({ body: 'x', authorId: 'alice', generatedBy: 'server' }));
  // 先佔住 comments/assistant 這格：就算寫成自己名下的普通留言也不行，老師也不行
  await assertFails(alice.doc('groups/g1/posts/q2/comments/assistant').set({ body: '先佔位', authorId: 'alice' }));
  await assertFails(tina.doc('groups/g1/posts/q2/comments/assistant').set({ body: '先佔位', authorId: 'tina' }));
  // 不能改寫、刪掉伺服器的助理回覆，老師也不行
  await assertFails(alice.doc('groups/g1/posts/q1/comments/assistant').update({ body: '學校說期末考取消' }));
  await assertFails(alice.doc('groups/g1/posts/q1/comments/assistant').delete());
  await assertFails(alice.doc('groups/g1/posts/q1/comments/assistant').set(fake));
  await assertFails(tina.doc('groups/g1/posts/q1/comments/assistant').update({ isBestAnswer: true }));
  await assertFails(tina.doc('groups/g1/posts/q1/comments/assistant').delete());
  // 自己的留言之後也不能改成助理回覆
  const own = await alice.collection('groups/g1/posts/q1/comments').add({ body: '補充', authorId: 'alice' });
  await assertFails(own.update({ isAI: true }));
  await assertFails(own.update({ authorName: '助理回覆' }));
  await assertFails(own.update({ generatedBy: 'server' }));
  // 提問上的助理回覆狀態只有伺服器能寫
  await assertFails(alice.doc('groups/g1/posts/q1').update({ assistantReply: { status: 'unavailable' } }));
  await assertFails(tina.doc('groups/g1/posts/q1').update({ assistantReply: null }));
  await assertFails(alice.collection('groups/g1/posts').add({ kind: 'question', authorId: 'alice', title: 't', body: 'b', assistantReply: { status: 'done' } }));
  await assertSucceeds(alice.doc('groups/g1/posts/q1').update({ title: '問（改）' }));
  // 一般留言照常
  await assertSucceeds(bob.collection('groups/g1/posts/q1/comments').add({ body: '我也想知道', authorId: 'bob' }));
  await assertSucceeds(alice.doc('groups/g1/posts/q1/comments/assistant').get());
});
test('course appeals need a course from the student own timetable and only its teacher can approve', async () => {
  await seedFirestore(async (db) => {
    await db.doc('schools/pu/members/stu').set({ status: 'active', role: 'student' });
    await db.doc('schools/pu/members/teach').set({ status: 'active', role: 'teacher' });
    await db.doc('users/stu/personalTimetable/current').set({
      courses: [], courseIds: ['db'], offeringIds: ['資料庫｜王老師'],
    });
  });
  const stu = testEnv.authenticatedContext('stu').firestore();
  const teach = testEnv.authenticatedContext('teach').firestore();
  const appeal = {
    schoolId: 'pu', studentUid: 'stu', courseId: 'db', courseName: '資料庫', offeringId: '資料庫｜王老師',
    title: '出缺席紀錄', body: '當天有請假單可以補', status: 'pending', teacherNote: '',
  };
  await assertFails(stu.doc('courseAppeals/no-course').set({ ...appeal, courseId: '', courseName: '' }));
  // 自己打的課（不在自己的課表裡）不收
  await assertFails(stu.doc('courseAppeals/free').set({ ...appeal, courseId: 'made-up', courseName: '亂打的課' }));
  await assertFails(stu.doc('courseAppeals/free2').set({ ...appeal, offeringId: '資料庫｜李老師' }));
  const { offeringId, ...noOffering } = appeal;
  void offeringId;
  await assertFails(stu.doc('courseAppeals/free3').set(noOffering));
  // 學生直接讀不到老師對應（有沒有對應只能透過伺服器拿到 true/false，看不到老師是誰）
  await assertFails(stu.doc('schools/pu/courseTeachers/資料庫｜王老師').get());
  await assertSucceeds(stu.doc('courseAppeals/a1').set(appeal));
  // 同一個編號再送一次不會多一筆
  await assertFails(stu.doc('courseAppeals/a1').set(appeal));
  await assertFails(stu.doc('courseAppeals/a1').update({ status: 'approved' }));
  // 老師還沒對應到課程時，什麼都看不到、也不能核准
  await assertFails(teach.doc('courseAppeals/a1').get());
  await assertFails(teach.doc('courseAppeals/a1').update({ status: 'approved', teacherNote: '好' }));
  await seedFirestore(async (db) => {
    await db.doc('schools/pu/courseTeachers/資料庫｜王老師').set({ teacherUids: ['teach'] });
  });
  await assertSucceeds(teach.doc('courseAppeals/a1').get());
  await assertSucceeds(
    teach.collection('courseAppeals').where('schoolId', '==', 'pu').where('offeringId', '==', '資料庫｜王老師').get(),
  );
  // 不能一次列全校
  await assertFails(teach.collection('courseAppeals').where('schoolId', '==', 'pu').get());
  // 只能改狀態和回覆
  await assertFails(teach.doc('courseAppeals/a1').update({ status: 'approved', body: '改掉學生的說明' }));
  await assertFails(teach.doc('courseAppeals/a1').update({ status: 'approved', courseName: '英文' }));
  await assertFails(teach.doc('courseAppeals/a1').update({ status: 'approved', offeringId: '英文｜陳老師' }));
  await assertFails(teach.doc('courseAppeals/a1').update({ status: 'approved', title: '改主旨' }));
  await assertSucceeds(teach.doc('courseAppeals/a1').update({ status: 'approved', teacherNote: '好' }));
  await assertSucceeds(stu.doc('courseAppeals/a1').get());
  await assertFails(stu.doc('schools/pu/courseTeachers/資料庫｜王老師').get());
  await assertFails(stu.collection('schools/pu/courseTeachers').get());
  // 學生撤回也不能順便改內容
  await assertSucceeds(stu.doc('courseAppeals/a2').set({ ...appeal, title: '第二件事情' }));
  await assertFails(stu.doc('courseAppeals/a2').update({ status: 'withdrawn', body: '偷偷改掉說明內容' }));
});

test('same-name courses taught by two teachers stay apart', async () => {
  await seedFirestore(async (db) => {
    await db.doc('schools/pu/members/stu').set({ status: 'active', role: 'student' });
    await db.doc('schools/pu/members/t1').set({ status: 'active', role: 'teacher' });
    await db.doc('schools/pu/members/t2').set({ status: 'active', role: 'teacher' });
    await db.doc('schools/pu/courseTeachers/資料庫｜王老師').set({ teacherUids: ['t1'] });
    await db.doc('schools/pu/courseTeachers/資料庫｜李老師').set({ teacherUids: ['t2'] });
    await db.doc('schools/pu/courseTeachers/英文｜陳老師').set({ teacherUids: ['t3'] });
    const base = { schoolId: 'pu', studentUid: 'stu', title: '出缺席紀錄', body: '當天有請假單可以補', status: 'pending', teacherNote: '', courseName: '資料庫' };
    await db.doc('courseAppeals/wang').set({ ...base, courseId: 'c1', offeringId: '資料庫｜王老師' });
    await db.doc('courseAppeals/lee').set({ ...base, courseId: 'c2', offeringId: '資料庫｜李老師' });
    await db.doc('courseAppeals/en').set({ ...base, courseId: 'c3', courseName: '英文', offeringId: '英文｜陳老師' });
    // 舊的申訴沒有開課代號：老師都看不到
    await db.doc('courseAppeals/legacy').set({ ...base, courseId: 'c4' });
  });
  const t1 = testEnv.authenticatedContext('t1').firestore();
  const t2 = testEnv.authenticatedContext('t2').firestore();
  await assertSucceeds(t1.doc('courseAppeals/wang').get());
  await assertFails(t1.doc('courseAppeals/lee').get());
  await assertFails(t1.doc('courseAppeals/lee').update({ status: 'approved' }));
  await assertFails(t1.collection('courseAppeals').where('schoolId', '==', 'pu').where('offeringId', '==', '資料庫｜李老師').get());
  await assertSucceeds(t2.doc('courseAppeals/lee').get());
  await assertFails(t2.doc('courseAppeals/wang').get());
  await assertFails(t2.doc('courseAppeals/wang').update({ status: 'approved' }));
  await assertFails(t1.doc('courseAppeals/en').get());
  await assertFails(t1.doc('courseAppeals/legacy').get());
  // 自己的課也不能改學生寫的說明
  await assertFails(t1.doc('courseAppeals/wang').update({ body: '老師改的說明內容' }));
  await assertSucceeds(t1.doc('courseAppeals/wang').update({ status: 'rejected', teacherNote: '請附證明' }));
  await assertSucceeds(t2.doc('courseAppeals/lee').update({ status: 'approved', teacherNote: '好' }));
  // 老師只看得到自己有教的課程對應
  await assertSucceeds(t1.doc('schools/pu/courseTeachers/資料庫｜王老師').get());
  await assertFails(t1.doc('schools/pu/courseTeachers/資料庫｜李老師').get());
  await assertSucceeds(t1.collection('schools/pu/courseTeachers').where('teacherUids', 'array-contains', 't1').get());
  await assertFails(t1.collection('schools/pu/courseTeachers').get());
  await assertFails(t1.doc('schools/pu/courseTeachers/資料庫｜王老師').set({ teacherUids: ['t1', 'x'] }));
});
test('a declined sender has to wait seven days before sending again', async () => {
  const { serverTimestamp } = require('firebase/firestore');
  await seedFirestore(async (db) => {
    for (const uid of ['amy', 'ben']) await db.doc(`schools/pu/members/${uid}`).set({ status: 'active', role: 'student' });
  });
  const amy = testEnv.authenticatedContext('amy').firestore();
  const ben = testEnv.authenticatedContext('ben').firestore();
  const id = 'friendships/req_pu_amy_ben';
  await assertSucceeds(amy.doc(id).set({ schoolId: 'pu', fromUid: 'amy', toUid: 'ben', status: 'pending' }));
  // 婉拒一定要帶伺服器時間
  await assertFails(ben.doc(id).update({ status: 'declined' }));
  await assertSucceeds(ben.doc(id).update({ status: 'declined', declinedAt: serverTimestamp() }));
  // 七天內送出邀請的人不能刪掉重送，也不能改回待確認
  await assertFails(amy.doc(id).delete());
  await assertFails(amy.doc(id).update({ status: 'pending' }));
  // 過了七天就可以
  await seedFirestore(async (db) => db.doc(id).update({ declinedAt: new Date(Date.now() - 8 * 86400000) }));
  await assertSucceeds(amy.doc(id).delete());
  await assertSucceeds(amy.doc(id).set({ schoolId: 'pu', fromUid: 'amy', toUid: 'ben', status: 'pending' }));
});

test('friend invite names always come from the profiles, not from the sender', async () => {
  await seedFirestore(async (db) => {
    for (const uid of ['eve', 'dan']) await db.doc(`schools/pu/members/${uid}`).set({ status: 'active', role: 'student' });
    await db.doc('users/eve').set({ displayName: '小芸' });
    await db.doc('users/dan').set({ displayName: '阿丹' });
  });
  const eve = testEnv.authenticatedContext('eve').firestore();
  const dan = testEnv.authenticatedContext('dan').firestore();
  const id = 'friendships/req_pu_eve_dan';
  const base = { schoolId: 'pu', fromUid: 'eve', toUid: 'dan', status: 'pending' };
  // 冒充別人的名字會被擋
  await assertFails(eve.doc(id).set({ ...base, fromName: '教務處' }));
  await assertFails(eve.doc(id).set({ ...base, fromName: '小芸', toName: '校長' }));
  // 用自己個人資料的名字可以
  await assertSucceeds(eve.doc(id).set({ ...base, fromName: '小芸', toName: '阿丹' }));
  await assertFails(eve.doc(id).update({ fromName: '教務處' }));
  // 被邀請的人接受時，也只能寫自己的名字
  await assertFails(dan.doc(id).update({ status: 'accepted', toName: '教務處' }));
  await assertSucceeds(dan.doc(id).update({ status: 'accepted', toName: '阿丹' }));
  await assertFails(eve.doc(id).update({ status: 'blocked', toName: '教務處' }));
});

test('the seven-day wait cannot be skipped by blocking, deleting or unblocking', async () => {
  const { serverTimestamp } = require('firebase/firestore');
  await seedFirestore(async (db) => {
    for (const uid of ['ann', 'cat']) await db.doc(`schools/pu/members/${uid}`).set({ status: 'active', role: 'student' });
  });
  const ann = testEnv.authenticatedContext('ann').firestore();
  const cat = testEnv.authenticatedContext('cat').firestore();
  const id = 'friendships/req_pu_ann_cat';
  const invite = { schoolId: 'pu', fromUid: 'ann', toUid: 'cat', status: 'pending' };
  await assertSucceeds(ann.doc(id).set(invite));
  await assertSucceeds(cat.doc(id).update({ status: 'declined', declinedAt: serverTimestamp() }));
  // 學生回報的繞法：先改成 blocked 再刪掉、馬上重送 → 每一步都要擋
  await assertFails(ann.doc(id).update({ status: 'blocked' }));
  await assertFails(ann.doc(id).delete());
  await assertFails(ann.doc(id).set(invite));
  // 舊版留下來的 blocked 也一樣要等七天
  await seedFirestore(async (db) => db.doc(id).update({ status: 'blocked' }));
  await assertFails(ann.doc(id).delete());
  await seedFirestore(async (db) => db.doc(id).update({ status: 'declined' }));
  // (b) 送出的人另外封鎖再解除，七天也不會重算或被跳過
  await assertSucceeds(ann.doc('friendBlocks/ann_cat').set({ schoolId: 'pu', blockerUid: 'ann', blockedUid: 'cat' }));
  await assertFails(ann.doc('friendBlocks/ann_cat').update({ blockedUid: 'cat' }));
  await assertSucceeds(ann.doc('friendBlocks/ann_cat').delete());
  await assertFails(ann.doc(id).delete());
  await assertFails(ann.doc(id).set(invite));
  const left = await cat.doc(id).get();
  if (left.data().status !== 'declined') throw new Error('status changed');
  // 不能替別人記封鎖
  await assertFails(ann.doc('friendBlocks/cat_ann').set({ schoolId: 'pu', blockerUid: 'cat', blockedUid: 'ann' }));
  // (a) 婉拒的人自己還是可以封鎖、解除封鎖
  await assertSucceeds(cat.doc('friendBlocks/cat_ann').set({ schoolId: 'pu', blockerUid: 'cat', blockedUid: 'ann' }));
  await assertSucceeds(cat.doc('friendBlocks/cat_ann').get());
  await assertSucceeds(cat.doc('friendBlocks/cat_ann').delete());
  // 婉拒的那筆七天內誰都不能刪：就算婉拒的人想刪，送出的人也不會因此馬上能重送
  await assertFails(cat.doc(id).delete());
  await assertFails(ann.doc(id).set(invite));
  // 過了七天才可以刪掉重送
  await seedFirestore(async (db) =>
    db.doc(id).set({ ...invite, status: 'declined', declinedAt: new Date(Date.now() - 8 * 86400000) }),
  );
  await assertSucceeds(cat.doc(id).delete());
  await assertSucceeds(ann.doc(id).set(invite));
});

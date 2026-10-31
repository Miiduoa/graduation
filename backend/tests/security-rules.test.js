const { after, before, beforeEach, describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} = require('@firebase/rules-unit-testing');
const { deleteField } = require('firebase/firestore');

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
    await assertSucceeds(
      db
        .collection('schools')
        .doc('tw-demo-uni')
        .collection('cafeterias')
        .doc('cafeteria-1')
        .update({
          intro: '紙感小店',
          merchantMode: 'showcase_link',
          orderingUrl: 'https://shop.example/order',
          updatedAt: new Date(),
        }),
    );
    await assertFails(
      db
        .collection('schools')
        .doc('tw-demo-uni')
        .collection('cafeterias')
        .doc('cafeteria-1')
        .update({
          merchantMode: 'native_order',
        }),
    );
    await assertFails(
      db
        .collection('schools')
        .doc('tw-demo-uni')
        .collection('cafeterias')
        .doc('cafeteria-1')
        .update({
          orderingUrl: ' https://shop.example/order',
        }),
    );
    await assertFails(
      db
        .collection('schools')
        .doc('tw-demo-uni')
        .collection('cafeterias')
        .doc('cafeteria-1')
        .update({
          websiteUrl: 'https://shop.example/order ',
        }),
    );
    await assertFails(
      db
        .collection('schools')
        .doc('tw-demo-uni')
        .collection('cafeterias')
        .doc('cafeteria-1')
        .update({
          orderingUrl: 'http://shop.example/order',
        }),
    );
    await assertFails(
      db
        .collection('schools')
        .doc('tw-demo-uni')
        .collection('cafeterias')
        .doc('cafeteria-1')
        .update({
          websiteUrl: 'https://user:pass@shop.example',
        }),
    );
    await assertSucceeds(
      db
        .collection('schools')
        .doc('tw-demo-uni')
        .collection('cafeterias')
        .doc('cafeteria-1')
        .update({
          websiteUrl: 'https://shop.example',
          orderingUrl: '',
        }),
    );
    await assertSucceeds(
      db
        .collection('schools')
        .doc('tw-demo-uni')
        .collection('cafeterias')
        .doc('cafeteria-1')
        .collection('posts')
        .doc('post-1')
        .set({ text: '週四折抵', authorId: 'merchant-1' }),
    );
    const student = testEnv.authenticatedContext('alice').firestore();
    await assertSucceeds(
      student
        .collection('schools')
        .doc('tw-demo-uni')
        .collection('cafeterias')
        .doc('cafeteria-1')
        .collection('followers')
        .doc('alice')
        .set({ createdAt: new Date() }),
    );
    await assertSucceeds(
      student
        .collection('schools')
        .doc('tw-demo-uni')
        .collection('cafeterias')
        .doc('cafeteria-1')
        .collection('posts')
        .doc('post-1')
        .collection('likes')
        .doc('alice')
        .set({ createdAt: new Date() }),
    );
    await assertSucceeds(
      student
        .collection('schools')
        .doc('tw-demo-uni')
        .collection('cafeterias')
        .doc('cafeteria-1')
        .collection('posts')
        .doc('post-1')
        .collection('comments')
        .doc('c1')
        .set({ authorId: 'alice', text: '收到' }),
    );
    await assertFails(
      student
        .collection('schools')
        .doc('tw-demo-uni')
        .collection('announcement-sources')
        .doc('pu-acd')
        .set({ status: 'healthy' }),
    );
    await assertSucceeds(
      student
        .collection('users')
        .doc('alice')
        .collection('schools')
        .doc('tw-demo-uni')
        .collection('externalOrders')
        .doc('click-1')
        .set({
          fulfillment: 'external',
          schoolId: 'tw-demo-uni',
          cafeteriaId: 'cafeteria-1',
          orderingUrl: 'https://shop.example/order',
        }),
    );
    await assertFails(
      student
        .collection('users')
        .doc('alice')
        .collection('schools')
        .doc('tw-demo-uni')
        .collection('externalOrders')
        .doc('click-2')
        .set({
          fulfillment: 'external',
          schoolId: 'tw-demo-uni',
          cafeteriaId: 'cafeteria-1',
          orderingUrl: 'https://shop.example/order',
          paymentStatus: 'paid',
        }),
    );
    const rejectedStorefrontUrls = [
      'javascript:alert(1)',
      'https://a@evil.com',
      `https://shop.example/${'a'.repeat(2048)}`,
      ' https://shop.example/order',
      'https://shop.example/order ',
      'http://shop.example/order',
      'data:text/html,hi',
      'https://shop.example/order\u0000',
    ];
    for (const orderingUrl of rejectedStorefrontUrls) {
      await assertFails(
        db
          .collection('schools')
          .doc('tw-demo-uni')
          .collection('cafeterias')
          .doc('cafeteria-1')
          .update({ orderingUrl }),
      );
      await assertFails(
        db
          .collection('schools')
          .doc('tw-demo-uni')
          .collection('cafeterias')
          .doc('cafeteria-1')
          .update({ websiteUrl: orderingUrl }),
      );
      await assertFails(
        student
          .collection('users')
          .doc('alice')
          .collection('schools')
          .doc('tw-demo-uni')
          .collection('externalOrders')
          .doc(`bad-${Buffer.from(orderingUrl).toString('hex').slice(0, 24)}`)
          .set({
            fulfillment: 'external',
            schoolId: 'tw-demo-uni',
            cafeteriaId: 'cafeteria-1',
            orderingUrl,
          }),
      );
    }
    await assertFails(
      student
        .collection('schools')
        .doc('tw-demo-uni')
        .collection('cafeterias')
        .doc('cafeteria-1')
        .update({
          websiteUrl: 'https://evil.example',
          orderingUrl: 'https://evil.example/order',
        }),
    );
    await assertSucceeds(
      db
        .collection('schools')
        .doc('tw-demo-uni')
        .collection('cafeterias')
        .doc('cafeteria-1')
        .update({
          websiteUrl: 'HTTPS://shop.example',
          orderingUrl: 'HTTPS://shop.example/order',
          updatedAt: new Date(),
        }),
    );
    await assertSucceeds(
      student
        .collection('users')
        .doc('alice')
        .collection('schools')
        .doc('tw-demo-uni')
        .collection('externalOrders')
        .doc('click-https')
        .set({
          fulfillment: 'external',
          schoolId: 'tw-demo-uni',
          cafeteriaId: 'cafeteria-1',
          orderingUrl: 'HTTPS://shop.example/order',
        }),
    );
  });

  test('學生和別家店改不了別人的外連網址', async () => {
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
          websiteUrl: 'https://shop.example',
          orderingUrl: 'https://shop.example/order',
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
      await db
        .collection('schools')
        .doc('tw-demo-uni')
        .collection('cafeterias')
        .doc('cafeteria-2')
        .set({
          name: '第二餐廳',
          orderingEnabled: true,
          pilotStatus: 'live',
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
    });
    const student = testEnv.authenticatedContext('alice').firestore();
    const otherShop = testEnv.authenticatedContext('merchant-2').firestore();
    const owner = testEnv.authenticatedContext('merchant-1').firestore();
    await assertFails(
      student
        .collection('schools')
        .doc('tw-demo-uni')
        .collection('cafeterias')
        .doc('cafeteria-1')
        .update({
          websiteUrl: 'https://evil.example',
          orderingUrl: 'https://evil.example/order',
        }),
    );
    await assertFails(
      otherShop
        .collection('schools')
        .doc('tw-demo-uni')
        .collection('cafeterias')
        .doc('cafeteria-1')
        .update({
          websiteUrl: 'https://other.example',
          orderingUrl: 'https://other.example/order',
        }),
    );
    await assertSucceeds(
      owner
        .collection('schools')
        .doc('tw-demo-uni')
        .collection('cafeterias')
        .doc('cafeteria-1')
        .update({
          websiteUrl: 'https://shop.example/home',
          orderingUrl: 'https://shop.example/menu',
          updatedAt: new Date(),
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

  test('學生 B 讀不到學生 A 的單：店家那份、自己的副本、舊的 /orders 都一樣', async () => {
    const school = 'schools/tw-demo-uni';
    const receipt = { userId: 'alice', schoolId: 'tw-demo-uni', cafeteriaId: 'cafe-a', status: 'pending', queueNumber: 7 };
    await seedFirestore(async (db) => {
      await db.doc(`${school}/orders/r1`).set(receipt);
      await db.doc('users/alice/schools/tw-demo-uni/orders/r1').set(receipt);
      await db.doc('orders/r1').set(receipt);
    });
    const alice = testEnv.authenticatedContext('alice').firestore();
    const bob = testEnv.authenticatedContext('bob').firestore();
    await assertSucceeds(alice.collection('users/alice/schools/tw-demo-uni/orders').orderBy('createdAt', 'desc').limit(30).get());
    await assertSucceeds(alice.collection(`${school}/orders`).where('userId', '==', 'alice').get());

    await assertFails(bob.doc(`${school}/orders/r1`).get());
    await assertFails(bob.doc('users/alice/schools/tw-demo-uni/orders/r1').get());
    await assertFails(bob.collection('users/alice/schools/tw-demo-uni/orders').orderBy('createdAt', 'desc').limit(30).get());
    await assertFails(bob.collection(`${school}/orders`).where('userId', '==', 'alice').get());
    await assertFails(bob.collection(`${school}/orders`).get());
    await assertFails(bob.doc('orders/r1').get());
    await assertFails(bob.collection('orders').where('userId', '==', 'alice').get());
    await assertFails(bob.collectionGroup('orders').where('userId', '==', 'alice').get());
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

  test('only active instructors may read immutable attendance corrections', async () => {
    await seedFirestore(async (db) => {
      const group = db.collection('groups').doc('group-1');
      await group.set({ schoolId: 'tw-demo-uni', type: 'course' });
      await db.collection('schools').doc('tw-demo-uni').collection('members').doc('teacher').set({
        role: 'faculty', status: 'active',
      });
      await db.collection('schools').doc('tw-demo-uni').collection('members').doc('alice').set({
        role: 'student', status: 'active',
      });
            await group.collection('members').doc('teacher').set({
        role: 'instructor', status: 'active',
      });
      await group.collection('members').doc('alice').set({
        role: 'member', status: 'active',
      });
      await group.collection('attendanceSessions').doc('session-1').set({
        active: false, schemaVersion: 2,
      });
      await group
        .collection('attendanceSessions').doc('session-1')
        .collection('attendanceCorrections').doc('change-1').set({
          teacherUid: 'teacher',
          studentUid: 'alice',
          previousStatus: null,
          nextStatus: 'absent',
          reason: '授課教師現場核實缺席',
        });
    });

    const path = 'groups/group-1/attendanceSessions/session-1/attendanceCorrections/change-1';
    const teacher = testEnv.authenticatedContext('teacher').firestore();
    const student = testEnv.authenticatedContext('alice').firestore();
    const outsider = testEnv.authenticatedContext('outsider').firestore();
    await assertSucceeds(teacher.doc(path).get());
    await assertFails(student.doc(path).get());
    await assertFails(outsider.doc(path).get());
    await assertFails(teacher.doc(path).set({ nextStatus: 'present' }, { merge: true }));
    await assertFails(student.doc(path).delete());
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
        await db.doc(`schools/tw-demo-uni/members/${uid}`).set({
          role: 'student',
          status: 'active',
        });
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
      // A same-school account with a stale review assignment must not gain
      // access without current membership in this course.
      await db.doc('schools/tw-demo-uni/members/outsider').set({
        role: 'student', status: 'active',
      });
      await db.doc('groups/group-1/assignments/assignment-1/peerReviews/outsider').set({
        reviewerId: 'outsider', submissionOwnerId: 'bob',
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
    const outsiderDb = testEnv.authenticatedContext('outsider').firestore();
    await assertFails(
      outsiderDb.doc('groups/group-1/assignments/assignment-1/submissions/bob').get(),
    );
  });

  test('signed-in users can read pulse aggregates; guests and writers cannot', async () => {
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
    await assertFails(
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
    await assertSucceeds(
      aliceDb
        .collection('schools')
        .doc('tw-demo-uni')
        .collection('pulseAggregates')
        .doc('library')
        .get(),
    );
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

  test('guests can read campus announcements but not lost-and-found or reviews', async () => {
    await seedFirestore(async (db) => {
      const school = db.collection('schools').doc('pu');
      await school.set({ name: '靜宜大學' });
      await school.collection('announcements').doc('notice-1').set({
        title: '停課通知',
        schoolId: 'pu',
      });
      await school.collection('lostFound').doc('item-1').set({
        title: '遺失學生證',
        userId: 'alice',
        phone: '0900000000',
      });
      await school.collection('pois').doc('lib').set({ name: '圖書館' });
      await school.collection('pois').doc('lib').collection('reviews').doc('rev-1').set({
        uid: 'alice',
        text: '很安靜',
      });
      await school.collection('cafeterias').doc('cafe-1').set({ name: '一餐' });
      await school
        .collection('cafeterias')
        .doc('cafe-1')
        .collection('posts')
        .doc('post-1')
        .set({ text: '今日特餐' });
      await school
        .collection('cafeterias')
        .doc('cafe-1')
        .collection('posts')
        .doc('post-1')
        .collection('comments')
        .doc('c1')
        .set({ authorId: 'alice', text: '收到' });
      await school
        .collection('cafeterias')
        .doc('cafe-1')
        .collection('posts')
        .doc('post-1')
        .collection('likes')
        .doc('alice')
        .set({ createdAt: '2026-10-13' });
      await school.collection('cafeterias').doc('cafe-1').collection('followers').doc('alice').set({
        createdAt: '2026-10-13',
      });
      await school.collection('leaderboard').doc('weekly').set({ uid: 'alice', score: 12 });
      await school.collection('pulseAggregates').doc('library').set({ currentLevel: 2 });
      await school.collection('menus').doc('bento').set({ name: '便當' });
      await school.collection('busRoutes').doc('route-1').set({ name: '校車' });
      await school.collection('events').doc('event-1').set({ title: '迎新' });
      await db.collection('courses').doc('cs101').set({ name: '程式設計' });
      await db.collection('lostFoundItems').doc('item-2').set({
        userId: 'alice',
        title: '雨傘',
      });
      await db.collection('menuRatings').doc('rate-1').set({
        userId: 'alice',
        menuItemId: 'bento',
        score: 5,
      });
    });

    const guest = testEnv.unauthenticatedContext().firestore();
    await assertSucceeds(guest.doc('schools/pu/announcements/notice-1').get());
    await assertSucceeds(guest.doc('schools/pu').get());
    await assertSucceeds(guest.doc('schools/pu/menus/bento').get());
    await assertSucceeds(guest.doc('schools/pu/busRoutes/route-1').get());
    await assertSucceeds(guest.doc('schools/pu/events/event-1').get());
    await assertSucceeds(guest.doc('schools/pu/pois/lib').get());
    await assertSucceeds(guest.doc('schools/pu/cafeterias/cafe-1').get());
    await assertSucceeds(guest.collection('schools/pu/cafeterias').get());
    await assertSucceeds(guest.collection('schools/pu/menus').get());
    await assertSucceeds(guest.doc('courses/cs101').get());
    await assertFails(guest.doc('schools/pu/lostFound/item-1').get());
    await assertFails(guest.collection('schools/pu/lostFound').get());
    await assertFails(guest.doc('lostFoundItems/item-2').get());
    await assertFails(guest.doc('schools/pu/pois/lib/reviews/rev-1').get());
    await assertFails(guest.collection('schools/pu/cafeterias/cafe-1/posts/post-1/comments').get());
    await assertFails(guest.doc('schools/pu/cafeterias/cafe-1/posts/post-1/comments/c1').get());
    await assertFails(guest.doc('schools/pu/cafeterias/cafe-1/posts/post-1/likes/alice').get());
    await assertFails(guest.doc('schools/pu/cafeterias/cafe-1/followers/alice').get());
    await assertFails(guest.doc('menuRatings/rate-1').get());
    await assertFails(guest.doc('schools/pu/leaderboard/weekly').get());
    await assertFails(guest.doc('schools/pu/pulseAggregates/library').get());
    await assertFails(guest.doc('schools/pu/announcements/notice-1').set({ title: '竄改' }));

    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertSucceeds(alice.doc('schools/pu/announcements/notice-1').get());
    await assertSucceeds(alice.doc('schools/pu/lostFound/item-1').get());
    await assertSucceeds(alice.doc('lostFoundItems/item-2').get());
    await assertSucceeds(alice.doc('schools/pu/pois/lib/reviews/rev-1').get());
    await assertSucceeds(alice.doc('schools/pu/cafeterias/cafe-1/posts/post-1/comments/c1').get());
    await assertSucceeds(alice.doc('menuRatings/rate-1').get());
    await assertFails(alice.doc('schools/pu/announcements/notice-1').set({ title: '竄改' }));
    await assertFails(alice.doc('schools/pu/leaderboard/weekly').set({ score: 99 }));
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

  test('service transaction guards cannot be forged by the owner or another client', async () => {
    for (const uid of ['alice', 'mallory']) {
      const client = testEnv.authenticatedContext(uid).firestore();
      for (const path of [
        'users/alice/schools/pu/serviceWriteGuards/library',
        'users/alice/schools/pu/serviceWriteGuards/seats',
        'schools/pu/serviceWriteGuards/resource-lock',
      ]) {
        await assertFails(client.doc(path).set({ updatedAt: new Date() }));
        await assertFails(client.doc(path).delete());
      }
    }
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
      await db.doc('schools/school-1/members/alice').set({ role: 'student', status: 'active' });
      await db.doc('schools/school-1/members/bob').set({ role: 'faculty', status: 'active' });
      await db.doc('schools/school-1/members/teacher').set({ role: 'faculty', status: 'active' });
      await db.doc('groups/course-1/members/alice').set({ role: 'member', status: 'active' });
      await db.doc('groups/course-1/members/teacher').set({ role: 'instructor', status: 'active' });
      await db.doc('groups/course-1/assignments/work-1').set({ title: 'Work', published: true, ...overrides });
    });
  }
  test('teacher publication, student receipt and released feedback remain scoped through revocation', async () => {
    // Only identity and enrollment are fixtures; every assignment, answer and grade
    // below is written through an authenticated client under the production rules.
    await seedFirestore(async (db) => {
      await db.doc('groups/course-1').set({ name: 'Course', schoolId: 'school-1', type: 'course' });
      for (const uid of ['alice', 'bob', 'teacher']) {
        await db.doc(`schools/school-1/members/${uid}`).set({
          role: uid === 'teacher' ? 'faculty' : 'student', status: 'active',
        });
        await db.doc(`groups/course-1/members/${uid}`).set({
          role: uid === 'teacher' ? 'instructor' : 'member', status: 'active',
        });
      }
    });
    const teacher = testEnv.authenticatedContext('teacher').firestore();
    const student = testEnv.authenticatedContext('alice').firestore();
    const classmate = testEnv.authenticatedContext('bob').firestore();
    const assignmentPath = 'groups/course-1/assignments/work-1';
    const assignment = {
      title: 'Course reflection', description: 'Explain your reasoning.',
      type: 'assignment', groupId: 'course-1', schoolId: 'school-1',
      points: 100, dueAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      allowLateSubmission: false, published: true, status: 'published',
      createdBy: 'teacher', createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    };
    await assertFails(student.doc(assignmentPath).set(assignment));
    await assertSucceeds(teacher.doc(assignmentPath).set(assignment));
    const publishedAssignment = await assertSucceeds(student.doc(assignmentPath).get({ source: 'server' }));
    assert.equal(publishedAssignment.data().published, true);
    assert.equal((await assertSucceeds(pathTo(student).get({ source: 'server' }))).exists, false);

    await assertSucceeds(pathTo(student).set(answer()));
    const receipt = (await assertSucceeds(pathTo(student).get({ source: 'server' }))).data();
    assert.equal(receipt.status, 'submitted');
    assert.equal(receipt.content, 'My answer');
    assert.equal(receipt.userId, 'alice');
    assert.equal(typeof receipt.submittedAt.toMillis(), 'number');
    const teacherQueue = await assertSucceeds(teacher.collection(`${assignmentPath}/submissions`).get());
    assert.deepEqual(teacherQueue.docs.map((entry) => entry.id), ['alice']);
    await assertFails(pathTo(classmate).get({ source: 'server' }));
    await assertFails(classmate.collection(`${assignmentPath}/submissions`).get());

    // Grading drafts are held in the teacher UI. This shared receipt is not a
    // draft store: the canonical grade fields must be published atomically.
    await assertFails(pathTo(teacher).update({
      gradeScore: 75, gradeFeedback: 'Private draft', gradePublished: false,
    }));
    const beforeRelease = (await assertSucceeds(pathTo(student).get({ source: 'server' }))).data();
    assert.equal('gradeScore' in beforeRelease, false);
    assert.equal('gradeFeedback' in beforeRelease, false);

    await assertSucceeds(pathTo(teacher).update({
      gradeScore: 0, gradeFeedback: '請補上推導過程。', gradePublished: true,
      gradePublishedBy: 'teacher', gradePublishedAt: serverTimestamp(),
    }));
    const released = (await assertSucceeds(pathTo(student).get({ source: 'server' }))).data();
    assert.equal(released.gradeScore, 0);
    assert.equal(released.gradeFeedback, '請補上推導過程。');
    assert.equal(released.gradePublished, true);
    assert.equal(released.gradePublishedBy, 'teacher');
    assert.equal(typeof released.gradePublishedAt.toMillis(), 'number');
    assert.equal(released.submittedAt.toMillis(), receipt.submittedAt.toMillis());
    assert.equal(released.content, receipt.content);
    await assertFails(pathTo(classmate).get({ source: 'server' }));

    await assertSucceeds(teacher.doc(`${assignmentPath}/peerReviews/bob`).set({
      reviewerId: 'bob', submissionOwnerId: 'alice',
    }));
    await assertSucceeds(pathTo(classmate).get({ source: 'server' }));
    await seedFirestore((db) => db.doc('groups/course-1/members/bob').update({ status: 'removed' }));
    await assertFails(pathTo(classmate).get({ source: 'server' }));
    await seedFirestore(async (db) => {
      await db.doc('groups/course-1/members/bob').update({ status: 'active' });
      await db.doc('schools/school-1/members/bob').update({ status: 'removed' });
    });
    await assertFails(pathTo(classmate).get({ source: 'server' }));

    await seedFirestore((db) => db.doc('groups/course-1/members/alice').update({ status: 'removed' }));
    await assertFails(pathTo(student).get({ source: 'server' }));
    await assertSucceeds(pathTo(teacher).get({ source: 'server' }));
    await seedFirestore(async (db) => {
      await db.doc('groups/course-1/members/alice').update({ status: 'active' });
      await db.doc('schools/school-1/members/alice').update({ status: 'removed' });
    });
    await assertFails(pathTo(student).get({ source: 'server' }));
  });
  test('teacher explicitly reopening late submission produces one immutable student receipt', async () => {
    await seedAssignment({
      type: 'assignment', createdBy: 'teacher', status: 'published',
      description: 'Explain your reasoning.', points: 100,
      dueAt: '2000-01-01T00:00:00Z', allowLateSubmission: false,
    });
    const teacher = testEnv.authenticatedContext('teacher').firestore();
    const student = testEnv.authenticatedContext('alice').firestore();
    await assertFails(pathTo(student).set(answer()));
    assert.equal((await assertSucceeds(pathTo(student).get({ source: 'server' }))).exists, false);
    await assertSucceeds(teacher.doc('groups/course-1/assignments/work-1').update({
      allowLateSubmission: true, lastEditedBy: 'teacher', updatedAt: serverTimestamp(),
    }));
    await assertSucceeds(pathTo(student).set(answer()));
    const receipt = (await assertSucceeds(pathTo(student).get({ source: 'server' }))).data();
    assert.equal(receipt.status, 'submitted');
    assert.ok(receipt.submittedAt.toMillis() > Date.parse('2000-01-01T00:00:00Z'));
    await assertFails(pathTo(student).set(answer({ content: 'Unconfirmed replacement' })));
    const preserved = (await assertSucceeds(pathTo(student).get({ source: 'server' }))).data();
    assert.equal(preserved.content, receipt.content);
    assert.equal(preserved.submittedAt.toMillis(), receipt.submittedAt.toMillis());
  });
  test('revoked enrollment and unassigned peer review cannot read private submissions', async () => {
    await seedAssignment({
      type: 'assignment', createdBy: 'teacher', status: 'published',
      description: 'Private work', points: 100,
      dueAt: new Date(Date.now() + 3600000).toISOString(), allowLateSubmission: false,
    });
    const alice = testEnv.authenticatedContext('alice').firestore();
    const bob = testEnv.authenticatedContext('bob').firestore();
    await assertSucceeds(pathTo(alice).set(answer()));
    await assertSucceeds(pathTo(alice).get({ source: 'server' }));

    // A stale peer-review assignment is not authorization without current course membership.
    await seedFirestore((db) => db.doc('groups/course-1/assignments/work-1/peerReviews/bob').set({
      reviewerId: 'bob', submissionOwnerId: 'alice',
    }));
    await assertFails(pathTo(bob).get({ source: 'server' }));

    await seedFirestore((db) => db.doc('groups/course-1/members/alice').update({ status: 'removed' }));
    await assertFails(pathTo(alice).get({ source: 'server' }));
    await seedFirestore(async (db) => {
      await db.doc('groups/course-1/members/alice').update({ status: 'active' });
      await db.doc('schools/school-1/members/alice').update({ status: 'removed' });
    });
    await assertFails(pathTo(alice).get({ source: 'server' }));
  });

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
  test('unpublished, closed and overdue quizzes reject answer writes', async () => {
    const quizAnswer = answer({ content: '', answers: { q1: 'b' } });
    for (const overrides of [
      { type: 'quiz', published: false },
      { type: 'quiz', status: 'draft' },
      { type: 'quiz', status: 'closed' },
      { type: 'quiz', dueAt: Timestamp.fromMillis(0) },
      { type: 'quiz', dueAt: '2000-01-01T00:00:00Z' },
    ]) {
      await seedAssignment(overrides);
      await assertFails(pathTo(testEnv.authenticatedContext('alice').firestore()).set(quizAnswer));
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
        await db.doc(`schools/tw-demo-uni/members/${uid}`).set({ role: 'student', status });
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

  test('parallel lost-response retries after expiry and closure return the original receipt without writes', async () => {
    const session = await handlers.startLiveSession(startRequest());
    const initial = await handlers.joinLiveSession(request(session));
    await handlers.endLiveSession(request(session, 'teacher'));
    currentTime += 300_000;
    const references = [
      sessionDoc(session, 'liveSessions'),
      sessionDoc(session, 'attendanceSessions'),
      sessionDoc(session, 'attendanceSessions').collection('attendanceRecords').doc('alice'),
    ];
    const before = await db.getAll(...references);
    const retries = await Promise.all(Array.from({ length: 4 }, () => handlers.joinLiveSession(request(session))));
    for (const receipt of retries) assert.deepEqual(receipt, { ...initial, alreadyJoined: true });
    const after = await db.getAll(...references);
    for (let index = 0; index < before.length; index++) {
      assert.deepEqual(after[index].data(), before[index].data());
      assert.equal(after[index].updateTime.isEqual(before[index].updateTime), true);
    }
    await assert.rejects(handlers.joinLiveSession(request(session, 'bob')), { code: 'failed-precondition' });
    assert.equal((await sessionDoc(session, 'attendanceSessions').collection('attendanceRecords').get()).size, 1);
  });

  test('expired receipts still require the original private token, own identity and active membership', async () => {
    const session = await handlers.startLiveSession(startRequest());
    await handlers.joinLiveSession(request(session));
    currentTime += 300_000;
    const wrongToken = request(session);
    wrongToken.data.qrToken = 'wrong-token-long-enough';
    await assert.rejects(handlers.joinLiveSession(wrongToken), { code: 'permission-denied' });
    const anotherAccount = request(session, 'bob');
    anotherAccount.data.uid = 'alice';
    await assert.rejects(handlers.joinLiveSession(anotherAccount), { code: 'deadline-exceeded' });
    await db.doc(`${base}/members/alice`).update({ status: 'inactive' });
    await assert.rejects(handlers.joinLiveSession(request(session)), { code: 'permission-denied' });
    await db.doc(`${base}/members/alice`).delete();
    await assert.rejects(handlers.joinLiveSession(request(session)), { code: 'permission-denied' });
    assert.equal((await sessionDoc(session, 'attendanceSessions').get()).data().attendeeCount, 1);
    assert.equal((await sessionDoc(session, 'attendanceSessions').collection('attendanceRecords').get()).size, 1);
  });

  test('receipt recovery never overwrites a teacher correction after expiry', async () => {
    const session = await handlers.startLiveSession(startRequest());
    await handlers.joinLiveSession(request(session));
    const record = sessionDoc(session, 'attendanceSessions').collection('attendanceRecords').doc('alice');
    await record.update({ status: 'absent', reviewedBy: 'teacher', reviewNote: '更正出席紀錄' });
    const corrected = await record.get();
    currentTime += 300_000;
    await assert.rejects(handlers.joinLiveSession(request(session)), { code: 'failed-precondition' });
    const after = await record.get();
    assert.deepEqual(after.data(), corrected.data());
    assert.equal(after.updateTime.isEqual(corrected.updateTime), true);
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

describe('P1 authorization: users role authority fields', () => {
  const { deleteField } = require('firebase/firestore');

  test('deny create with polluted primaryRole / authority fields; allow student create', async () => {
    const newbie = testEnv.authenticatedContext('newbie').firestore();
    await assertSucceeds(
      newbie.doc('users/newbie').set({
        displayName: 'Newbie',
        role: 'student',
        createdAt: '2026-10-24T00:00:00.000Z',
      }),
    );
    await assertSucceeds(
      testEnv.authenticatedContext('sparse').firestore().doc('users/sparse').set({ displayName: 'Sparse' }),
    );

    const pollutedCreates = [
      ['pollute-admin', { primaryRole: 'admin' }],
      ['pollute-teacher', { primaryRole: 'teacher' }],
      ['pollute-editor', { primaryRole: 'editor', postLoginRoles: ['admin'] }],
      [
        'pollute-flags',
        {
          teachingRoles: ['teacher'],
          orgRoles: ['schoolAdmin'],
          lastPostLoginResolvedAt: '2026-10-24T00:00:00.000Z',
        },
      ],
      ['pollute-role', { role: 'admin' }],
    ];
    for (const [uid, extra] of pollutedCreates) {
      const db = testEnv.authenticatedContext(uid).firestore();
      await assertFails(
        db.doc(`users/${uid}`).set({
          displayName: 'Evil',
          role: extra.role === 'admin' ? 'admin' : 'student',
          createdAt: '2026-10-24T00:00:00.000Z',
          ...extra,
        }),
      );
    }
  });

  test('deny update that inserts/changes/removes primaryRole and other authority fields', async () => {
    await seedFirestore(async (db) => {
      await db.doc('users/alice').set({
        displayName: 'Alice',
        role: 'student',
        balance: null,
        schoolId: 'pu',
        primarySchoolId: 'pu',
        createdAt: '2026-10-01T00:00:00.000Z',
      });
      await db.doc('users/bob').set({
        displayName: 'Bob',
        role: 'student',
        primaryRole: 'student',
        postLoginRoles: ['student'],
        teachingRoles: [],
        orgRoles: [],
        balance: null,
        schoolId: 'pu',
        primarySchoolId: 'pu',
        createdAt: '2026-10-01T00:00:00.000Z',
        lastPostLoginResolvedAt: '2026-10-02T00:00:00.000Z',
        notificationDeliveryDisabled: false,
        accountDeletionInProgress: false,
      });
    });

    const alice = testEnv.authenticatedContext('alice').firestore().doc('users/alice');
    const bob = testEnv.authenticatedContext('bob').firestore().doc('users/bob');

    await assertSucceeds(alice.update({ displayName: 'Alice Updated' }));
    await assertSucceeds(alice.update({ notificationsEnabled: true }));

    await assertFails(alice.update({ primaryRole: 'admin' }));
    await assertFails(alice.update({ primaryRole: 'teacher' }));
    await assertFails(alice.update({ primaryRole: 'editor' }));
    await assertFails(alice.update({ postLoginRoles: ['admin'] }));
    await assertFails(alice.update({ teachingRoles: ['teacher'] }));
    await assertFails(alice.update({ orgRoles: ['schoolAdmin'] }));
    await assertFails(alice.update({ lastPostLoginResolvedAt: '2099-01-01T00:00:00.000Z' }));
    await assertFails(alice.update({ role: 'admin' }));

    await assertFails(bob.update({ primaryRole: 'admin' }));
    await assertFails(bob.update({ postLoginRoles: ['admin', 'teacher'] }));
    await assertFails(bob.update({ teachingRoles: ['teacher'] }));
    await assertFails(bob.update({ orgRoles: ['schoolAdmin'] }));
    await assertFails(bob.update({ lastPostLoginResolvedAt: '2099-01-01T00:00:00.000Z' }));
    await assertFails(bob.update({ role: 'teacher' }));

    await assertFails(bob.update({ primaryRole: deleteField() }));
    await assertFails(bob.update({ postLoginRoles: deleteField() }));
    await assertFails(bob.update({ teachingRoles: deleteField() }));
    await assertFails(bob.update({ orgRoles: deleteField() }));
    await assertFails(bob.update({ lastPostLoginResolvedAt: deleteField() }));
    await assertFails(bob.update({ role: deleteField() }));
    await assertFails(bob.update({ notificationDeliveryDisabled: deleteField() }));
    await assertFails(bob.update({ accountDeletionInProgress: deleteField() }));
    await assertFails(alice.update({ notificationDeliveryDisabled: true }));
    await assertFails(alice.update({ accountDeletionInProgress: true }));

    await assertSucceeds(bob.update({ displayName: 'Bob Updated' }));
  });
});

describe('P1 authorization: MapDiff affectedKeys allowlists', () => {
  const { deleteField } = require('firebase/firestore');

  test('campus post like/comment bump cannot delete or insert author content', async () => {
    await seedFirestore(async (db) => {
      await db.doc('schools/pu/members/alice').set({ role: 'member', status: 'active' });
      await db.doc('schools/pu/members/bob').set({ role: 'member', status: 'active' });
      await db.doc('schools/pu/campusPosts/post-1').set({
        schoolId: 'pu',
        boardId: 'general',
        title: 'Hello campus',
        body: 'Original body by bob',
        anonymous: false,
        authorUid: 'bob',
        likes: 0,
        likedBy: [],
        commentCount: 0,
        createdAt: '2026-10-20T00:00:00.000Z',
        updatedAt: '2026-10-20T00:00:00.000Z',
      });
      await db.doc('schools/pu/campusPosts/post-2').set({
        schoolId: 'pu',
        boardId: 'general',
        title: 'No likes yet',
        body: 'Fresh',
        anonymous: false,
        authorUid: 'bob',
        createdAt: '2026-10-20T00:00:00.000Z',
        updatedAt: '2026-10-20T00:00:00.000Z',
      });
    });

    const alice = testEnv.authenticatedContext('alice').firestore();
    const post1 = alice.doc('schools/pu/campusPosts/post-1');
    const post2 = alice.doc('schools/pu/campusPosts/post-2');

    await assertSucceeds(
      post2.update({
        likes: 1,
        likedBy: ['alice'],
        updatedAt: '2026-10-24T00:00:00.000Z',
      }),
    );

    await assertSucceeds(
      post1.update({
        likes: 1,
        likedBy: ['alice'],
        updatedAt: '2026-10-24T00:00:00.000Z',
      }),
    );

    await seedFirestore(async (db) => {
      await db.doc('schools/pu/campusPosts/post-1').set({
        schoolId: 'pu',
        boardId: 'general',
        title: 'Hello campus',
        body: 'Original body by bob',
        anonymous: false,
        authorUid: 'bob',
        likes: 0,
        likedBy: [],
        commentCount: 2,
        createdAt: '2026-10-20T00:00:00.000Z',
        updatedAt: '2026-10-20T00:00:00.000Z',
      });
    });

    await assertFails(
      post1.update({
        likes: 1,
        likedBy: ['alice'],
        updatedAt: '2026-10-24T00:00:00.000Z',
        body: deleteField(),
      }),
    );

    await assertFails(
      post1.update({
        likes: 1,
        likedBy: ['alice'],
        updatedAt: '2026-10-24T00:00:00.000Z',
        title: 'Hijacked title',
      }),
    );
    await assertFails(
      post1.update({
        likes: 1,
        likedBy: ['alice'],
        updatedAt: '2026-10-24T00:00:00.000Z',
        forgedAdminNote: 'pwned',
      }),
    );

    await assertFails(
      post1.update({
        commentCount: 3,
        updatedAt: '2026-10-24T00:00:00.000Z',
        body: deleteField(),
      }),
    );
    await assertFails(
      post1.update({
        commentCount: 3,
        updatedAt: '2026-10-24T00:00:00.000Z',
        title: 'bumped-hijack',
      }),
    );
    await assertFails(
      post1.update({ commentCount: 3, updatedAt: '2026-10-24T00:00:00.000Z', forgedAdminNote: 'injected' }),
    );

    await assertSucceeds(
      post1.update({
        commentCount: 3,
        updatedAt: '2026-10-24T00:00:00.000Z',
      }),
    );

    await seedFirestore(async (db) => {
      const snap = await db.doc('schools/pu/campusPosts/post-1').get();
      const data = snap.data();
      if (data.body !== 'Original body by bob' || data.title !== 'Hello campus' || data.authorUid !== 'bob') {
        throw new Error('author content was mutated unexpectedly');
      }
    });

    const bob = testEnv.authenticatedContext('bob').firestore();
    await assertSucceeds(
      bob.doc('schools/pu/campusPosts/post-1').update({
        body: 'Edited by author',
        title: 'Hello campus',
        boardId: 'general',
        updatedAt: '2026-10-24T01:00:00.000Z',
      }),
    );
  });

  test('nested conversation message reaction/read/recall cannot strip or forge fields', async () => {
    await seedFirestore(async (db) => {
      await db.doc('schools/pu/members/alice').set({ role: 'member', status: 'active' });
      await db.doc('schools/pu/members/bob').set({ role: 'member', status: 'active' });
      await db.doc('conversations/dm-1').set({
        schoolId: 'pu',
        memberIds: ['alice', 'bob'],
        createdAt: '2026-10-20T00:00:00.000Z',
        updatedAt: '2026-10-20T00:00:00.000Z',
      });
      await db.doc('conversations/dm-1/messages/m1').set({
        conversationId: 'dm-1',
        senderId: 'alice',
        content: 'secret hello',
        readBy: ['alice'],
        createdAt: '2026-10-20T00:00:00.000Z',
      });
      await db.doc('conversations/dm-1/messages/m2').set({
        conversationId: 'dm-1',
        senderId: 'alice',
        content: 'no reactions yet',
        createdAt: '2026-10-20T00:00:00.000Z',
      });
    });

    const bob = testEnv.authenticatedContext('bob').firestore();
    const m1 = bob.doc('conversations/dm-1/messages/m1');
    const m2 = bob.doc('conversations/dm-1/messages/m2');

    await assertSucceeds(m1.update({ readBy: ['alice', 'bob'] }));
    await assertSucceeds(
      m2.update({
        reactions: { '👍': ['bob'] },
        updatedAt: '2026-10-24T00:00:00.000Z',
      }),
    );

    await seedFirestore(async (db) => {
      await db.doc('conversations/dm-1/messages/m1').set({
        conversationId: 'dm-1',
        senderId: 'alice',
        content: 'secret hello',
        readBy: ['alice'],
        createdAt: '2026-10-20T00:00:00.000Z',
      });
    });

    await assertFails(
      m1.update({
        readBy: ['alice', 'bob'],
        content: deleteField(),
      }),
    );
    await assertFails(
      m1.update({
        readBy: ['alice', 'bob'],
        forged: true,
      }),
    );
    await assertFails(
      m1.update({
        reactions: { '👍': ['bob'] },
        updatedAt: '2026-10-24T00:00:00.000Z',
        content: 'hijacked',
      }),
    );
    await assertFails(m1.update({ reactions: { '👍': ['bob'] }, content: deleteField() }));

    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertFails(alice.doc('conversations/dm-1/messages/m1').update({
      recalledAt: '2026-10-24T00:00:00.000Z', content: deleteField(),
    }));
    await assertFails(alice.doc('conversations/dm-1/messages/m1').update({
      recalledAt: '2026-10-24T00:00:00.000Z', forged: true,
    }));
    await assertSucceeds(
      alice.doc('conversations/dm-1/messages/m1').update({
        recalledAt: '2026-10-24T00:00:00.000Z',
        updatedAt: '2026-10-24T00:00:00.000Z',
      }),
    );
    await assertFails(
      bob.doc('conversations/dm-1/messages/m2').update({
        recalledAt: '2026-10-24T00:00:00.000Z',
        updatedAt: '2026-10-24T00:00:00.000Z',
      }),
    );
  });

  test('root messages readBy allowlist blocks delete/insert of other fields', async () => {
    await seedFirestore(async (db) => {
      await db.doc('conversations/c-root').set({
        schoolId: 'pu',
        memberIds: ['alice', 'bob'],
      });
      await db.doc('schools/pu/members/alice').set({ role: 'member', status: 'active' });
      await db.doc('schools/pu/members/bob').set({ role: 'member', status: 'active' });
      await db.doc('messages/root-1').set({
        conversationId: 'c-root',
        senderId: 'alice',
        text: 'root private',
        readBy: ['alice'],
        createdAt: '2026-10-20T00:00:00.000Z',
      });
      await db.doc('messages/root-2').set({
        conversationId: 'c-root',
        senderId: 'alice',
        text: 'no readBy yet',
        createdAt: '2026-10-20T00:00:00.000Z',
      });
    });

    const bob = testEnv.authenticatedContext('bob').firestore();

    await assertSucceeds(
      bob.doc('messages/root-1').update({
        readBy: ['alice', 'bob'],
        updatedAt: '2026-10-24T00:00:00.000Z',
      }),
    );
    await assertSucceeds(
      bob.doc('messages/root-2').update({
        readBy: ['bob'],
        updatedAt: '2026-10-24T00:00:00.000Z',
      }),
    );

    await seedFirestore(async (db) => {
      await db.doc('messages/root-1').set({
        conversationId: 'c-root',
        senderId: 'alice',
        text: 'root private',
        readBy: ['alice'],
        createdAt: '2026-10-20T00:00:00.000Z',
      });
    });

    await assertFails(
      bob.doc('messages/root-1').update({
        readBy: ['alice', 'bob'],
        updatedAt: '2026-10-24T00:00:00.000Z',
        text: deleteField(),
      }),
    );
    await assertFails(
      bob.doc('messages/root-1').update({
        readBy: ['alice', 'bob'],
        updatedAt: '2026-10-24T00:00:00.000Z',
        text: 'hijacked',
      }),
    );
    await assertFails(
      bob.doc('messages/root-1').update({
        readBy: ['alice', 'bob'],
        updatedAt: '2026-10-24T00:00:00.000Z',
        injected: 'x',
      }),
    );
  });

  test('notification owner cannot modify protected payload while marking read', async () => {
    await seedFirestore(async (db) => {
      await db.doc('notifications/n1').set({
        userId: 'alice',
        title: 'System notice',
        body: 'Important payload',
        type: 'system',
        isRead: false,
        createdAt: '2026-10-20T00:00:00.000Z',
      });
      await db.doc('notifications/n2').set({
        userId: 'alice',
        title: 'No readAt yet',
        body: 'Payload',
        type: 'system',
        isRead: false,
        createdAt: '2026-10-20T00:00:00.000Z',
      });
    });

    const alice = testEnv.authenticatedContext('alice').firestore();

    await assertSucceeds(
      alice.doc('notifications/n2').update({
        isRead: true,
        readAt: '2026-10-24T00:00:00.000Z',
        updatedAt: '2026-10-24T00:00:00.000Z',
      }),
    );

    await assertFails(
      alice.doc('notifications/n1').update({
        isRead: true,
        readAt: '2026-10-24T00:00:00.000Z',
        updatedAt: '2026-10-24T00:00:00.000Z',
        body: deleteField(),
      }),
    );
    await assertFails(
      alice.doc('notifications/n1').update({
        isRead: true,
        readAt: '2026-10-24T00:00:00.000Z',
        updatedAt: '2026-10-24T00:00:00.000Z',
        title: 'Forged title',
      }),
    );
    await assertFails(
      alice.doc('notifications/n1').update({
        isRead: true,
        readAt: '2026-10-24T00:00:00.000Z',
        updatedAt: '2026-10-24T00:00:00.000Z',
        type: 'admin',
      }),
    );
    await assertFails(alice.doc('notifications/n1').update({
      isRead: true, readAt: '2026-10-24T00:00:00.000Z', forgedAdminNote: 'injected',
    }));

    await assertSucceeds(
      alice.doc('notifications/n1').update({
        isRead: true,
        readAt: '2026-10-24T00:00:00.000Z',
        updatedAt: '2026-10-24T00:00:00.000Z',
      }),
    );
  });
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

test('handle rename and removal commit with the private school pointer or not at all', async () => {
  const assert = require('node:assert/strict');
  await seedFirestore(async (db) => {
    await db.doc('users/alice').set({ displayName: 'Alice' });
    await db.doc('users/bob').set({ displayName: 'Bob' });
    for (const schoolId of ['pu', 'other']) {
      await db.doc(`schools/${schoolId}/members/alice`).set({ status: 'active', role: 'student' });
    }
    await db.doc('schools/pu/handles/alice_old').set({ uid: 'alice', name: 'Alice', handle: 'alice_old' });
    await db.doc('schools/pu/handles/taken').set({ uid: 'bob', name: 'Bob', handle: 'taken' });
    await db.doc('schools/other/handles/alice_other').set({ uid: 'alice', name: 'Alice', handle: 'alice_other' });
    await db.doc('users/alice/settings/friendHandle:pu').set({ handle: 'alice_old' });
    await db.doc('users/alice/settings/friendHandle:other').set({ handle: 'alice_other' });
  });
  const db = testEnv.authenticatedContext('alice').firestore();
  const pointer = db.doc('users/alice/settings/friendHandle:pu');
  const rename = (next) => db.runTransaction(async (transaction) => {
    const current = await transaction.get(pointer);
    const old = db.doc(`schools/pu/handles/${current.data().handle}`);
    await transaction.get(old);
    transaction.set(db.doc(`schools/pu/handles/${next}`), { uid: 'alice', name: 'Alice', handle: next });
    transaction.delete(old);
    transaction.set(pointer, { handle: next });
  });
  await assertFails(rename('taken'));
  assert.equal((await pointer.get()).data().handle, 'alice_old');
  assert.equal((await db.doc('schools/pu/handles/alice_old').get()).exists, true);
  await assertSucceeds(rename('alice_new'));
  assert.equal((await db.doc('schools/pu/handles/alice_old').get()).exists, false);
  assert.equal((await pointer.get()).data().handle, 'alice_new');
  await assertSucceeds(db.runTransaction(async (transaction) => {
    const current = await transaction.get(pointer);
    const alias = db.doc(`schools/pu/handles/${current.data().handle}`);
    await transaction.get(alias);
    transaction.delete(alias);
    transaction.set(pointer, { handle: '' });
  }));
  assert.equal((await db.doc('schools/pu/handles/alice_new').get()).exists, false);
  assert.equal((await pointer.get()).data().handle, '');
  assert.equal((await db.doc('schools/other/handles/alice_other').get()).exists, true);
  assert.equal((await db.doc('users/alice/settings/friendHandle:other').get()).data().handle, 'alice_other');
  await assertFails(testEnv.authenticatedContext('bob').firestore().doc(pointer.path).get());
});

test('assistant replies can only be written by the server, never by a student', async () => {
  await seedFirestore(async (db) => {
    for (const uid of ['alice', 'bob', 'tina']) {
      await db.doc(`schools/pu/members/${uid}`).set({ role: 'student', status: 'active' });
    }
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
      schoolId: 'pu', courses: [], courseIds: ['db'], offeringIds: ['資料庫｜王老師'],
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

test('school-scoped personal timetables isolate saves, friend reads, and appeal authority', async () => {
  const courseA = { id: 'a1', name: '靜宜課', day: 1, start: 1, end: 2 };
  const courseB = { id: 'b1', name: '成大課', day: 2, start: 3, end: 4 };
  const offeringB = '成大課｜乙老師';
  const timetableA = {
    schoolId: 'pu',
    shareWithFriends: true,
    courses: [courseA],
    courseIds: ['a1', 'b1'],
    offeringIds: ['靜宜課｜甲老師', offeringB],
    meta: { label: 'pu' },
  };
  const timetableB = {
    schoolId: 'ncku',
    shareWithFriends: true,
    courses: [courseB],
    courseIds: ['b1'],
    offeringIds: [offeringB],
    meta: { label: 'ncku' },
  };
  const appealB = {
    schoolId: 'ncku',
    studentUid: 'alice',
    courseId: 'b1',
    courseName: '成大課',
    offeringId: offeringB,
    title: '出缺席紀錄',
    body: '當天有請假單可以補',
    status: 'pending',
    teacherNote: '',
  };

  await seedFirestore(async (db) => {
    for (const schoolId of ['pu', 'ncku']) {
      for (const uid of ['alice', 'bob']) {
        await db.doc(`schools/${schoolId}/members/${uid}`).set({ status: 'active', role: 'student' });
      }
    }
    await db.doc('friendships/req_pu_alice_bob').set({
      schoolId: 'pu', fromUid: 'alice', toUid: 'bob', status: 'accepted',
    });
  });

  const alice = testEnv.authenticatedContext('alice').firestore();
  const bob = testEnv.authenticatedContext('bob').firestore();
  const mallory = testEnv.authenticatedContext('mallory').firestore();
  const pathA = 'users/alice/schools/pu/personalTimetable/current';
  const pathB = 'users/alice/schools/ncku/personalTimetable/current';

  await assertSucceeds(alice.doc(pathA).set(timetableA));
  await assertSucceeds(alice.doc(pathB).set(timetableB));
  await assertSucceeds(alice.doc(pathA).get());
  await assertSucceeds(alice.doc(pathB).get());

  await assertFails(alice.doc(pathA).set({ ...timetableA, schoolId: 'ncku' }));
  await assertFails(alice.doc(pathB).set({ ...timetableB, schoolId: 'pu' }));
  await assertFails(alice.doc(pathA).set({ ...timetableA, schoolId: 'other' }));

  await assertSucceeds(bob.doc(pathA).get());
  await assertFails(bob.doc(pathB).get());
  await assertFails(bob.doc(pathA).update({ courses: [] }));
  await assertFails(mallory.doc(pathA).set(timetableA));
  await assertFails(mallory.doc(pathB).delete());

  // A 校索引（即使含相同 course/offering 名稱）不能授權 B 校申訴
  await seedFirestore(async (db) => {
    await db.doc(pathB).delete();
  });
  await assertFails(alice.doc('courseAppeals/cross-school').set(appealB));

  // 正確的 B 校 scoped 索引可以授權
  await seedFirestore(async (db) => {
    await db.doc(pathB).set(timetableB);
  });
  await assertSucceeds(alice.doc('courseAppeals/ncku-ok').set(appealB));

  // 錯誤學校／缺 provenance 的 legacy 不能授權
  await seedFirestore(async (db) => {
    await db.doc(pathB).delete();
    await db.doc('users/alice/personalTimetable/current').set({
      schoolId: 'pu',
      courses: [courseB],
      courseIds: ['b1'],
      offeringIds: [offeringB],
    });
  });
  await assertFails(alice.doc('courseAppeals/legacy-wrong-school').set({
    ...appealB, title: 'legacy wrong school',
  }));

  await seedFirestore(async (db) => {
    await db.doc('users/alice/personalTimetable/current').set({
      courses: [courseB],
      courseIds: ['b1'],
      offeringIds: [offeringB],
    });
  });
  await assertFails(alice.doc('courseAppeals/legacy-missing-school').set({
    ...appealB, title: 'legacy missing school',
  }));

  // canonical 空文件存在時壓過 matching legacy
  await seedFirestore(async (db) => {
    await db.doc('users/alice/personalTimetable/current').set({
      schoolId: 'ncku',
      courses: [courseB],
      courseIds: ['b1'],
      offeringIds: [offeringB],
    });
    await db.doc(pathB).set({
      schoolId: 'ncku',
      shareWithFriends: false,
      courses: [],
      courseIds: [],
      offeringIds: [],
      meta: {},
    });
  });
  await assertFails(alice.doc('courseAppeals/canonical-empty-wins').set({
    ...appealB, title: 'canonical empty wins',
  }));

  // matching legacy fallback only when canonical is absent
  await seedFirestore(async (db) => {
    await db.doc(pathB).delete();
  });
  await assertSucceeds(alice.doc('courseAppeals/legacy-match').set({
    ...appealB, title: 'legacy exact match',
  }));
});

test('accepted same-school friends can probe missing canonical timetable before legacy fallback', async () => {
  const pathA = 'users/alice/schools/pu/personalTimetable/current';
  const legacy = {
    schoolId: 'pu',
    shareWithFriends: true,
    courses: [{ id: 'a1', name: '靜宜課', day: 1, start: 1, end: 2 }],
    courseIds: ['a1'],
    offeringIds: ['靜宜課｜甲老師'],
    meta: {},
  };

  await seedFirestore(async (db) => {
    for (const schoolId of ['pu', 'ncku']) {
      for (const uid of ['alice', 'bob', 'carol', 'mallory']) {
        await db.doc(`schools/${schoolId}/members/${uid}`).set({ status: 'active', role: 'student' });
      }
    }
    await db.doc('friendships/req_pu_alice_bob').set({
      schoolId: 'pu', fromUid: 'alice', toUid: 'bob', status: 'accepted',
    });
    await db.doc('friendships/req_ncku_alice_carol').set({
      schoolId: 'ncku', fromUid: 'alice', toUid: 'carol', status: 'accepted',
    });
    // legacy-only explicitly shared for school A; canonical absent
    await db.doc('users/alice/personalTimetable/current').set(legacy);
  });

  const bob = testEnv.authenticatedContext('bob').firestore();
  const carol = testEnv.authenticatedContext('carol').firestore();
  const mallory = testEnv.authenticatedContext('mallory').firestore();
  const alice = testEnv.authenticatedContext('alice').firestore();

  await assertSucceeds(bob.doc(pathA).get());
  await assertSucceeds(bob.doc('users/alice/personalTimetable/current').get());
  await assertFails(mallory.doc(pathA).get());
  await assertFails(carol.doc(pathA).get());
  await assertFails(bob.collection('users/alice/schools/pu/personalTimetable').get());
  await assertSucceeds(alice.collection('users/alice/schools/pu/personalTimetable').get());

  await seedFirestore(async (db) => {
    await db.doc(pathA).set({
      schoolId: 'pu',
      shareWithFriends: false,
      courses: [],
      courseIds: [],
      offeringIds: [],
      meta: {},
    });
  });
  await assertFails(bob.doc(pathA).get());

  await seedFirestore(async (db) => {
    await db.doc(pathA).set({
      schoolId: 'ncku',
      shareWithFriends: true,
      courses: [],
      courseIds: [],
      offeringIds: [],
      meta: {},
    });
  });
  await assertFails(bob.doc(pathA).get());
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

test('線上點餐關著時，學生或店員也不能直接在資料庫寫出訂單或號碼', async () => {
  await seedFirestore(async (db) => {
    await db.doc('users/alice').set({ schoolId: 'pu', role: 'student' });
    await db.doc('schools/pu/members/alice').set({ status: 'active', role: 'student' });
    await db.doc('schools/pu/members/op').set({ status: 'active', role: 'student' });
    await db.doc('schools/pu/cafeterias/cafe').set({ name: '學生餐廳' });
    await db.doc('schools/pu/cafeterias/cafe/operators/op').set({ status: 'active' });
  });
  const order = { userId: 'alice', schoolId: 'pu', cafeteriaId: 'cafe', status: 'pending', total: 100, items: [{ menuItemId: 'rice', quantity: 1 }] };
  for (const uid of ['alice', 'op']) {
    const db = testEnv.authenticatedContext(uid).firestore();
    for (const target of [
      'schools/pu/orders/direct',
      'users/alice/schools/pu/orders/direct',
      'orders/direct',
      'schools/pu/cafeterias/cafe/orders/direct',
      'schools/pu/queueCounters/cafe__tpe__2026-10-12',
      '_orderRequests/direct',
    ]) {
      await assertFails(db.doc(target).set(order));
    }
  }
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    for (const target of ['schools/pu/orders', 'users/alice/schools/pu/orders', 'orders', 'schools/pu/cafeterias/cafe/orders', 'schools/pu/queueCounters', '_orderRequests']) {
      const snap = await db.collection(target).get();
      if (!snap.empty) throw new Error(`${target} has ${snap.size} docs`);
    }
  });
});


describe('reviewed course legacy access boundaries', () => {
  async function seedCourse() {
    await seedFirestore(async (db) => {
      await db.doc('groups/review-boundary').set({ schoolId: 'pu', createdBy: 'owner', type: 'course', verification: { status: 'unverified' }, name: 'Course' });
      for (const uid of ['owner', 'student']) {
        await db.doc(`schools/pu/members/${uid}`).set({ status: 'active', role: 'student' });
        await db.doc(`groups/review-boundary/members/${uid}`).set({ status: 'active', role: uid === 'owner' ? 'owner' : 'member', uid });
      }
    });
  }
  test('active same-school members retain access and descriptive editing', async () => {
    await seedCourse();
    const owner = testEnv.authenticatedContext('owner').firestore();
    const student = testEnv.authenticatedContext('student').firestore();
    await assertSucceeds(student.doc('groups/review-boundary').get());
    await assertSucceeds(owner.doc('groups/review-boundary').update({ name: 'Updated title' }));
  });
  test('stale group membership cannot cross schools or survive revoked enrollment', async () => {
    await seedCourse();
    const student = testEnv.authenticatedContext('student').firestore();
    await seedFirestore(async (db) => {
      await db.doc('schools/pu/members/student').delete();
      await db.doc('schools/other/members/student').set({ status: 'active', role: 'admin' });
    });
    await assertFails(student.doc('groups/review-boundary').get());
    await seedFirestore(async (db) => db.doc('schools/pu/members/student').set({ status: 'inactive', role: 'student' }));
    await assertFails(student.doc('groups/review-boundary').get());
    await assertFails(student.collection('groups/review-boundary/posts').add({ authorId: 'student', kind: 'question', title: 'Denied' }));
  });
  test('workspace management does not grant direct verification or role promotion', async () => {
    await seedCourse();
    const owner = testEnv.authenticatedContext('owner', { role: 'teacher', verified: true }).firestore();
    const course = owner.doc('groups/review-boundary');
    await assertFails(course.update({ verification: { status: 'verified' } }));
    await assertFails(course.update({ schoolId: 'other' }));
    await assertFails(course.update({ createdBy: 'student' }));
    await assertFails(owner.doc('groups/review-boundary/members/student').update({ role: 'instructor' }));
    await assertFails(owner.doc('groups/review-boundary/members/new-teacher').set({ role: 'instructor', status: 'active' }));
  });
  test('client-created courses cannot claim verification or somebody else as creator', async () => {
    await seedCourse();
    const student = testEnv.authenticatedContext('student', { role: 'teacher' }).firestore();
    const base = { schoolId: 'pu', createdBy: 'student', type: 'course', name: 'Personal course', verification: { status: 'unverified' } };
    await assertSucceeds(student.doc('groups/personal-course').set(base));
    await assertFails(student.doc('groups/fake-verified').set({ ...base, verification: { status: 'verified' } }));
    await assertFails(student.doc('groups/fake-creator').set({ ...base, createdBy: 'owner' }));
    await assertFails(student.doc('groups/fake-school').set({ ...base, schoolId: 'other' }));
  });
});

describe('P1 authorization: users role authority fields', () => {
  test('deny create with polluted primaryRole / authority fields; allow student create', async () => {
    const newbie = testEnv.authenticatedContext('newbie').firestore();
    await assertSucceeds(
      newbie.doc('users/newbie').set({
        displayName: 'Newbie',
        role: 'student',
        createdAt: '2026-10-24T00:00:00.000Z',
      }),
    );

    const pollutedCreates = [
      ['pollute-admin', { primaryRole: 'admin' }],
      ['pollute-teacher', { primaryRole: 'teacher' }],
      ['pollute-editor', { primaryRole: 'editor', postLoginRoles: ['admin'] }],
      [
        'pollute-flags',
        {
          teachingRoles: ['teacher'],
          orgRoles: ['schoolAdmin'],
          lastPostLoginResolvedAt: '2026-10-24T00:00:00.000Z',
        },
      ],
      ['pollute-role', { role: 'admin' }],
    ];
    for (const [uid, extra] of pollutedCreates) {
      const db = testEnv.authenticatedContext(uid).firestore();
      await assertFails(
        db.doc(`users/${uid}`).set({
          displayName: 'Evil',
          role: extra.role === 'admin' ? 'admin' : 'student',
          createdAt: '2026-10-24T00:00:00.000Z',
          ...extra,
        }),
      );
    }
  });

  test('deny update that inserts/changes/removes primaryRole and other authority fields', async () => {
    await seedFirestore(async (db) => {
      await db.doc('users/alice').set({
        displayName: 'Alice',
        role: 'student',
        balance: null,
        schoolId: 'pu',
        primarySchoolId: 'pu',
        createdAt: '2026-10-01T00:00:00.000Z',
      });
      await db.doc('users/bob').set({
        displayName: 'Bob',
        role: 'student',
        primaryRole: 'student',
        postLoginRoles: ['student'],
        teachingRoles: [],
        orgRoles: [],
        balance: null,
        schoolId: 'pu',
        primarySchoolId: 'pu',
        createdAt: '2026-10-01T00:00:00.000Z',
        lastPostLoginResolvedAt: '2026-10-02T00:00:00.000Z',
      });
    });

    const alice = testEnv.authenticatedContext('alice').firestore().doc('users/alice');
    const bob = testEnv.authenticatedContext('bob').firestore().doc('users/bob');

    // Legitimate ordinary profile edit (doc may lack optional authority keys).
    await assertSucceeds(alice.update({ displayName: 'Alice Updated' }));
    await assertSucceeds(alice.update({ notificationsEnabled: true }));

    // Insert primaryRole on a doc that never had it.
    await assertFails(alice.update({ primaryRole: 'admin' }));
    await assertFails(alice.update({ primaryRole: 'teacher' }));
    await assertFails(alice.update({ primaryRole: 'editor' }));
    await assertFails(alice.update({ postLoginRoles: ['admin'] }));
    await assertFails(alice.update({ teachingRoles: ['teacher'] }));
    await assertFails(alice.update({ orgRoles: ['schoolAdmin'] }));
    await assertFails(alice.update({ lastPostLoginResolvedAt: '2099-01-01T00:00:00.000Z' }));
    await assertFails(alice.update({ role: 'admin' }));

    // Change existing authority fields.
    await assertFails(bob.update({ primaryRole: 'admin' }));
    await assertFails(bob.update({ postLoginRoles: ['admin', 'teacher'] }));
    await assertFails(bob.update({ teachingRoles: ['teacher'] }));
    await assertFails(bob.update({ orgRoles: ['schoolAdmin'] }));
    await assertFails(bob.update({ lastPostLoginResolvedAt: '2099-01-01T00:00:00.000Z' }));
    await assertFails(bob.update({ role: 'teacher' }));

    // Remove authority fields via FieldValue.delete().
    await assertFails(bob.update({ primaryRole: deleteField() }));
    await assertFails(bob.update({ postLoginRoles: deleteField() }));
    await assertFails(bob.update({ teachingRoles: deleteField() }));
    await assertFails(bob.update({ orgRoles: deleteField() }));
    await assertFails(bob.update({ lastPostLoginResolvedAt: deleteField() }));

    // Legitimate edit still ok when protected optional fields already exist.
    await assertSucceeds(bob.update({ displayName: 'Bob Updated' }));
  });
});

describe('P1 authorization: MapDiff affectedKeys allowlists', () => {
  test('campus post like/comment bump cannot delete or insert author content', async () => {
    await seedFirestore(async (db) => {
      await db.doc('schools/pu/members/alice').set({ role: 'member', status: 'active' });
      await db.doc('schools/pu/members/bob').set({ role: 'member', status: 'active' });
      await db.doc('schools/pu/campusPosts/post-1').set({
        schoolId: 'pu',
        boardId: 'general',
        title: 'Hello campus',
        body: 'Original body by bob',
        anonymous: false,
        authorUid: 'bob',
        likes: 0,
        likedBy: [],
        commentCount: 0,
        createdAt: '2026-10-20T00:00:00.000Z',
        updatedAt: '2026-10-20T00:00:00.000Z',
      });
      await db.doc('schools/pu/campusPosts/post-2').set({
        schoolId: 'pu',
        boardId: 'general',
        title: 'No likes yet',
        body: 'Fresh',
        anonymous: false,
        authorUid: 'bob',
        createdAt: '2026-10-20T00:00:00.000Z',
        updatedAt: '2026-10-20T00:00:00.000Z',
      });
    });

    const alice = testEnv.authenticatedContext('alice').firestore();
    const post1 = alice.doc('schools/pu/campusPosts/post-1');
    const post2 = alice.doc('schools/pu/campusPosts/post-2');

    // Legitimate first like (adds optional likedBy/likes).
    await assertSucceeds(
      post2.update({
        likes: 1,
        likedBy: ['alice'],
        updatedAt: '2026-10-24T00:00:00.000Z',
      }),
    );

    // Legitimate like on shaped doc.
    await assertSucceeds(
      post1.update({
        likes: 1,
        likedBy: ['alice'],
        updatedAt: '2026-10-24T00:00:00.000Z',
      }),
    );

    // Re-seed for attack variants on a clean liked state.
    await seedFirestore(async (db) => {
      await db.doc('schools/pu/campusPosts/post-1').set({
        schoolId: 'pu',
        boardId: 'general',
        title: 'Hello campus',
        body: 'Original body by bob',
        anonymous: false,
        authorUid: 'bob',
        likes: 0,
        likedBy: [],
        commentCount: 2,
        createdAt: '2026-10-20T00:00:00.000Z',
        updatedAt: '2026-10-20T00:00:00.000Z',
      });
    });

    // Like + delete author body (changedKeys would miss deleted body).
    await assertFails(
      post1.update({
        likes: 1,
        likedBy: ['alice'],
        updatedAt: '2026-10-24T00:00:00.000Z',
        body: deleteField(),
      }),
    );

    // Like + insert forged field / overwrite title.
    await assertFails(
      post1.update({
        likes: 1,
        likedBy: ['alice'],
        updatedAt: '2026-10-24T00:00:00.000Z',
        title: 'Hijacked title',
      }),
    );
    await assertFails(
      post1.update({
        likes: 1,
        likedBy: ['alice'],
        updatedAt: '2026-10-24T00:00:00.000Z',
        forgedAdminNote: 'pwned',
      }),
    );

    // Comment bump + delete/insert.
    await assertFails(
      post1.update({
        commentCount: 3,
        updatedAt: '2026-10-24T00:00:00.000Z',
        body: deleteField(),
      }),
    );
    await assertFails(
      post1.update({
        commentCount: 3,
        updatedAt: '2026-10-24T00:00:00.000Z',
        title: 'bumped-hijack',
      }),
    );

    // Legitimate comment bump only.
    await assertSucceeds(
      post1.update({
        commentCount: 3,
        updatedAt: '2026-10-24T00:00:00.000Z',
      }),
    );

    // Unchanged disallowed data still present after legitimate ops.
    await seedFirestore(async (db) => {
      const snap = await db.doc('schools/pu/campusPosts/post-1').get();
      const data = snap.data();
      if (data.body !== 'Original body by bob' || data.title !== 'Hello campus' || data.authorUid !== 'bob') {
        throw new Error('author content was mutated unexpectedly');
      }
    });

    // Author edit path remains separate and allowed.
    const bob = testEnv.authenticatedContext('bob').firestore();
    await assertSucceeds(
      bob.doc('schools/pu/campusPosts/post-1').update({
        body: 'Edited by author',
        title: 'Hello campus',
        boardId: 'general',
        updatedAt: '2026-10-24T01:00:00.000Z',
      }),
    );
  });

  test('nested conversation message reaction/read/recall cannot strip or forge fields', async () => {
    await seedFirestore(async (db) => {
      await db.doc('schools/pu/members/alice').set({ role: 'member', status: 'active' });
      await db.doc('schools/pu/members/bob').set({ role: 'member', status: 'active' });
      await db.doc('conversations/dm-1').set({
        schoolId: 'pu',
        memberIds: ['alice', 'bob'],
        createdAt: '2026-10-20T00:00:00.000Z',
        updatedAt: '2026-10-20T00:00:00.000Z',
      });
      await db.doc('conversations/dm-1/messages/m1').set({
        conversationId: 'dm-1',
        senderId: 'alice',
        content: 'secret hello',
        readBy: ['alice'],
        createdAt: '2026-10-20T00:00:00.000Z',
      });
      await db.doc('conversations/dm-1/messages/m2').set({
        conversationId: 'dm-1',
        senderId: 'alice',
        content: 'no reactions yet',
        createdAt: '2026-10-20T00:00:00.000Z',
      });
    });

    const bob = testEnv.authenticatedContext('bob').firestore();
    const m1 = bob.doc('conversations/dm-1/messages/m1');
    const m2 = bob.doc('conversations/dm-1/messages/m2');

    // Legitimate first readBy / reactions addition.
    await assertSucceeds(m1.update({ readBy: ['alice', 'bob'] }));
    await assertSucceeds(
      m2.update({
        reactions: { '👍': ['bob'] },
        updatedAt: '2026-10-24T00:00:00.000Z',
      }),
    );

    await seedFirestore(async (db) => {
      await db.doc('conversations/dm-1/messages/m1').set({
        conversationId: 'dm-1',
        senderId: 'alice',
        content: 'secret hello',
        readBy: ['alice'],
        createdAt: '2026-10-20T00:00:00.000Z',
      });
    });

    // readBy update + delete content (changedKeys miss).
    await assertFails(
      m1.update({
        readBy: ['alice', 'bob'],
        content: deleteField(),
      }),
    );
    // readBy + insert forged field.
    await assertFails(
      m1.update({
        readBy: ['alice', 'bob'],
        forged: true,
      }),
    );
    // reactions + overwrite content.
    await assertFails(
      m1.update({
        reactions: { '👍': ['bob'] },
        updatedAt: '2026-10-24T00:00:00.000Z',
        content: 'hijacked',
      }),
    );

    // Author recall remains allowed (sender-only path).
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertSucceeds(
      alice.doc('conversations/dm-1/messages/m1').update({
        recalledAt: '2026-10-24T00:00:00.000Z',
        updatedAt: '2026-10-24T00:00:00.000Z',
      }),
    );
    // Non-author cannot recall.
    await assertFails(
      bob.doc('conversations/dm-1/messages/m2').update({
        recalledAt: '2026-10-24T00:00:00.000Z',
        updatedAt: '2026-10-24T00:00:00.000Z',
      }),
    );
  });

  test('root messages readBy allowlist blocks delete/insert of other fields', async () => {
    await seedFirestore(async (db) => {
      await db.doc('conversations/c-root').set({
        schoolId: 'pu',
        memberIds: ['alice', 'bob'],
      });
      await db.doc('schools/pu/members/alice').set({ role: 'member', status: 'active' });
      await db.doc('schools/pu/members/bob').set({ role: 'member', status: 'active' });
      await db.doc('messages/root-1').set({
        conversationId: 'c-root',
        senderId: 'alice',
        text: 'root private',
        readBy: ['alice'],
        createdAt: '2026-10-20T00:00:00.000Z',
      });
      await db.doc('messages/root-2').set({
        conversationId: 'c-root',
        senderId: 'alice',
        text: 'no readBy yet',
        createdAt: '2026-10-20T00:00:00.000Z',
      });
    });

    const bob = testEnv.authenticatedContext('bob').firestore();

    await assertSucceeds(
      bob.doc('messages/root-1').update({
        readBy: ['alice', 'bob'],
        updatedAt: '2026-10-24T00:00:00.000Z',
      }),
    );
    // First addition of optional readBy.
    await assertSucceeds(
      bob.doc('messages/root-2').update({
        readBy: ['bob'],
        updatedAt: '2026-10-24T00:00:00.000Z',
      }),
    );

    await seedFirestore(async (db) => {
      await db.doc('messages/root-1').set({
        conversationId: 'c-root',
        senderId: 'alice',
        text: 'root private',
        readBy: ['alice'],
        createdAt: '2026-10-20T00:00:00.000Z',
      });
    });

    await assertFails(
      bob.doc('messages/root-1').update({
        readBy: ['alice', 'bob'],
        updatedAt: '2026-10-24T00:00:00.000Z',
        text: deleteField(),
      }),
    );
    await assertFails(
      bob.doc('messages/root-1').update({
        readBy: ['alice', 'bob'],
        updatedAt: '2026-10-24T00:00:00.000Z',
        text: 'hijacked',
      }),
    );
    await assertFails(
      bob.doc('messages/root-1').update({
        readBy: ['alice', 'bob'],
        updatedAt: '2026-10-24T00:00:00.000Z',
        injected: 'x',
      }),
    );
  });

  test('notification owner cannot modify protected payload while marking read', async () => {
    await seedFirestore(async (db) => {
      await db.doc('notifications/n1').set({
        userId: 'alice',
        title: 'System notice',
        body: 'Important payload',
        type: 'system',
        isRead: false,
        createdAt: '2026-10-20T00:00:00.000Z',
      });
      await db.doc('notifications/n2').set({
        userId: 'alice',
        title: 'No readAt yet',
        body: 'Payload',
        type: 'system',
        isRead: false,
        createdAt: '2026-10-20T00:00:00.000Z',
      });
    });

    const alice = testEnv.authenticatedContext('alice').firestore();

    // Legitimate first readAt / isRead.
    await assertSucceeds(
      alice.doc('notifications/n2').update({
        isRead: true,
        readAt: '2026-10-24T00:00:00.000Z',
        updatedAt: '2026-10-24T00:00:00.000Z',
      }),
    );

    await assertFails(
      alice.doc('notifications/n1').update({
        isRead: true,
        readAt: '2026-10-24T00:00:00.000Z',
        updatedAt: '2026-10-24T00:00:00.000Z',
        body: deleteField(),
      }),
    );
    await assertFails(
      alice.doc('notifications/n1').update({
        isRead: true,
        readAt: '2026-10-24T00:00:00.000Z',
        updatedAt: '2026-10-24T00:00:00.000Z',
        title: 'Forged title',
      }),
    );
    await assertFails(
      alice.doc('notifications/n1').update({
        isRead: true,
        readAt: '2026-10-24T00:00:00.000Z',
        updatedAt: '2026-10-24T00:00:00.000Z',
        type: 'admin',
      }),
    );

    await assertSucceeds(
      alice.doc('notifications/n1').update({
        isRead: true,
        readAt: '2026-10-24T00:00:00.000Z',
        updatedAt: '2026-10-24T00:00:00.000Z',
      }),
    );
  });
});

for (const path of [
  'users/synthetic/personalTimetable/current',
  'users/synthetic/schools/pu/personalTimetable/current',
]) {
  test(`protects dated arrangements from legacy replacements and stale revisions: ${path}`, async () => {
    const db = testEnv.authenticatedContext('synthetic').firestore();
    const ref = db.doc(path);
    const base = { schoolId: 'pu', courses: [], shareWithFriends: false };
    await assertSucceeds(ref.set(base));
    const change = { id: 'synthetic-stop', kind: 'cancel', originalDate: '2026-11-02' };
    await assertSucceeds(ref.set({ ...base, classExceptions: [change], classExceptionsRevision: 1 }));
    await assertFails(ref.set({ ...base, shareWithFriends: true }));
    await assertFails(ref.update({ classExceptions: [] }));
    await assertFails(ref.delete());
    await assertSucceeds(ref.set({ ...base, shareWithFriends: true }, { merge: true }));
    await assertFails(ref.update({ classExceptions: [], classExceptionsRevision: 1 }));
    await assertSucceeds(ref.update({ classExceptions: [], classExceptionsRevision: 2 }));
    await assertFails(ref.set(base));
    await assertSucceeds(ref.update({ classExceptions: [change], classExceptionsRevision: 3 }));
    await assertFails(ref.update({ classExceptions: [], classExceptionsRevision: 2 }));
  });
}

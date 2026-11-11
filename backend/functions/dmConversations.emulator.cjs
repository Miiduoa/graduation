const { before, beforeEach, after, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} = require('@firebase/rules-unit-testing');
const { createDmConversations } = require('./dmConversations');
const { createDmPhotos } = require('./dmPhotos');

const host = process.env.FIRESTORE_EMULATOR_HOST;
if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host ?? ''))
  throw new Error('Explicit local Firestore emulator required');
const projectId = 'demo-campus-dm-first-send';
const app = initializeApp({ projectId }, projectId);
const db = getFirestore(app);
const conversationId = 'dm_pu_alice_bob';
const thread = db.doc(`conversations/${conversationId}`);
const messages = thread.collection('messages');
const textId = 'first-text-message-00001';
const photoId = 'first-photo-message-0001';
const handlers = createDmConversations({ db });
let environment;

function request(uid = 'alice', data = {}) {
  return {
    auth: { uid },
    data: {
      viewerUid: uid,
      schoolId: 'pu',
      peerUid: uid === 'alice' ? 'bob' : 'alice',
      conversationId,
      messageId: textId,
      content: '第一次打招呼',
      ...data,
    },
  };
}

function inbox(uid) {
  return environment
    .authenticatedContext(uid)
    .firestore()
    .collection('conversations')
    .where('type', '==', 'dm')
    .where('schoolId', '==', 'pu')
    .where('memberIds', 'array-contains', uid)
    .orderBy('updatedAt', 'desc')
    .limit(100);
}

// Storage is a deterministic fixture. Firestore transactions and client rules
// below run against the real emulator, including transaction conflict retries.
function photoFixture(onPublish = async () => {}) {
  const objects = new Map();
  let generation = 10;
  const bucket = {
    file(name, options = {}) {
      const record = () => {
        const value = objects.get(name);
        if (!value || (options.generation && options.generation !== value.generation))
          throw Object.assign(new Error('missing generation'), { code: 404 });
        return value;
      };
      return {
        name,
        getMetadata: async () => [record()],
        download: async () => [record().bytes],
        generateSignedPostPolicyV4: async () => [
          { url: 'https://example.invalid/upload', fields: { key: name } },
        ],
        getSignedUrl: async () => [`https://example.invalid/read?generation=${options.generation}`],
        copy: async (destination, copyOptions) => {
          const source = record();
          assert.equal(copyOptions.preconditionOpts.ifGenerationMatch, 0);
          if (objects.has(destination.name))
            throw Object.assign(new Error('exists'), { code: 412 });
          objects.set(destination.name, {
            ...source,
            ...copyOptions,
            generation: String(++generation),
          });
          await onPublish();
        },
        delete: async () => {
          record();
          objects.delete(name);
        },
      };
    },
  };
  const photos = createDmPhotos({ db, getBucket: () => bucket });
  const photoRequest = (data) => request('alice', { messageId: photoId, ...data });
  return {
    objects,
    upload: () =>
      photos.delivery(
        photoRequest({
          action: 'uploadPhoto',
          contentType: 'image/png',
          fileName: 'photo.png',
          size: 12,
        }),
      ),
    stage: (objectPath) =>
      objects.set(objectPath, {
        generation: String(++generation),
        contentType: 'image/png',
        size: '12',
        crc32c: 'fixture-crc32c',
        bytes: Buffer.from('89504e470d0a1a0a0000000d', 'hex'),
        metadata: { uploader: 'alice', messageid: photoId },
      }),
    send: (objectPath) => photos.send(photoRequest({ path: objectPath })),
    read: (mediaId) =>
      photos.delivery(
        request('bob', {
          messageId: photoId,
          action: 'read',
          folder: 'photos',
          mediaId,
          fileName: 'sent.png',
        }),
      ),
  };
}

before(async () => {
  environment = await initializeTestEnvironment({
    projectId,
    firestore: {
      rules: fs.readFileSync(path.resolve(__dirname, '../firestore/firestore.rules'), 'utf8'),
    },
  });
});

beforeEach(async () => {
  const cleared = await fetch(
    `http://${host}/emulator/v1/projects/${projectId}/databases/(default)/documents`,
    { method: 'DELETE' },
  );
  assert.equal(cleared.ok, true);
  const batch = db.batch();
  for (const uid of ['alice', 'bob', 'outsider']) {
    batch.set(db.doc(`users/${uid}`), { schoolId: 'pu' });
    batch.set(db.doc(`schools/pu/members/${uid}`), { status: 'active', role: 'student' });
  }
  await batch.commit();
});

after(async () => {
  await environment?.cleanup();
  await db.terminate();
  await deleteApp(app);
});

test('active transferred members can still open a first DM without matching profile schoolId', async () => {
  await db.doc('users/alice').set({ schoolId: 'elsewhere' });
  await db.doc('users/bob').set({ primarySchoolId: 'pu' });
  assert.deepEqual(await handlers.prepare(request()), {
    conversationId,
    peerUid: 'bob',
    exists: false,
  });
  assert.equal((await thread.get()).exists, false);
  assert.deepEqual(await handlers.sendText(request()), { conversationId, messageId: textId });
  const row = (await thread.get()).data();
  assert.equal(row.type, 'dm');
  assert.equal(row.schoolId, 'pu');
  assert.deepEqual(row.memberIds, ['alice', 'bob']);
  assert.equal((await messages.get()).size, 1);
});

test('a missing conversation is denied by client rules; prepare and an authorized empty inbox create nothing', async () => {
  const alice = environment.authenticatedContext('alice').firestore();
  await assertFails(alice.doc(thread.path).get({ source: 'server' }));
  await assertFails(alice.collection(messages.path).get({ source: 'server' }));
  const prepared = await handlers.prepare(request());
  assert.deepEqual(prepared, { conversationId, peerUid: 'bob', exists: false });
  assert.deepEqual(await handlers.prepare(request('bob')), {
    conversationId,
    peerUid: 'alice',
    exists: false,
  });
  assert.equal((await assertSucceeds(inbox('alice').get({ source: 'server' }))).empty, true);
  assert.equal((await thread.get()).exists, false);
  assert.equal((await messages.get()).empty, true);
});

test('simultaneous first text sends and duplicate retries create one thread and one copy of each message', async () => {
  const bobId = 'first-bob-message-000001';
  const aliceRequest = request();
  const bobRequest = request('bob', { messageId: bobId, content: '我也想找你' });
  const receipts = await Promise.all([
    handlers.sendText(aliceRequest),
    handlers.sendText(bobRequest),
    handlers.sendText(aliceRequest),
    handlers.sendText(bobRequest),
  ]);
  assert.deepEqual(
    receipts.map((item) => item.messageId),
    [textId, bobId, textId, bobId],
  );
  assert.equal((await db.collection('conversations').get()).size, 1);
  assert.equal((await messages.get()).size, 2);
  const row = (await thread.get()).data();
  assert.deepEqual(row.memberIds, ['alice', 'bob']);
  assert.equal(row.type, 'dm');
  const latest = (await messages.doc(row.lastMessage.id).get()).data();
  assert.equal(row.lastMessageText, latest.content);
  assert.equal(row.lastMessageSenderId, latest.senderId);
  assert.equal(row.lastMessageAt.isEqual(latest.createdAt), true);
  for (const uid of ['alice', 'bob']) {
    assert.equal((await assertSucceeds(inbox(uid).get({ source: 'server' }))).size, 1);
    const client = environment.authenticatedContext(uid).firestore();
    assert.equal(
      (await assertSucceeds(client.collection(messages.path).get({ source: 'server' }))).size,
      2,
    );
  }
  const outsider = environment.authenticatedContext('outsider').firestore();
  await assertFails(outsider.doc(thread.path).get({ source: 'server' }));
  await assertFails(outsider.collection(messages.path).get({ source: 'server' }));
});

test('first photo and recipient-first text race into the same canonical thread without an empty draft conversation', async () => {
  const photos = photoFixture();
  const grant = await photos.upload();
  photos.stage(grant.path);
  assert.equal((await thread.get()).exists, false);
  await assert.rejects(photos.read(grant.mediaId), { code: 'permission-denied' });
  await Promise.all([
    photos.send(grant.path),
    photos.send(grant.path),
    handlers.sendText(request('bob', { content: '傳張照片給我吧' })),
  ]);
  assert.equal((await db.collection('conversations').get()).size, 1);
  assert.equal((await messages.get()).size, 2);
  const image = (await messages.doc(photoId).get()).data();
  assert.equal(image.type, 'image');
  assert.equal(image.attachmentPath, grant.path.replace('photo.png', 'sent.png'));
  assert.ok(image.attachmentGeneration);
  assert.equal(photos.objects.has(grant.path), false);
  assert.equal(
    (await photos.read(grant.mediaId)).url,
    `https://example.invalid/read?generation=${image.attachmentGeneration}`,
  );
  assert.equal((await assertSucceeds(inbox('alice').get({ source: 'server' }))).size, 1);
  assert.equal((await assertSucceeds(inbox('bob').get({ source: 'server' }))).size, 1);
});

test('late first-send receipt replay preserves a newer inbox preview', async () => {
  await handlers.sendText(request());
  await handlers.sendText(
    request('bob', {
      messageId: 'second-text-message-0001',
      content: '後來的新訊息',
    }),
  );
  const beforeReplay = (await thread.get()).data();
  assert.deepEqual(await handlers.sendText(request()), { conversationId, messageId: textId });
  const afterReplay = (await thread.get()).data();
  assert.deepEqual(afterReplay.lastMessage, beforeReplay.lastMessage);
  assert.equal(afterReplay.updatedAt.isEqual(beforeReplay.updatedAt), true);
  assert.equal((await messages.get()).size, 2);
  await db.doc('users/bob/blockedUsers/alice').set({});
  await assert.rejects(handlers.sendText(request()), { code: 'permission-denied' });
});

test('existing client DM sends honor both block stores and cannot update the inbox when rejected', async () => {
  await handlers.sendText(request());
  const alice = environment.authenticatedContext('alice').firestore();
  const sendClientMessage = (id) => {
    const batch = alice.batch();
    batch.set(alice.doc(`${messages.path}/${id}`), {
      conversationId,
      senderId: 'alice',
      type: 'text',
      content: '既有對話的訊息',
      readBy: ['alice'],
    });
    batch.update(alice.doc(thread.path), { lastMessageText: id });
    return batch.commit();
  };
  await assertSucceeds(sendClientMessage('client-before-block'));
  const legacyMessage = { conversationId, senderId: 'alice', text: '舊版路徑的訊息' };
  await assertSucceeds(alice.doc('messages/legacy-before-block').set(legacyMessage));
  for (const blockPath of [
    'users/alice/blockedUsers/bob',
    'users/bob/blockedUsers/alice',
    'friendBlocks/alice_bob',
    'friendBlocks/bob_alice',
  ]) {
    await db.doc(blockPath).set({});
    await assertFails(sendClientMessage('client-after-block'));
    await assertFails(alice.doc('messages/legacy-after-block').set(legacyMessage));
    await assertFails(alice.doc(thread.path).update({ type: 'group' }));
    await assertFails(alice.doc(thread.path).update({ lastMessageText: 'forged preview' }));
    assert.equal((await messages.doc('client-after-block').get()).exists, false);
    assert.equal((await thread.get()).data().lastMessageText, 'client-before-block');
    await db.doc(blockPath).delete();
  }
  await assertSucceeds(sendClientMessage('client-after-unblock'));
  await assertSucceeds(alice.doc('messages/legacy-after-unblock').set(legacyMessage));
});

test('a blocked sender cannot change any inbox preview field while read markers remain writable', async () => {
  await handlers.sendText(request());
  await db.doc('friendBlocks/bob_alice').set({});
  const alice = environment.authenticatedContext('alice').firestore();
  const reference = alice.doc(thread.path);
  for (const change of [
    { lastMessage: { content: 'forged', type: 'text' } },
    { lastMessageText: 'forged' },
    { lastMessageType: 'image' },
    { lastMessageAt: new Date() },
    { lastMessageSenderId: 'bob' },
    { updatedAt: new Date() },
  ]) {
    await assertFails(reference.update(change));
  }
  await assertSucceeds(reference.update({ 'lastReadBy.alice': new Date() }));
  assert.equal((await thread.get()).data().lastMessage.id, textId);
});

test('a direct-message block still allows a member to post in their shared group conversation', async () => {
  await db.doc('users/bob/blockedUsers/alice').set({});
  await db.doc('conversations/shared-group').set({
    type: 'group',
    schoolId: 'pu',
    memberIds: ['alice', 'bob', 'outsider'],
  });
  const alice = environment.authenticatedContext('alice').firestore();
  await assertSucceeds(
    alice.doc('conversations/shared-group/messages/group-message').set({
      conversationId: 'shared-group',
      senderId: 'alice',
      type: 'text',
      content: '群組討論',
      readBy: ['alice'],
    }),
  );
});

test('membership revoked after prepare or on a transaction retry prevents all first-message writes', async () => {
  await handlers.prepare(request());
  let attempts = 0;
  const retryingDb = {
    collection: db.collection.bind(db),
    runTransaction: (callback) =>
      db.runTransaction(async (transaction) => {
        attempts++;
        if (attempts === 2) await db.doc('schools/pu/members/bob').update({ status: 'inactive' });
        const result = await callback(transaction);
        if (attempts === 1) throw Object.assign(new Error('retry'), { code: 10 });
        return result;
      }),
  };
  await assert.rejects(createDmConversations({ db: retryingDb }).sendText(request()), {
    code: 'permission-denied',
  });
  assert.equal(attempts, 2);
  assert.equal((await thread.get()).exists, false);
  assert.equal((await messages.get()).empty, true);
  await assert.rejects(handlers.prepare(request()), { code: 'permission-denied' });
});

test('revocation during first-photo publication leaves no thread and a safe retry commits exactly once', async () => {
  const photos = photoFixture(() => db.doc('users/bob/blockedUsers/alice').set({}));
  const grant = await photos.upload();
  photos.stage(grant.path);
  await assert.rejects(photos.send(grant.path), { code: 'permission-denied' });
  assert.equal((await thread.get()).exists, false);
  assert.equal((await messages.get()).empty, true);
  await db.doc('users/bob/blockedUsers/alice').delete();
  const receipt = await photos.send(grant.path);
  assert.deepEqual(receipt, { conversationId, messageId: photoId });
  assert.deepEqual(await photos.send(grant.path), receipt);
  assert.equal((await messages.get()).size, 1);
  assert.equal((await thread.get()).data().lastMessage.id, photoId);
});

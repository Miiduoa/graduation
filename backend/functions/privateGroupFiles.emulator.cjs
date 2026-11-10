/* Real HTTP, Firestore transactions and Cloud Storage operations. Token verification uses synthetic identities. */
/* global __dirname */
const { after, before, beforeEach, test } = require('node:test');
const process = require('node:process');
const { Buffer } = require('node:buffer');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage');
const { initializeTestEnvironment, assertFails } = require('@firebase/rules-unit-testing');
const { getBytes } = require('firebase/storage');
const { onRequest } = require('firebase-functions/v2/https');
const { createPrivateGroupFileHandler } = require('./privateGroupFiles');
const { createRequestListener } = require('./httpAdapter');
const { classifyFunctions } = require('./functionRegistry');
const { revokePrivateGroupFileTokens } = require('./privateGroupFilesMigration');

for (const name of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_STORAGE_EMULATOR_HOST']) {
  const local = /^(?:127\.0\.0\.1|localhost):([0-9]{1,5})$/.exec(process.env[name] || '');
  if (!local || Number(local[1]) < 1 || Number(local[1]) > 65535) {
    throw new Error(`Run only with an explicit local ${name}`);
  }
}
process.env.STORAGE_EMULATOR_HOST = `http://${process.env.FIREBASE_STORAGE_EMULATOR_HOST}`;

const projectId = 'demo-campus-private-files';
const app = initializeApp({ projectId, storageBucket: `${projectId}.appspot.com` }, 'private-group-files-tests');
const db = getFirestore(app);
const bucket = getStorage(app).bucket();
let rules, server, port, caseNumber = 0, groupId, assignmentId;
const paths = () => ({
  cover: `groups/${groupId}/cover.jpg`,
  post: `groups/${groupId}/posts/one/notes.pdf`,
  answer: `assignments/${assignmentId}/submissions/alice/answer.pdf`,
});

function request(method, objectPath, uid = 'alice', data = 'original') {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1', port, method,
      path: `/privateGroupFile?path=${encodeURIComponent(objectPath)}`,
      headers: {
        ...(uid ? { authorization: `Bearer ${uid}` } : {}),
        'content-type': objectPath.endsWith('.jpg') ? 'image/jpeg' : 'application/pdf',
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('error', reject);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    req.end(method === 'POST' ? data : undefined);
  });
}

function legacyDownload(objectPath, token) {
  const url = `http://${process.env.FIREBASE_STORAGE_EMULATOR_HOST}/v0/b/${bucket.name}/o/${encodeURIComponent(objectPath)}?alt=media&token=${encodeURIComponent(token)}`;
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('error', reject);
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
    }).on('error', reject);
  });
}

before(async () => {
  rules = await initializeTestEnvironment({
    projectId,
    firestore: {},
    storage: { rules: fs.readFileSync(path.resolve(__dirname, '../storage/storage.rules'), 'utf8') },
  });
  const handler = createPrivateGroupFileHandler({
    db, bucket,
    verifyIdToken: async (token, checkRevoked) => {
      assert.equal(checkRevoked, true);
      if (!['alice', 'bob', 'teacher', 'outsider'].includes(token)) throw new Error('Invalid test token');
      return { uid: token, role: 'admin' };
    },
  });
  const classified = classifyFunctions({
    privateGroupFile: onRequest({ cors: ['https://nuni.tw'] }, handler),
  });
  server = http.createServer(createRequestListener({ httpFunctions: classified.httpFunctions }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
});

beforeEach(async () => {
  await rules.clearFirestore();
  // The rules test helper only deletes root-level items. This dedicated emulator bucket
  // also contains nested groups/assignments that must not leak into token migration cases.
  await bucket.deleteFiles({ force: true });
  groupId = `course-${++caseNumber}`;
  assignmentId = `work-${caseNumber}`;
  await db.doc(`groups/${groupId}`).set({ schoolId: 'pu', type: 'course' });
  await db.doc(`assignments/${assignmentId}`).set({ groupId });
  // 下載貼文附件需要貼文仍存在。
  await db.doc(`groups/${groupId}/posts/one`).set({
    authorId: 'alice',
    // The normal shared download must reference the published attachment.
    attachments: [`groups/${groupId}/posts/one/notes.pdf`],
  });
  for (const uid of ['alice', 'bob', 'teacher']) {
    await db.doc(`users/${uid}`).set({ displayName: uid });
    await db.doc(`schools/pu/members/${uid}`).set({ status: 'active' });
    await db.doc(`groups/${groupId}/members/${uid}`).set({
      status: 'active', role: uid === 'teacher' ? 'instructor' : 'member',
    });
  }
});

after(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  if (rules) await rules.cleanup();
  await db.terminate();
  await deleteApp(app);
});

test('active HTTP reads work, direct SDK access is denied, and canonical school revocation blocks later HTTP reads and uploads', { timeout: 30_000 }, async () => {
  await db.doc(`groups/${groupId}/assignments/${assignmentId}/submissions/alice`).set({
    userId: 'alice', submittedAt: '2026-11-06T00:00:00.000Z', attachments: [paths().answer],
  });
  for (const [kind, objectPath] of Object.entries(paths())) {
    const upload = await request('POST', objectPath, kind === 'cover' ? 'teacher' : 'alice');
    assert.equal(upload.status, 201, upload.body);
    for (const uid of ['alice', 'teacher']) {
      const result = await request('GET', objectPath, uid);
      assert.equal(result.status, 200, result.body);
      assert.equal(result.body, 'original');
      assert.equal(result.headers['cache-control'], 'private, no-store');
      assert.equal(result.headers['x-content-type-options'], 'nosniff');
      const direct = rules.authenticatedContext(uid).storage().ref(objectPath);
      await assertFails(getBytes(direct));
      await assertFails(direct.getDownloadURL());
      await assertFails(direct.putString('forged', 'raw', { contentType: 'application/pdf' }));
    }
  }
  for (const uid of ['alice', 'teacher']) {
    await db.doc(`schools/pu/members/${uid}`).update({ status: 'inactive' });
    await db.doc(`schools/other/members/${uid}`).set({ status: 'active' });
    await db.doc(`users/${uid}/groups/${groupId}`).set({ status: 'active', role: 'owner', schoolId: 'other' });
    for (const objectPath of Object.values(paths())) {
      assert.equal((await request('GET', objectPath, uid)).status, 403);
      const revokedUploadPath = objectPath === paths().cover ? objectPath : objectPath.replace('.', '-new.');
      assert.equal((await request('POST', revokedUploadPath, uid)).status, 403);
    }
  }
});

test('post draft sibling stays private to its author until explicitly attached', { timeout: 30_000 }, async () => {
  const published = paths().post;
  const draft = published.replace('notes.pdf', 'draft.pdf');
  assert.equal((await request('POST', published, 'alice')).status, 201);
  assert.equal((await request('POST', draft, 'alice')).status, 201);
  // Members (including instructors) can read only the referenced publication.
  assert.equal((await request('GET', published, 'teacher')).status, 200);
  assert.equal((await request('GET', published, 'bob')).status, 200);
  assert.equal((await request('GET', draft, 'teacher')).status, 403);
  assert.equal((await request('GET', draft, 'bob')).status, 403);
  // The owner may preview an unreferenced upload; removing a publication closes access.
  assert.equal((await request('GET', draft, 'alice')).status, 200);
  await db.doc(`groups/${groupId}/posts/one`).update({ attachments: [] });
  assert.equal((await request('GET', published, 'teacher')).status, 403);
  assert.equal((await request('GET', published, 'alice')).status, 200);
  await db.doc(`groups/${groupId}/posts/one`).update({ attachments: [published] });
  assert.equal((await request('GET', published, 'teacher')).status, 200);
  // Revocation still overrides the attachment reference.
  await db.doc('schools/pu/members/teacher').update({ status: 'inactive' });
  assert.equal((await request('GET', published, 'teacher')).status, 403);
});

test('HTTP submission privacy, new filenames and manager cover updates remain supported', { timeout: 30_000 }, async () => {
  for (const status of ['submitted', 'graded']) {
    const objectPath = paths().answer.replace('answer.pdf', `${status}.pdf`);
    assert.equal((await request('POST', objectPath)).status, 201);
    await db.doc(`groups/${groupId}/assignments/${assignmentId}/submissions/alice`).set({
      userId: 'alice', groupId, assignmentId, status,
      submittedAt: '2026-11-06T00:00:00.000Z',
      attachments: [objectPath],
      ...(status === 'graded' ? { gradeScore: 90 } : {}),
    });
    assert.equal((await request('GET', objectPath)).body, 'original');
    assert.equal((await request('GET', objectPath, 'teacher')).status, 200);
    assert.equal((await request('GET', objectPath, 'bob')).status, 403);
    assert.equal((await request('POST', objectPath.replace('.pdf', '-new.pdf'))).status, 201);
  }
  assert.equal((await request('POST', paths().cover, 'teacher')).status, 201);
  assert.equal((await request('POST', paths().cover, 'alice', 'forged cover')).status, 403);
  assert.equal((await request('POST', paths().cover, 'teacher', 'new cover')).status, 200);
  assert.equal((await request('GET', paths().cover)).body, 'new cover');
});

// firebase-tools 15.34.1 ignores GCS generation preconditions. Atomic overwrite/race
// behavior requires real Cloud Storage staging. Unit tests verify SDK query serialization.
test('legacy assignment upload is not visible to the instructor before submission', { timeout: 30_000 }, async () => {
  const objectPath = paths().answer;
  assert.equal((await request('POST', objectPath, 'alice')).status, 201);
  assert.equal((await request('GET', objectPath, 'alice')).status, 200);
  assert.equal((await request('GET', objectPath, 'teacher')).status, 403);
  const receipt = db.doc(`groups/${groupId}/assignments/${assignmentId}/submissions/alice`);
  await receipt.set({ userId: 'alice', submittedAt: Date.now(), attachments: [objectPath] });
  assert.equal((await request('GET', objectPath, 'teacher')).status, 200);
  await receipt.update({ attachments: [] });
  assert.equal((await request('GET', objectPath, 'teacher')).status, 403);
  await receipt.update({ attachments: [objectPath] });
  await db.doc('schools/pu/members/teacher').update({ status: 'inactive' });
  assert.equal((await request('GET', objectPath, 'teacher')).status, 403);
});

test('direct Storage clients cannot list private objects or alter their metadata', { timeout: 30_000 }, async () => {
  const objectPath = paths().post;
  assert.equal((await request('POST', objectPath)).status, 201);
  for (const uid of ['alice', 'bob', 'teacher', 'outsider']) {
    const direct = rules.authenticatedContext(uid).storage().ref(objectPath);
    await assertFails(direct.getMetadata());
    await assertFails(direct.updateMetadata({ customMetadata: { firebaseStorageDownloadTokens: 'forged-token' } }));
    await assertFails(direct.parent.listAll());
    await assertFails(direct.delete());
  }
  assert.equal((await request('GET', objectPath)).body, 'original');
});

test('group removal, account closure and missing school membership override cached identities without revealing file existence', { timeout: 30_000 }, async () => {
  const objectPath = paths().post;
  assert.equal((await request('POST', objectPath)).status, 201);
  assert.equal((await request('GET', objectPath, null)).status, 401);
  for (const missing of [objectPath, objectPath.replace('.pdf', '-missing.pdf')]) {
    assert.equal((await request('GET', missing, 'outsider')).status, 403);
  }
  assert.equal((await request('GET', objectPath.replace('.pdf', '-missing.pdf'))).status, 404);
  await db.doc(`groups/${groupId}/members/alice`).update({ status: 'left' });
  assert.equal((await request('GET', objectPath)).status, 403);
  await db.doc(`groups/${groupId}/members/alice`).update({ status: 'active' });
  await db.doc('users/alice').set({ accountDeletionInProgress: true });
  assert.equal((await request('GET', objectPath)).status, 403);
  await db.doc('users/alice').set({ displayName: 'Alice' });
  await db.doc('schools/pu/members/alice').delete();
  assert.equal((await request('GET', objectPath)).status, 403);
});

test('legacy URLs bypass rules and the emulator token-retention limitation is reported as migration failure', { timeout: 30_000 }, async () => {
  const privatePaths = Object.values(paths());
  const allPaths = [...privatePaths, 'avatars/alice.jpg'];
  for (const [index, objectPath] of allPaths.entries()) {
    await bucket.file(objectPath).save(Buffer.from('legacy private bytes'), {
      resumable: false,
      metadata: {
        contentType: 'application/pdf',
        metadata: { firebaseStorageDownloadTokens: `synthetic-old-token-${index}`, purpose: 'preserved' },
      },
    });
  }
  await db.doc('schools/pu/members/alice').update({ status: 'inactive' });
  for (const [index, objectPath] of privatePaths.entries()) {
    assert.equal((await request('GET', objectPath)).status, 403);
    assert.equal((await legacyDownload(objectPath, `synthetic-old-token-${index}`)).status, 200);
  }
  const dryRun = await revokePrivateGroupFileTokens({ bucket });
  assert.equal(dryRun.candidates, 3);
  assert.equal(dryRun.revoked, 0);
  assert.equal((await legacyDownload(privatePaths[0], 'synthetic-old-token-0')).status, 200);

  const applied = await revokePrivateGroupFileTokens({ bucket, apply: true });
  // The emulator stores tokens outside custom metadata and retains them after a null
  // GCS PATCH. The migration must detect this and leave real revocation unverified.
  assert.equal(applied.revoked, 0);
  assert.equal(applied.conflicts, 0);
  assert.equal(applied.failures, 3);
  await db.doc('schools/pu/members/alice').update({ status: 'active' });
  for (const [index, objectPath] of privatePaths.entries()) {
    const tokenRead = await legacyDownload(objectPath, `synthetic-old-token-${index}`);
    assert.equal(tokenRead.status, 200);
    const [metadata] = await bucket.file(objectPath).getMetadata();
    assert.equal(metadata.metadata.purpose, 'preserved');
    assert.equal(metadata.metadata.firebaseStorageDownloadTokens, `synthetic-old-token-${index}`);
    const authorized = await request('GET', objectPath);
    assert.equal(authorized.status, 200, authorized.body);
    assert.equal(authorized.body, 'legacy private bytes');
  }
  const replay = await revokePrivateGroupFileTokens({ bucket, apply: true });
  assert.equal(replay.revoked, 0);
  assert.equal(replay.failures, 3);
  assert.equal((await legacyDownload('avatars/alice.jpg', 'synthetic-old-token-3')).status, 200);
});

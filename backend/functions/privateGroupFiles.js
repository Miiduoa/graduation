'use strict';

const { pipeline } = require('node:stream/promises');
const { Transform } = require('node:stream');
const { verifyRequestFirebaseUser } = require('./sessionSecurity');

const MANAGER_ROLES = new Set(['owner', 'admin', 'instructor', 'moderator']);
const DOCUMENT_TYPES = new Set([
  'application/pdf', 'text/plain', 'application/msword', 'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
]);

function validSegment(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 255
    // Reject control characters before constructing document and object paths.
    // eslint-disable-next-line no-control-regex
    && value !== '.' && value !== '..' && !/[\\/\u0000-\u001f\u007f]/.test(value);
}

/** Returns the exact legacy private namespace scope, or null for any other path. */
function parsePrivateGroupFilePath(value) {
  if (typeof value !== 'string' || Buffer.byteLength(value) > 1024) return null;
  const parts = value.split('/');
  if (!parts.every(validSegment)) return null;
  const common = { path: value, filename: parts.at(-1) };
  if (parts[0] === 'groups' && parts.length === 3) {
    return { ...common, kind: 'group-cover', groupId: parts[1], maxBytes: 5 * 1024 * 1024 };
  }
  if (parts[0] === 'groups' && parts[2] === 'posts' && parts.length === 5) {
    return {
      ...common, kind: 'group-post', groupId: parts[1], postId: parts[3],
      maxBytes: 20 * 1024 * 1024,
    };
  }
  if (parts[0] === 'assignments' && parts[2] === 'submissions' && parts.length === 5) {
    return {
      ...common, kind: 'assignment', assignmentId: parts[1], userId: parts[3],
      maxBytes: 50 * 1024 * 1024,
    };
  }
  return null;
}

function failure(statusCode, message) {
  return Object.assign(new Error(message), { statusCode });
}

async function authorize(db, scope, uid, writing) {
  await db.runTransaction(async (tx) => {
    let groupId = scope.groupId;
    if (scope.kind === 'assignment') {
      const assignment = await tx.get(db.collection('assignments').doc(scope.assignmentId));
      groupId = assignment.data()?.groupId;
      if (!assignment.exists || !validSegment(groupId)) throw failure(403, 'File access denied');
    }
    const groupRef = db.collection('groups').doc(groupId);
    const [account, group, member] = await tx.getAll(
      db.collection('users').doc(uid), groupRef, groupRef.collection('members').doc(uid),
    );
    const accountData = account.data() || {};
    const schoolId = group.data()?.schoolId;
    if (accountData.accountDeletionInProgress === true
      || ['deleted', 'disabled', 'suspended', 'inactive'].includes(accountData.status)
      || !group.exists || !validSegment(schoolId)
      || !member.exists || member.data().status !== 'active') {
      throw failure(403, 'File access denied');
    }
    const schoolMember = await tx.get(
      db.collection('schools').doc(schoolId).collection('members').doc(uid),
    );
    if (!schoolMember.exists || schoolMember.data().status !== 'active') {
      throw failure(403, 'File access denied');
    }
    const manager = MANAGER_ROLES.has(member.data().role);
    if ((writing && scope.kind === 'group-cover' && !manager)
      || (scope.kind === 'assignment' && scope.userId !== uid && (writing || !manager))) {
      throw failure(403, 'File access denied');
    }
  }, { readOnly: true });
}

async function uploadBody(req, limit, timeoutMs) {
  const buffered = Buffer.isBuffer(req.rawBody) ? req.rawBody : req.body;
  if (Buffer.isBuffer(buffered)) {
    if (buffered.length >= limit) throw failure(413, 'File is too large');
    return buffered;
  }
  if (req.destroyed || req.aborted) throw failure(400, 'Upload interrupted');
  return new Promise((resolve, reject) => {
    const chunks = [];
    let length = 0;
    const cleanup = () => {
      clearTimeout(timer);
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('error', onError);
    };
    const onError = (error) => {
      cleanup();
      req.pause();
      req.once('error', () => {});
      reject(error);
    };
    const onData = (chunk) => {
      const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      length += data.length;
      if (length >= limit) onError(failure(413, 'File is too large'));
      else chunks.push(data);
    };
    const onEnd = () => {
      cleanup();
      resolve(Buffer.concat(chunks));
    };
    const timer = setTimeout(() => onError(failure(408, 'Upload timed out')), timeoutMs);
    req.on('data', onData);
    req.once('end', onEnd);
    req.once('error', onError);
  });
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

/**
 * privateGroupFile HTTP contract
 * GET/POST ?path=<exact Storage object path>, Authorization: Bearer <Firebase ID token>.
 * GET streams private bytes. POST accepts raw bytes with Content-Type and returns { path }.
 * Attachments use atomic create-only writes. Managers replace covers with generation CAS.
 * Every request checks canonical account, group, group membership and school membership.
 * Storage rules deny direct client access, and deployment must revoke legacy download tokens.
 */
function createPrivateGroupFileHandler({
  db, bucket, verifyIdToken, uploadTimeoutMs = 30_000, maxConcurrentUploads = 2,
}) {
  const verify = verifyIdToken || ((token, checkRevoked) =>
    require('firebase-admin/auth').getAuth().verifyIdToken(token, checkRevoked));
  let activeUploads = 0;
  return async function privateGroupFile(req, res) {
    let uploading = false;
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      if (!['GET', 'POST'].includes(req.method)) {
        res.setHeader('Allow', 'GET, POST');
        throw failure(405, 'Method not allowed');
      }
      const user = await verifyRequestFirebaseUser(req, (token) => verify(token, true));
      if (!validSegment(user.uid)) throw failure(401, 'Invalid Firebase ID token');
      const scope = parsePrivateGroupFilePath(req.query?.path);
      if (!scope) throw failure(400, 'Invalid private file path');
      const writing = req.method === 'POST';
      await authorize(db, scope, user.uid, writing);
      if (writing) {
        if (activeUploads >= maxConcurrentUploads) throw failure(429, 'Too many uploads');
        activeUploads += 1;
        uploading = true;
      }
      const storageBucket = typeof bucket === 'function' ? bucket() : bucket;
      const file = storageBucket.file(scope.path);

      if (!writing) {
        const [metadata] = await file.getMetadata();
        const size = Number(metadata.size);
        if (!Number.isSafeInteger(size) || size < 0 || size >= scope.maxBytes) {
          throw failure(413, 'File is too large');
        }
        if (typeof metadata.generation !== 'string' || !/^[1-9]\d*$/.test(metadata.generation)
          || !Number.isSafeInteger(Number(metadata.generation))) {
          throw failure(500, 'Missing file generation');
        }
        const filename = encodeURIComponent(scope.filename)
          .replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
        const contentType = String(metadata.contentType || 'application/octet-stream');
        res.setHeader('Content-Type', /^[\w.+-]+\/[\w.+-]+$/.test(contentType)
          ? contentType : 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename="download"; filename*=UTF-8''${filename}`);
        // A replacement during the read must not substitute bytes from a newer generation.
        const version = storageBucket.file(scope.path, { generation: metadata.generation });
        let bytesRead = 0;
        const bounded = new Transform({
          transform(chunk, encoding, callback) {
            bytesRead += chunk.length;
            if (bytesRead >= scope.maxBytes) callback(failure(413, 'File is too large'));
            else callback(null, chunk);
          },
        });
        await pipeline(version.createReadStream(), bounded, res);
        return;
      }

      const contentType = String(req.headers?.['content-type'] || '').split(';')[0].trim().toLowerCase();
      const image = /^image\/[\w.+-]+$/.test(contentType);
      if ((scope.kind === 'group-cover' && (!/^cover\.[A-Za-z0-9]+$/.test(scope.filename) || !image))
        || (!image && !DOCUMENT_TYPES.has(contentType))) {
        throw failure(400, 'Unsupported file type or filename');
      }
      const bytes = await uploadBody(req, scope.maxBytes, uploadTimeoutMs);
      // Receiving bytes can take time. Revocation during an upload must prevent its commit.
      await authorize(db, scope, user.uid, true);
      let generation = 0;
      if (scope.kind === 'group-cover') {
        try {
          const [metadata] = await file.getMetadata();
          generation = metadata.generation;
          if (typeof generation !== 'string' || !/^[1-9]\d*$/.test(generation)) {
            throw failure(500, 'Missing file generation');
          }
        } catch (error) {
          if (Number(error.code) !== 404) throw error;
        }
      }
      await file.save(bytes, {
        resumable: false,
        preconditionOpts: { ifGenerationMatch: generation },
        metadata: { contentType, cacheControl: 'private, no-store' },
      });
      sendJson(res, generation === 0 ? 201 : 200, { path: scope.path });
    } catch (error) {
      if (res.headersSent || res.destroyed) {
        if (!res.destroyed) res.destroy(error);
        return;
      }
      const storageStatus = Number(error.code);
      if (storageStatus === 404) sendJson(res, 404, { error: 'File not found' });
      else if (storageStatus === 412) sendJson(res, 409, { error: 'File already exists or changed' });
      else if ([400, 401, 403, 405, 408, 413, 429].includes(error.statusCode)) {
        if (req.method === 'POST') res.setHeader('Connection', 'close');
        sendJson(res, error.statusCode, { error: error.message });
      } else sendJson(res, 500, { error: 'File request failed' });
    } finally {
      if (uploading) activeUploads -= 1;
    }
  };
}

module.exports = { createPrivateGroupFileHandler, parsePrivateGroupFilePath };

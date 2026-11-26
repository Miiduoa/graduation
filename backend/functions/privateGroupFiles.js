'use strict';

const { pipeline } = require('node:stream/promises');
const { Transform } = require('node:stream');
const { verifyRequestFirebaseUser } = require('./sessionSecurity');
const {
  parsePrivateGroupFilePath,
  authorizePrivateFile,
  PRIVATE_DOCUMENT_TYPES,
  isPrivateFileImage,
  validPrivateFileSegment,
} = require('./generated/shared/privateFileAccess');

const DOCUMENT_TYPES = PRIVATE_DOCUMENT_TYPES;

function failure(statusCode, message) {
  return Object.assign(new Error(message), { statusCode });
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
      if (!validPrivateFileSegment(user.uid)) throw failure(401, 'Invalid Firebase ID token');
      const scope = parsePrivateGroupFilePath(req.query?.path);
      if (!scope || (scope.kind === 'group-cover' && !/^cover\.[A-Za-z0-9]+$/.test(scope.filename))) {
        throw failure(400, 'Invalid private file path');
      }
      const writing = req.method === 'POST';
      await authorizePrivateFile(db, scope, user.uid, writing);
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
        // GCS metadata lookup may outlive a membership or submission revocation.
        // Reauthorize before opening any read stream or sending response headers.
        await authorizePrivateFile(db, scope, user.uid, false);
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
      const image = isPrivateFileImage(contentType);
      if ((scope.kind === 'group-cover' && !image)
        || (!image && !DOCUMENT_TYPES.has(contentType))) {
        throw failure(400, 'Unsupported file type or filename');
      }
      const bytes = await uploadBody(req, scope.maxBytes, uploadTimeoutMs);
      // Receiving bytes can take time. Revocation during an upload must prevent its commit.
      await authorizePrivateFile(db, scope, user.uid, true);
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
      // Cover generation lookup can also wait across a manager or school revocation.
      await authorizePrivateFile(db, scope, user.uid, true);
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

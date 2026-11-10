'use strict';

const { parsePrivateGroupFilePath } = require('./privateGroupFiles');

const TOKEN_KEY = 'firebaseStorageDownloadTokens';
const PRIVATE_KINDS = new Set(['group-cover', 'group-post', 'assignment']);
const APP_NAME = 'private-group-file-token-migration';

function getAdminBucket({ projectId, bucketName }) {
  const { initializeApp, getApps, applicationDefault } = require('firebase-admin/app');
  const { getStorage } = require('firebase-admin/storage');
  let app = getApps().find((candidate) => candidate.name === APP_NAME);
  if (app && (app.options.projectId !== projectId || app.options.storageBucket !== bucketName)) {
    throw new Error('The migration app is already bound to a different target');
  }
  if (!app) {
    app = initializeApp({
      projectId, storageBucket: bucketName, credential: applicationDefault(),
    }, APP_NAME);
  }
  return getStorage(app).bucket(bucketName);
}

function readCustomMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw new Error('Invalid object metadata');
  }
  const custom = metadata.metadata ?? {};
  if (typeof custom !== 'object' || Array.isArray(custom)) {
    throw new Error('Invalid custom metadata');
  }
  return custom;
}

function generationPrecondition(value) {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) {
    return String(value);
  }
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return value;
  throw new Error('Missing or invalid object generation');
}

/** Remove legacy bearer URLs after deploying the private file gateway and rules. */
async function revokePrivateGroupFileTokens({ bucket, apply = false, pageSize = 100 }) {
  if (typeof apply !== 'boolean' || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 1000) {
    throw new Error('Invalid private file migration options');
  }
  const summary = {
    dryRun: !apply, listed: 0, matched: 0, candidates: 0,
    revoked: 0, conflicts: 0, failures: 0,
  };

  for (const prefix of ['groups/', 'assignments/']) {
    let pageToken;
    const seenTokens = new Set();
    do {
      let files, nextQuery;
      try {
        [files, nextQuery] = await bucket.getFiles({
          prefix, versions: true, autoPaginate: false, maxResults: pageSize,
          ...(pageToken ? { pageToken } : {}),
        });
        if (!Array.isArray(files)) throw new Error('Invalid listing');
      } catch {
        summary.failures += 1;
        break;
      }

      for (const listed of files) {
        summary.listed += 1;
        const scope = parsePrivateGroupFilePath(listed?.name);
        if (!scope || !PRIVATE_KINDS.has(scope.kind) || !scope.path.startsWith(prefix)) continue;
        summary.matched += 1;
        try {
          // The raw metadata preserves generation precision that File.generation can lose.
          // Refresh this exact version, including noncurrent objects, before applying CAS.
          const generation = generationPrecondition(listed?.metadata?.generation);
          const selector = { generation };
          const file = bucket.file(scope.path);
          const [metadata] = await file.getMetadata(selector);
          const custom = readCustomMetadata(metadata);
          if (generationPrecondition(metadata.generation) !== generation) {
            throw new Error('Object generation does not match the listing');
          }
          if (!Object.hasOwn(custom, TOKEN_KEY)) continue;
          summary.candidates += 1;
          const conditions = {
            generation, ifGenerationMatch: generation,
            ifMetagenerationMatch: generationPrecondition(metadata.metageneration),
          };
          if (apply) {
            // GCS PATCH removes a metadata key when its value is null.
            // These preconditions are flat options on File#setMetadata.
            await file.setMetadata({ metadata: { ...custom, [TOKEN_KEY]: null } }, conditions);
            // A successful PATCH is insufficient if the storage backend retains bearer tokens.
            const [current] = await file.getMetadata(selector);
            const remaining = readCustomMetadata(current);
            if (generationPrecondition(current.generation) !== conditions.ifGenerationMatch
              || Object.hasOwn(remaining, TOKEN_KEY)) {
              throw new Error('Token removal could not be verified');
            }
            summary.revoked += 1;
          }
        } catch (error) {
          if (Number(error?.code) === 412) summary.conflicts += 1;
          else summary.failures += 1;
        }
      }

      if (!nextQuery) break;
      pageToken = nextQuery.pageToken;
      if (typeof pageToken !== 'string' || !pageToken || seenTokens.has(pageToken)) {
        summary.failures += 1;
        break;
      }
      seenTokens.add(pageToken);
    } while (pageToken);
  }

  // Only aggregate counts leave this module. Storage errors can contain bearer URLs.
  return summary;
}

module.exports = { getAdminBucket, revokePrivateGroupFileTokens };

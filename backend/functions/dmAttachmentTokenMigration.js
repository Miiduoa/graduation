const { createHash } = require('node:crypto');

// The only legacy DM attachment layouts. Never mutate arbitrary bucket objects.
const DM_ATTACHMENT_PATH = /^conversations\/(?!\.{1,2}(?:\/|$))[A-Za-z0-9._-]{1,1500}\/(?:media|messages)\/(?!\.{1,2}(?:\/|$))[A-Za-z0-9._-]{1,1500}\/(?!\.{1,2}$)[A-Za-z0-9._-]{1,1500}$/;

function isDmAttachmentPath(name) {
  return typeof name === 'string' && DM_ATTACHMENT_PATH.test(name);
}
function tokenPresent(metadata) {
  const custom = metadata?.metadata;
  return custom != null && Object.hasOwn(custom, 'firebaseStorageDownloadTokens') &&
    custom.firebaseStorageDownloadTokens != null;
}
function anonymizePath(name) {
  return createHash('sha256').update(name).digest('hex').slice(0, 16);
}

/**
 * Review or revoke one old Firebase bearer token, without deleting its GCS object.
 * The precondition protects any concurrent update to GCS object metadata.
 * Manual deployment decision only; never invoked by delivery, CI or merging.
 * Legacy SDK access remains supported and may issue new download tokens.
 * No token values or signed URLs are returned.
 */
async function migrateDmToken(file, { execute = false } = {}) {
  if (!isDmAttachmentPath(file?.name)) return { status: 'skipped', id: anonymizePath(String(file?.name)) };
  const [before] = await file.getMetadata();
  const id = anonymizePath(file.name);
  if (!tokenPresent(before)) return { status: 'clean', id };
  if (!execute) return { status: 'would-revoke', id };
  const revision = Number(before.metageneration);
  if (!Number.isSafeInteger(revision) || revision < 1 || !before.generation) {
    throw new Error('GCS generation/metageneration missing; token was not modified');
  }
  await file.setMetadata(
    { metadata: { firebaseStorageDownloadTokens: null } },
    { ifMetagenerationMatch: revision },
  );
  const [after] = await file.getMetadata();
  if (tokenPresent(after) || after.generation !== before.generation) {
    throw new Error('GCS token revocation not verified; investigate without issuing a signed URL');
  }
  return { status: 'revoked', id };
}

/** Bounded, resumable-by-rerun scan. Defaults to 100 objects; never auto-runs mutations. */
async function scanDmTokens(bucket, { execute = false, maxObjects = 100, pageToken: startPageToken, onItem = () => {} } = {}) {
  if (!bucket?.getFiles || !Number.isSafeInteger(maxObjects) || maxObjects < 1 || maxObjects > 1000) {
    throw new Error('Invalid GCS bucket or maxObjects (1–1000)');
  }
  const summary = { scanned: 0, skipped: 0, clean: 0, wouldRevoke: 0, revoked: 0, truncated: false, nextPageToken: null };
  let pageToken = startPageToken;
  do {
    const query = { prefix: 'conversations/', autoPaginate: false, maxResults: Math.min(100, maxObjects - summary.scanned) };
    if (pageToken) query.pageToken = pageToken;
    const [files, next] = await bucket.getFiles(query);
    if (!Array.isArray(files) || files.length > query.maxResults) throw new Error('Invalid GCS page size');
    for (const file of files) {
      if (summary.scanned >= maxObjects) break;
      const result = await migrateDmToken(file, { execute });
      summary.scanned++;
      if (result.status === 'skipped') summary.skipped++;
      else if (result.status === 'clean') summary.clean++;
      else if (result.status === 'would-revoke') summary.wouldRevoke++;
      else if (result.status === 'revoked') summary.revoked++;
      onItem(result);
    }
    pageToken = next?.pageToken;
    if (summary.scanned >= maxObjects) {
      summary.truncated = Boolean(pageToken);
      summary.nextPageToken = pageToken || null;
      break;
    }
    if (!files.length && pageToken === query.pageToken) throw new Error('GCS listing cursor made no progress');
  } while (pageToken);
  return summary;
}

module.exports = { isDmAttachmentPath, tokenPresent, anonymizePath, migrateDmToken, scanDmTokens };

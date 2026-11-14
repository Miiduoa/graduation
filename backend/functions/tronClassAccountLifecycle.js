'use strict';

const { createHash, randomBytes } = require('node:crypto');

const PAGE_SIZE = 200;
const BINDINGS = '_tronClassBindings';
const LOGIN_ATTEMPTS = '_tronClassLoginAttempts';
const OPERATIONS = '_tronClassSubmissionOperations';
const LOCKS = '_tronClassSubmissionLocks';

function ownerHash(ownerKey) {
  if (
    typeof ownerKey !== 'string' || ownerKey.length > 200 ||
    !/^(?:platform:pa_[A-Za-z0-9_-]+|firebase:[^\s/]{1,128})$/.test(ownerKey) ||
    [...ownerKey].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
  ) throw new Error('Invalid TronClass owner');
  return createHash('sha256').update(ownerKey).digest('hex');
}

// Every new binding/operation write reads this document in its transaction.
// A permanent, credential-free marker closes the race with an already running
// login or upload. Deleting it (including by TTL) would reopen that race.
async function closeBinding(db, ownerKey, timestamp) {
  const hashedOwner = ownerHash(ownerKey);
  const reference = db.collection(BINDINGS).doc(hashedOwner);
  await db.runTransaction(async (transaction) => {
    const [snapshot] = await transaction.getAll(reference);
    const current = snapshot.data();
    if (snapshot.exists && current?.ownerKey !== ownerKey && current?.ownerHash !== hashedOwner)
      throw new Error('TronClass owner record mismatch');
    if (current?.state === 'closed' && current.ownerHash === hashedOwner) return;
    transaction.set(reference, {
      schoolId: 'pu', state: 'closed', ownerHash: hashedOwner,
      revision: randomBytes(16).toString('hex'), updatedAt: timestamp,
    });
  });
}

async function drainOwnedRecords(db, collection, ownerKey, visit) {
  // These are top-level exact-owner equality queries, with default single-field
  // indexes. Each page is drained instead of retaining a cursor over deleted data.
  const query = db.collection(collection).where('ownerKey', '==', ownerKey);
  while (true) {
    const page = await query.limit(PAGE_SIZE).get();
    if (page.empty) return;
    for (const document of page.docs) {
      await db.runTransaction(async (transaction) => {
        const [snapshot] = await transaction.getAll(document.ref);
        const current = snapshot.data();
        // A shared submission slot may have been acquired by another owner
        // between the query and this transaction. Never release their slot.
        if (!snapshot.exists || current?.ownerKey !== ownerKey) return;
        visit(transaction, document.ref, current);
      });
    }
  }
}

/**
 * Privileged lifecycle hook only; never expose ownerKey as an unauthenticated
 * request parameter. Firebase account deletion calls this after marking the
 * account closed. The external platform closure worker must invoke this same
 * hook with its independently verified platform account ID.
 */
async function closeTronClassOwner({ db, ownerKey, now = Date.now }) {
  ownerHash(ownerKey);
  const timestamp = Number(now());
  if (!Number.isSafeInteger(timestamp) || timestamp < 0)
    throw new Error('Invalid TronClass closure time');
  await closeBinding(db, ownerKey, timestamp);

  await drainOwnedRecords(db, LOCKS, ownerKey, (transaction, reference, current) => {
    if (current.state === 'not-sent') {
      // Only the durable pre-dispatch marker proves no submission started.
      transaction.delete(reference);
    } else {
      // A final request may still complete after account closure. Keep only the
      // opaque slot path and a blocking state, without identity, files, text,
      // receipt or a TTL. New owners of the same school account cannot resend.
      transaction.set(reference, { version: 1, state: 'owner-deleted', updatedAt: timestamp });
    }
  });
  await drainOwnedRecords(db, OPERATIONS, ownerKey, (transaction, reference) => {
    transaction.delete(reference);
  });
  await drainOwnedRecords(db, LOGIN_ATTEMPTS, ownerKey, (transaction, reference, current) => {
    if (current.scope === 'account') throw new Error('Invalid TronClass owner quota');
    transaction.delete(reference);
  });
  // Shared school-account login quotas deliberately survive until their short
  // purgeAt. Account deletion must not reset a cross-owner brute-force budget.
}

module.exports = { closeTronClassOwner };

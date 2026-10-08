const { FieldPath, FieldValue } = require('firebase-admin/firestore');
const { HttpsError } = require('firebase-functions/v2/https');
const { assertPrivacyRequestOwner } = require('./userDataExport');
const { releaseDeletedUserEventRegistration } = require('./eventRegistration');

const PAGE_SIZE = 200;
// Account closure removes access and private account data. These shared records
// have other owners and are deliberately outside this deletion contract.
const RETAINED_CATEGORIES = Object.freeze([
  'messages-and-public-posts',
  'coursework-and-reviews',
  'orders-transactions-and-audit-records',
  'legacy-event-registrations',
  'uploaded-files',
]);

function precondition(reason, message) {
  throw new HttpsError('failed-precondition', message, { reason });
}

function canonicalMembership(path, collection, uid) {
  const parts = path.split('/');
  if (parts.at(-1) !== uid || parts.at(-2) !== collection) return null;
  if (
    parts.length === 4 &&
    parts[0] === 'schools' &&
    ['members', 'directory', 'serviceRoles'].includes(collection)
  )
    return 'school';
  if (parts.length === 4 && parts[0] === 'groups' && collection === 'members') return 'group';
  if (
    parts.length === 6 &&
    parts[0] === 'schools' &&
    parts[2] === 'cafeterias' &&
    collection === 'operators'
  )
    return 'operator';
  return null;
}

// A collection-group document ID is a full path. An equality query with just
// uid is invalid, and many legacy memberships have no uid field to query.
async function scanPages(query, visit) {
  let cursor;
  while (true) {
    let page = query.orderBy(FieldPath.documentId()).limit(PAGE_SIZE);
    if (cursor) page = page.startAfter(cursor);
    const snapshot = await page.get();
    if (snapshot.empty) return;
    for (const doc of snapshot.docs) await visit(doc);
    cursor = snapshot.docs.at(-1);
  }
}

async function deleteQuery(db, collection, field, uid) {
  const query = db.collection(collection).where(field, '==', uid);
  while (true) {
    const snapshot = await query.limit(PAGE_SIZE).get();
    if (snapshot.empty) return;
    for (const doc of snapshot.docs) await db.recursiveDelete(doc.ref);
  }
}

function requireZeroBalance(data, fields) {
  for (const field of fields) {
    if (data?.[field] != null && (typeof data[field] !== 'number' || data[field] !== 0))
      precondition('financial-records', '帳號仍有餘額或待確認款項，請先完成處理。');
  }
}

async function checkFinancialRecords(db, userRef, uid) {
  const profile = await userRef.get();
  requireZeroBalance(profile.data(), ['balance']);
  const legacyWallet = await db.collection('wallets').doc(uid).get();
  requireZeroBalance(legacyWallet.data(), ['available', 'pending', 'balance']);
  const schools = await userRef.collection('schools').listDocuments();
  for (const school of schools) {
    await scanPages(school.collection('wallet'), async (doc) => {
      requireZeroBalance(doc.data(), ['available', 'pending', 'balance']);
    });
    await scanPages(school.collection('transactions'), async (doc) => {
      if (!['completed', 'failed', 'cancelled', 'refunded'].includes(doc.data().status))
        precondition('financial-records', '仍有待確認交易，請先完成處理。');
    });
  }
  for (const collection of ['transactions', 'ledgerEntries']) {
    await scanPages(db.collection(collection).where('userId', '==', uid), async (doc) => {
      if (!['completed', 'failed', 'cancelled', 'refunded'].includes(doc.data().status))
        precondition('financial-records', '仍有待確認交易，請先完成處理。');
    });
  }
  await scanPages(db.collectionGroup('orders').where('userId', '==', uid), async (doc) => {
    const order = doc.data();
    // The existing cancellation contract leaves unpaid onsite orders pending
    // in the payment field. It never captured funds; refunds are checked below.
    const cancelledUnpaidOnsite =
      order.status === 'cancelled' &&
      order.paymentMethod === 'onsite' &&
      order.paymentStatus === 'pending';
    if (
      !['completed', 'cancelled'].includes(order.status) ||
      (!cancelledUnpaidOnsite &&
        !['paid', 'completed', 'refunded', 'cancelled', 'failed'].includes(order.paymentStatus))
    )
      precondition('financial-records', '仍有未結束或付款狀態待確認的訂單，請先完成處理。');
  });
  for (const collection of ['refundRequests', 'refunds']) {
    await scanPages(db.collectionGroup(collection).where('userId', '==', uid), async (doc) => {
      if (!['completed', 'rejected', 'cancelled', 'refunded'].includes(doc.data().status))
        precondition('financial-records', '仍有待處理的退款，請先完成處理。');
    });
  }
}

async function clearPrivateSubtree(db, userRef) {
  for (const collection of await userRef.listCollections()) {
    if (collection.id !== 'schools') {
      await db.recursiveDelete(collection);
      continue;
    }
    for (const school of await collection.listDocuments()) {
      let keepsFinancialHistory = false;
      for (const child of await school.listCollections()) {
        if (['wallet', 'transactions', 'orders'].includes(child.id)) {
          keepsFinancialHistory = true;
        } else {
          await db.recursiveDelete(child);
        }
      }
      if (keepsFinancialHistory) await school.set({ accountClosed: true });
      else await school.delete();
    }
  }
}

function createDeleteUserAccountHandler({
  db,
  auth,
  now = () => Date.now(),
  releaseEventRegistration = releaseDeletedUserEventRegistration,
}) {
  return async (request) => {
    const uid = assertPrivacyRequestOwner(request);
    if (request.data?.confirmation !== 'DELETE_MY_ACCOUNT')
      throw new HttpsError('invalid-argument', '請確認刪除帳號。');
    const authTime = request.auth?.token?.auth_time;
    const currentTime = Number(now());
    const age = currentTime - authTime * 1000;
    if (
      typeof authTime !== 'number' ||
      !Number.isFinite(authTime) ||
      authTime <= 0 ||
      !Number.isFinite(age) ||
      age < 0 ||
      age > 10 * 60 * 1000
    ) {
      precondition('recent-login', '請重新登入後再刪除帳號。');
    }
    const userRef = db.collection('users').doc(uid);
    await checkFinancialRecords(db, userRef, uid);

    // Check responsibilities before removing anything. A retry also checks
    // current ownership, rather than trusting the state seen in a prior attempt.
    for (const collection of ['members', 'operators']) {
      await scanPages(db.collectionGroup(collection), async (doc) => {
        const kind = canonicalMembership(doc.ref.path, collection, uid);
        const active =
          kind === 'operator' ? doc.data().status !== 'inactive' : doc.data().status === 'active';
        if (!kind || !active || doc.data().role !== 'owner') return;
        if (kind === 'group') precondition('group-ownership', '請先轉移群組所有權，再刪除帳號。');
        if (kind === 'operator')
          precondition('merchant-ownership', '請先轉移店家管理權，再刪除帳號。');
      });
    }

    await userRef.set(
      { accountDeletionInProgress: true, notificationDeliveryDisabled: true },
      { merge: true },
    );

    // Remove school authority first so ordinary membership-checked writes stop.
    for (const collection of ['members', 'directory', 'serviceRoles', 'operators']) {
      await scanPages(db.collectionGroup(collection), async (doc) => {
        const kind = canonicalMembership(doc.ref.path, collection, uid);
        if (!kind) return;
        if (kind === 'school') {
          await db.recursiveDelete(doc.ref);
          return;
        }
        await db.runTransaction(async (transaction) => {
          const parentRef = doc.ref.parent.parent;
          const [parent, member] = await transaction.getAll(parentRef, doc.ref);
          if (!member.exists) return;
          const active =
            kind === 'operator'
              ? member.data().status !== 'inactive'
              : member.data().status === 'active';
          if (active && member.data().role === 'owner') {
            precondition(
              kind === 'group' ? 'group-ownership' : 'merchant-ownership',
              '管理權已變更，請先轉移所有權，再刪除帳號。',
            );
          }
          if (kind === 'group' && active && parent.exists) {
            const count = parent.data().memberCount;
            if (!Number.isSafeInteger(count) || count < 1)
              precondition('group-membership', '群組人數需要管理員確認，帳號尚未刪除。');
            transaction.update(parentRef, { memberCount: count - 1 });
          }
          if (kind === 'operator' && parent.exists) {
            const operators = await transaction.get(
              parentRef.collection('operators').where('status', '==', 'active'),
            );
            transaction.update(parentRef, {
              activeOperatorCount: operators.docs.filter((operator) => operator.id !== uid).length,
            });
          }
          transaction.delete(doc.ref);
        });
      });
    }

    // Only the controlled event contract can release a seat. Old registration
    // records are retained rather than guessing how their counters work.
    await scanPages(db.collectionGroup('registrations').where('userId', '==', uid), async (doc) => {
      if (!/^schools\/[^/]+\/clubEvents\/[^/]+\/registrations\/[^/]+$/.test(doc.ref.path)) return;
      if (!(await releaseEventRegistration({ db, registrationRef: doc.ref, uid }))) {
        precondition('event-registration', '活動報名需要主辦人確認，帳號尚未刪除。');
      }
    });

    for (const [collection, field] of [
      ['notifications', 'userId'],
      ['ssoLinks', 'firebaseUid'],
      ['pendingPushReceipts', 'uid'],
      ['pushReceiptResults', 'uid'],
      ['eventRegistrationRequests', 'userId'],
      ['_puSessions', 'ownerUid'],
      ['_puTronClassSessions', 'ownerUid'],
    ])
      await deleteQuery(db, collection, field, uid);

    // Financial history remains intact, including account-side mirrors. All
    // other private collections include orphaned/nested descendants in cleanup.
    await checkFinancialRecords(db, userRef, uid);
    await clearPrivateSubtree(db, userRef);

    // Replacement is intentional: unknown profile fields must not survive a
    // fixed-list redaction, and these two gates must remain after account closure.
    await userRef.set({
      status: 'deleted',
      accountDeletionInProgress: true,
      notificationDeliveryDisabled: true,
      deletedAt: FieldValue.serverTimestamp(),
    });

    // Leave Auth present after a failed cleanup, permitting a safe retry. An
    // already absent Auth record is the one idempotent exception, not a hidden failure.
    try {
      await auth.deleteUser(uid);
    } catch (error) {
      if (error?.code !== 'auth/user-not-found') throw error;
    }
    return { success: true, userId: uid, retainedCategories: [...RETAINED_CATEGORIES] };
  };
}

module.exports = { createDeleteUserAccountHandler, RETAINED_CATEGORIES };

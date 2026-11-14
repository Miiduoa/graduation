// Called only after accountDeletionInProgress is committed by account deletion.
// Exact school paths keep similarly named collections belonging to other features intact.
async function clearDormAccountData({ db, uid, scanPages }) {
  for (const collection of ['dormStaffRoles', 'dormSsoIdentities']) {
    await scanPages(db.collectionGroup(collection), async (doc) => {
      const parts = doc.ref.path.split('/');
      if (parts.length === 4 && parts[0] === 'schools' && parts[2] === collection && doc.id === uid)
        await db.recursiveDelete(doc.ref);
    });
  }
  for (const [collection, field] of [
    ['dormResidents', 'userId'],
    ['dormLeaves', 'userId'],
    ['dormRepairs', 'userId'],
    ['dormPackages', 'recipientId'],
  ]) {
    // Scan by document path so cleanup needs no new collection-group indexes.
    await scanPages(db.collectionGroup(collection), async (doc) => {
      const parts = doc.ref.path.split('/');
      if (
        parts.length !== 4 ||
        parts[0] !== 'schools' ||
        parts[2] !== collection ||
        doc.data()[field] !== uid
      )
        return;
      if (collection === 'dormPackages') {
        const mirror = doc.ref.parent.parent.collection('packages').doc(doc.id);
        await db.runTransaction(async (tx) => {
          const [snapshot] = await tx.getAll(mirror);
          if (snapshot.data()?.recipientId === uid) tx.delete(mirror);
        });
      }
      await db.recursiveDelete(doc.ref);
    });
  }
}
module.exports = { clearDormAccountData };

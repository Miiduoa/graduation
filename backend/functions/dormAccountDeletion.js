// Called only after accountDeletionInProgress is committed by account deletion.
// Exact school paths keep similarly named collections belonging to other features intact.
async function clearDormAccountData({
  db,
  uid,
  scanPages,
  getBucket = () => require('firebase-admin/storage').getStorage().bucket(),
}) {
  const deletePhoto = async (value) => {
    if (typeof value !== 'string') return;
    let path = value;
    if (!/^dorm-private\/[0-9a-f-]{36}$/.test(path)) {
      let url;
      try {
        url = new URL(value);
      } catch {
        return;
      }
      const prefix = '/v0/b/' + getBucket().name + '/o/';
      if (
        url.origin !== 'https://firebasestorage.googleapis.com' ||
        !url.pathname.startsWith(prefix)
      ) return;
      try {
        path = decodeURIComponent(url.pathname.slice(prefix.length));
      } catch {
        return;
      }
      if (!path.startsWith('temp/' + uid + '/dorm_')) return;
    }
    // Missing objects are safe on retry; other failures preserve the ownership document.
    await getBucket().file(path).delete({ ignoreNotFound: true });
  };
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
    ['dormPhotoUploads', 'userId'],
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
      if (collection === 'dormPhotoUploads') await deletePhoto(doc.data().path);
      if (collection === 'dormRepairs') {
        for (const image of doc.data().images || []) await deletePhoto(image);
      }
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

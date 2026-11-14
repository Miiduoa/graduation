const { HttpsError } = require('firebase-functions/v2/https');
const { FieldValue } = require('firebase-admin/firestore');

async function confirmPackagePickup({ db, schoolId, packageId, uid }) {
  const school = db.collection('schools').doc(schoolId);
  const packageRef = school.collection('packages').doc(packageId);
  const dormRef = school.collection('dormPackages').doc(packageId);
  await db.runTransaction(async (tx) => {
    const parcel = await tx.get(packageRef);
    if (!parcel.exists) throw new HttpsError('not-found', 'Package not found');
    if (parcel.data().recipientId !== uid)
      throw new HttpsError('permission-denied', 'This is not your package');
    const dorm = await tx.get(dormRef);
    if (dorm.exists && dorm.data().recipientId !== uid)
      throw new HttpsError('permission-denied', 'This is not your package');
    if (dorm.exists && (parcel.data().status === 'returned' || dorm.data().status === 'returned'))
      throw new HttpsError('failed-precondition', 'Package already returned');
    tx.update(packageRef, { status: 'picked_up', pickedUpAt: FieldValue.serverTimestamp() });
    if (dorm.exists)
      tx.update(dormRef, {
        status: 'picked_up',
        handledBy: uid,
        handledAt: FieldValue.serverTimestamp(),
      });
  });
  return { success: true };
}
module.exports = { confirmPackagePickup };

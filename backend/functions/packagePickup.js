const { HttpsError } = require('firebase-functions/v2/https');
const { FieldValue } = require('firebase-admin/firestore');

async function confirmPackagePickup({ db, schoolId, packageId, uid }) {
  const school = db.collection('schools').doc(schoolId);
  let packageRef;
  if (packageId.startsWith('dw_')) {
    const [legacy, privateParcels] = await Promise.all(
      ['packages', 'dormPackages'].map((name) =>
        school.collection(name).where('publicId', '==', packageId).limit(1).get(),
      ),
    );
    const match = privateParcels.docs[0] || legacy.docs[0];
    if (!match) throw new HttpsError('not-found', 'Package not found');
    packageRef = school.collection('packages').doc(match.id);
  } else packageRef = school.collection('packages').doc(packageId);
  const dormRef = school.collection('dormPackages').doc(packageRef.id);
  await db.runTransaction(async (tx) => {
    const parcel = await tx.get(packageRef);
    const dorm = await tx.get(dormRef);
    if (!parcel.exists && !dorm.exists) throw new HttpsError('not-found', 'Package not found');
    if (parcel.exists && parcel.data().recipientId !== uid)
      throw new HttpsError('permission-denied', 'This is not your package');
    if (dorm.exists && dorm.data().recipientId !== uid)
      throw new HttpsError('permission-denied', 'This is not your package');
    if (dorm.exists && (parcel.data()?.status === 'returned' || dorm.data().status === 'returned'))
      throw new HttpsError('failed-precondition', 'Package already returned');
    if (parcel.exists)
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

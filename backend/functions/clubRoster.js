const { HttpsError } = require('firebase-functions/v2/https');

// Existing clubs need no backfill: project only safe fields at read time.
function createClubRoster({ db }) {
  return async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', '請先登入');
    const { groupId, schoolId } = request.data || {};
    if (![groupId, schoolId].every((id) => typeof id === 'string' && /^[\w-]{1,160}$/.test(id)))
      throw new HttpsError('invalid-argument', '識別碼無效');
    return db.runTransaction(async (tx) => {
      const ref = db.collection('groups').doc(groupId);
      const [group, member, school] = await tx.getAll(
        ref,
        ref.collection('members').doc(uid),
        db.collection('schools').doc(schoolId).collection('members').doc(uid),
      );
      if (
        !group.exists ||
        group.data().type !== 'club' ||
        group.data().schoolId !== schoolId ||
        !member.exists ||
        member.data().status !== 'active' ||
        !school.exists ||
        school.data().status !== 'active'
      )
        throw new HttpsError('permission-denied', '無有效社團與學校身分');
      const members = await tx.get(ref.collection('members').where('status', '==', 'active'));
      const directories = members.empty
        ? []
        : await tx.getAll(
            ...members.docs.map((m) =>
              db.collection('schools').doc(schoolId).collection('directory').doc(m.id),
            ),
          );
      return {
        members: members.docs.map((m, i) => ({
          name:
            typeof directories[i]?.data()?.displayName === 'string'
              ? directories[i].data().displayName
              : typeof m.data().displayName === 'string'
                ? m.data().displayName
                : '未提供姓名',
          role: ['owner', 'admin', 'instructor', 'moderator'].includes(m.data().role)
            ? m.data().role
            : 'member',
        })),
      };
    });
  };
}
module.exports = { createClubRoster };

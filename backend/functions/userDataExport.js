const { HttpsError } = require('firebase-functions/v2/https');

const EXPORT_CATEGORIES = new Set([
  'profile',
  'schoolRecords',
  'favorites',
  'groups',
  'assignments',
  'registrations',
  'messages',
  'notifications',
  'lostfound',
]);

function assertPrivacyRequestOwner(request) {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', '請先登入。');
  if (request.data?.expectedUserId !== uid) {
    throw new HttpsError('failed-precondition', '帳號已變更，請重新開啟此頁。');
  }
  return uid;
}

function createExportUserDataHandler({ db, resolveUserSchoolId, now = () => new Date() }) {
  return async (request) => {
    const uid = assertPrivacyRequestOwner(request);
    const requested = request.data?.categories;
    if (
      !Array.isArray(requested) ||
      requested.length === 0 ||
      requested.some((category) => !EXPORT_CATEGORIES.has(category))
    ) {
      throw new HttpsError('invalid-argument', '請選擇有效的資料類別。');
    }
    const categories = new Set(requested);
    const schoolId = await resolveUserSchoolId(uid, request.data?.schoolId || null);
    if (
      schoolId !== null &&
      (typeof schoolId !== 'string' || !schoolId || schoolId.includes('/'))
    ) {
      throw new HttpsError('invalid-argument', '學校資料無效。');
    }
    if (!schoolId && (categories.has('schoolRecords') || categories.has('lostfound'))) {
      throw new HttpsError('failed-precondition', '請先選擇學校。');
    }
    const user = db.collection('users').doc(uid);
    const school = schoolId ? user.collection('schools').doc(schoolId) : null;
    const coverage = {
      scope: 'selected-categories',
      categories: [...categories],
      truncated: false,
      truncatedSections: [],
      // Account-level sources can contain historical records from other schools.
      schoolScopedSections: ['schoolScoped', 'lostFound', 'conversations'],
      sections: {},
    };
    const result = { exportedAt: now().toISOString(), schoolId, userId: uid, coverage };
    const rows = (snapshot) => snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id }));
    const read = async (query, section, limit = 200) => {
      const snapshot = await query.limit(limit + 1).get();
      const truncated = snapshot.docs.length > limit;
      coverage.sections[section] = {
        count: Math.min(snapshot.docs.length, limit),
        limit,
        truncated,
      };
      if (truncated) {
        coverage.truncated = true;
        coverage.truncatedSections.push(section);
      }
      return { docs: snapshot.docs.slice(0, limit) };
    };
    const document = async (reference) => {
      const snapshot = await reference.get();
      return snapshot.exists ? snapshot.data() : null;
    };

    if (categories.has('profile')) {
      const profile = await document(user);
      result.profile = profile ? { ...profile, id: uid } : null;
    }
    if (categories.has('schoolRecords')) {
      result.schoolScoped = { context: await document(school) };
      for (const name of [
        'enrollments',
        'grades',
        'calendarEvents',
        'libraryLoans',
        'seatReservations',
        'orders',
        'transactions',
        'achievements',
        'dailyBriefs',
        'weeklyReports',
      ]) {
        result.schoolScoped[name] = rows(
          await read(school.collection(name), `schoolScoped.${name}`),
        );
      }
      result.schoolScoped.wallet = await document(school.collection('wallet').doc('balance'));
    }
    if (categories.has('favorites')) {
      // Preserve both sources instead of silently dropping legacy records when scoped ones exist.
      result.favorites = rows(await read(user.collection('favorites'), 'favorites'));
      result.schoolFavorites = school
        ? rows(await read(school.collection('favorites'), 'schoolFavorites'))
        : [];
    }
    if (categories.has('groups')) {
      result.groups = rows(await read(user.collection('groups'), 'groups'));
      const posts = await read(db.collectionGroup('posts').where('authorId', '==', uid), 'posts');
      result.posts = posts.docs.map((doc) => ({
        ...doc.data(),
        id: doc.id,
        groupId: doc.ref.parent.parent?.id || null,
      }));
    }
    if (categories.has('assignments')) {
      const submissions = new Map();
      for (const field of ['studentId', 'userId']) {
        const snapshot = await read(
          db.collectionGroup('submissions').where(field, '==', uid),
          `submissions.${field}`,
        );
        for (const doc of snapshot.docs)
          submissions.set(doc.ref.path, { ...doc.data(), id: doc.id });
      }
      result.submissions = [...submissions.values()];
    }
    if (categories.has('registrations')) {
      result.registrations = rows(
        await read(db.collectionGroup('registrations').where('userId', '==', uid), 'registrations'),
      );
    }
    if (categories.has('messages')) {
      const conversations = await read(
        db.collection('conversations').where('memberIds', 'array-contains', uid),
        'conversations',
        50,
      );
      result.conversations = [];
      for (const doc of conversations.docs) {
        const data = doc.data();
        if (schoolId && data.schoolId && data.schoolId !== schoolId) continue;
        const messages = await read(
          doc.ref.collection('messages').orderBy('createdAt', 'asc'),
          `conversations.${doc.id}.messages`,
        );
        result.conversations.push({ ...data, id: doc.id, messages: rows(messages) });
      }
    }
    if (categories.has('notifications')) {
      result.notificationPreferences = await document(
        user.collection('settings').doc('notifications'),
      );
      result.pushTokens = rows(await read(user.collection('pushTokens'), 'pushTokens', 50));
      result.notifications = rows(
        await read(db.collection('notifications').where('userId', '==', uid), 'notifications', 100),
      );
    }
    if (categories.has('lostfound')) {
      result.lostFound = rows(
        await read(
          db.collection('schools').doc(schoolId).collection('lostFound').where('userId', '==', uid),
          'lostFound',
          100,
        ),
      );
    }
    return result;
  };
}

module.exports = { createExportUserDataHandler, assertPrivacyRequestOwner };

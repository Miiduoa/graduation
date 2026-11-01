const { HttpsError } = require('firebase-functions/v2/https');

function identifier(value) {
  if (typeof value !== 'string' || !/^[\w-]{1,160}$/.test(value))
    throw new HttpsError('invalid-argument', '識別碼無效');
  return value;
}
function csvCell(value) {
  const text = String(value ?? '');
  return `"${(/^[\s]*[=+@-]/.test(text) ? "'" : '') + text.replace(/"/g, '""')}"`;
}
function clubCsv(view) {
  return (
    '\ufeff' +
    [
      ['類別', '識別碼', '名稱', '角色', '學號', '電話', '報名人數', '簽到人數'],
      ...view.members.map((m) => ['社員', m.id, m.name, m.role, m.studentId, m.phone, '', '']),
      ...view.events.map((e) => ['活動', e.id, e.title, '', '', '', e.registered, e.checkedIn]),
    ]
      .map((row) => row.map(csvCell).join(','))
      .join('\r\n')
  );
}
function createClubAdmin({
  db,
  enabled = () => process.env.CLUB_ADMIN_ENABLED === 'true',
  pilotGroupId = process.env.CLUB_ADMIN_GROUP_ID,
  now = () => Date.now(),
}) {
  return async function clubAdmin(request) {
    if (!enabled()) throw new HttpsError('failed-precondition', '社團後台尚未啟用');
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', '請先登入');
    const input = request.data || {};
    const groupId = identifier(input.groupId);
    const schoolId = identifier(input.schoolId);
    if (!pilotGroupId) throw new HttpsError('failed-precondition', '尚未指定試辦社團');
    if (groupId !== pilotGroupId) throw new HttpsError('permission-denied', '此社團尚未開放試辦');
    const action = input.action || 'read';
    if (!['read', 'export', 'create', 'register', 'cancel', 'checkIn', 'role'].includes(action))
      throw new HttpsError('invalid-argument', '操作無效');
    return db.runTransaction(async (tx) => {
      const groupRef = db.collection('groups').doc(groupId);
      const [groupDoc, memberDoc, schoolDoc] = await tx.getAll(
        groupRef,
        groupRef.collection('members').doc(uid),
        db.collection('schools').doc(schoolId).collection('members').doc(uid),
      );
      const group = groupDoc.data();
      const member = memberDoc.data();
      if (
        !groupDoc.exists ||
        group.type !== 'club' ||
        group.schoolId !== schoolId ||
        !memberDoc.exists ||
        member.status !== 'active' ||
        !schoolDoc.exists ||
        schoolDoc.data().status !== 'active'
      )
        throw new HttpsError('permission-denied', '無有效社團與學校身分');
      const officer = ['owner', 'admin'].includes(member.role);
      if (['create', 'checkIn', 'export'].includes(action) && !officer)
        throw new HttpsError('permission-denied', '僅限會長或幹部');
      if (action === 'role') {
        if (member.role !== 'owner' || !['admin', 'member'].includes(input.role))
          throw new HttpsError('permission-denied', '僅會長可設定幹部');
        const targetRef = groupRef.collection('members').doc(identifier(input.targetUid));
        const target = await tx.get(targetRef);
        if (!target.exists || target.data().status !== 'active' || target.data().role === 'owner')
          throw new HttpsError('failed-precondition', '社員狀態不適用');
        const mirrorRef = db
          .collection('users')
          .doc(input.targetUid)
          .collection('groups')
          .doc(groupId);
        const previousMirror = await tx.get(mirrorRef);
        tx.update(targetRef, { role: input.role });
        tx.set(mirrorRef, {
          ...(previousMirror.data() || {}),
          groupId,
          schoolId,
          name: group.name || '',
          type: 'club',
          status: 'active',
          role: input.role,
          joinedAt: target.data().joinedAt || null,
        });
        return { success: true };
      }
      const eventsRef = groupRef.collection('clubEvents');
      if (action === 'create') {
        const eventId = identifier(input.eventId);
        const title = typeof input.title === 'string' ? input.title.trim() : '';
        const location = typeof input.location === 'string' ? input.location.trim() : '';
        if (
          !title ||
          title.length > 120 ||
          location.length > 200 ||
          !Number.isSafeInteger(input.startsAt) ||
          !Number.isSafeInteger(input.endsAt) ||
          input.startsAt <= now() ||
          input.endsAt <= input.startsAt
        )
          throw new HttpsError('invalid-argument', '請確認活動名稱與起訖時間');
        const ref = eventsRef.doc(eventId);
        const previous = await tx.get(ref);
        if (previous.exists) {
          const data = previous.data();
          if (
            data.createdBy !== uid ||
            data.title !== title ||
            data.location !== location ||
            data.startsAt !== input.startsAt ||
            data.endsAt !== input.endsAt
          )
            throw new HttpsError('already-exists', '活動識別碼已使用');
        } else {
          const existing = await tx.get(eventsRef.limit(100));
          if (existing.size >= 100)
            throw new HttpsError('resource-exhausted', '試辦上限為 100 場活動');
          tx.create(ref, {
            title,
            location,
            startsAt: input.startsAt,
            endsAt: input.endsAt,
            createdBy: uid,
          });
        }
        return { success: true };
      }
      if (['register', 'cancel', 'checkIn'].includes(action)) {
        const eventId = identifier(input.eventId);
        const targetUid = action === 'checkIn' ? identifier(input.targetUid) : uid;
        const ref = eventsRef.doc(eventId);
        const registrationRef = ref.collection('registrations').doc(targetUid);
        const [eventDoc, registration, target] = await tx.getAll(
          ref,
          registrationRef,
          groupRef.collection('members').doc(targetUid),
        );
        if (!eventDoc.exists || !target.exists || target.data().status !== 'active')
          throw new HttpsError('not-found', '活動或社員不存在');
        const event = eventDoc.data();
        const old = registration.data() || {};
        if (action === 'checkIn') {
          if (now() < event.startsAt || now() > event.endsAt || old.status !== 'registered')
            throw new HttpsError('failed-precondition', '僅活動期間可為已報名社員簽到');
          if (!old.checkedInAt)
            tx.update(registrationRef, { checkedInAt: now(), checkedInBy: uid });
        } else {
          if (now() >= event.startsAt || old.checkedInAt)
            throw new HttpsError('failed-precondition', '活動開始後不可變更報名');
          tx.set(registrationRef, {
            status: action === 'register' ? 'registered' : 'cancelled',
            checkedInAt: null,
          });
        }
        return { success: true };
      }
      const members = await tx.get(
        groupRef.collection('members').where('status', '==', 'active').limit(501),
      );
      const events = await tx.get(eventsRef.limit(101));
      if (members.size > 500 || events.size > 100)
        throw new HttpsError('resource-exhausted', '試辦上限為 500 位社員及 100 場活動');
      const directories = members.docs.length
        ? await tx.getAll(
            ...members.docs.map((doc) =>
              db.collection('schools').doc(schoolId).collection('directory').doc(doc.id),
            ),
          )
        : [];
      const profiles =
        officer && members.docs.length
          ? await tx.getAll(...members.docs.map((doc) => db.collection('users').doc(doc.id)))
          : [];
      const roster = members.docs.map((doc, index) => {
        const data = doc.data();
        const directory = directories[index]?.data() || {};
        const profile = profiles[index]?.data() || {};
        const privateProfile = profile.schoolId === schoolId ? profile : {};
        return {
          id: officer ? doc.id : `member-${index}`,
          name:
            typeof directory.displayName === 'string'
              ? directory.displayName
              : typeof data.displayName === 'string'
                ? data.displayName
                : '未提供姓名',
          role: data.role === 'owner' ? '會長' : data.role === 'admin' ? '幹部' : '社員',
          ...(officer
            ? {
                studentId: data.studentId || privateProfile.studentId || '',
                phone: data.phone || privateProfile.phone || '',
              }
            : {}),
        };
      });
      const active = new Set(members.docs.map((m) => m.id));
      const rows = [];
      for (const doc of events.docs) {
        const records = await tx.get(doc.ref.collection('registrations').limit(1001));
        if (records.size > 1000) throw new HttpsError('resource-exhausted', '報名資料超過試辦上限');
        const registered = records.docs.filter(
          (r) => active.has(r.id) && r.data().status === 'registered',
        );
        const data = doc.data();
        const mine = records.docs.find((r) => r.id === uid)?.data();
        rows.push({
          id: doc.id,
          title: data.title,
          location: data.location,
          startsAt: data.startsAt,
          endsAt: data.endsAt,
          registered: registered.length,
          checkedIn: registered.filter((r) => Boolean(r.data().checkedInAt)).length,
          mine: mine?.status === 'registered',
          myCheckIn: Boolean(mine?.checkedInAt),
          ...(officer
            ? {
                registrations: registered.map((r) => ({
                  uid: r.id,
                  checkedIn: Boolean(r.data().checkedInAt),
                })),
              }
            : {}),
        });
      }
      rows.sort((a, b) => a.startsAt - b.startsAt || a.id.localeCompare(b.id));
      roster.sort((a, b) => a.id.localeCompare(b.id));
      const view = { success: true, role: member.role, members: roster, events: rows };
      return action === 'export' ? { ...view, csv: clubCsv(view) } : view;
    });
  };
}
module.exports = { createClubAdmin, clubCsv };

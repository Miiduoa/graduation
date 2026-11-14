const { HttpsError } = require('firebase-functions/v2/https');
const { FieldValue } = require('firebase-admin/firestore');
const { createAuthzHelpers } = require('./authz');
const LABELS = {
  sent: '已送給輔導員',
  received: '輔導員已收到',
  scheduled: '已安排維修',
  fixed: '已修好，請確認',
  closed: '已結案',
};
function required(value, max = 1000) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max)
    throw new HttpsError('invalid-argument', '請檢查必填欄位及長度');
  return value.trim();
}
function transition(current, next, student) {
  return student
    ? (['fixed', 'closed'].includes(current) && next === 'sent') ||
        (current === 'fixed' && next === 'closed')
    : { sent: 'received', received: 'scheduled', scheduled: 'fixed' }[current] === next;
}
function serialize(row) {
  return JSON.parse(
    JSON.stringify(row, (_k, v) => (v && typeof v.toMillis === 'function' ? v.toMillis() : v)),
  );
}
function createDormWorkflowHandler({ db, sendPushToUser }) {
  const authz = createAuthzHelpers(db);
  return async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', '請先登入');
    const input = request.data || {};
    const schoolId = required(input.schoolId, 100);
    if (!/^[a-zA-Z0-9_-]+$/.test(schoolId))
      throw new HttpsError('invalid-argument', '學校代碼錯誤');
    const membership = await authz.assertActiveSchoolMember(schoolId, uid);
    const school = db.collection('schools').doc(schoolId);
    const [schoolDoc, rolesDoc, dormRolesDoc] = await Promise.all([
      school.get(),
      school.collection('serviceRoles').doc(uid).get(),
      school.collection('dormStaffRoles').doc(uid).get(),
    ]);
    const roles = dormRolesDoc.exists ? dormRolesDoc.data() : rolesDoc.data() || {};
    const admin = membership.role === 'admin';
    const repairs = admin || (roles.status === 'active' && roles.repairs === true);
    const packages = admin || (roles.status === 'active' && roles.packages === true);
    const enabled = schoolDoc.data()?.dormWorkflowEnabled === true;
    if (input.action === 'config')
      return {
        enabled,
        repairs,
        packages,
        admin,
        role: repairs || packages ? 'dorm_staff' : 'student',
      };
    if (!enabled && input.action !== 'mine')
      throw new HttpsError('failed-precondition', '這所學校尚未開通宿舍工作流程');
    const action = input.action;
    const staff = (domain) => {
      if (!(domain === 'packages' ? packages : repairs))
        throw new HttpsError('permission-denied', '需要宿舍服務權限');
    };
    const canAccessBuilding = (row) =>
      admin ||
      !Array.isArray(roles.buildings) ||
      !roles.buildings.length ||
      roles.buildings.includes(row.building || row.dormitory);
    const inBuilding = (row) => {
      if (!canAccessBuilding(row)) throw new HttpsError('permission-denied', '不屬於值班棟別');
    };
    const list = async (name, own = false) => {
      let q = school.collection(name);
      if (own) q = q.where('userId', '==', uid);
      const snap = await q.get();
      return snap.docs
        .map((d) => ({ id: d.id, ...serialize(d.data()) }))
        .filter((row) => name !== 'dormResidents' || row.active !== false)
        .filter(
          (row) =>
            own ||
            admin ||
            !Array.isArray(roles.buildings) ||
            !roles.buildings.length ||
            roles.buildings.includes(row.building || row.dormitory),
        );
    };
    if (action === 'mine') {
      const roster = await school.collection('dormResidents').where('userId', '==', uid).get();
      const buildings = new Set(
        roster.docs.filter((d) => d.data().active !== false).map((d) => d.data().building),
      );
      const announcements = [];
      for (const building of buildings) {
        const snap = await school
          .collection('dormAnnouncements')
          .where('building', '==', building)
          .get();
        announcements.push(...snap.docs.map((d) => ({ id: d.id, ...serialize(d.data()) })));
      }
      return {
        leaves: await list('dormLeaves', true),
        repairs: (await list('dormRepairs', true)).filter((r) => r.workflow === 'dorm_staff'),
        announcements,
      };
    }
    if (action === 'setStaff') {
      const target = required(input.targetUid, 160);
      if (
        !Array.isArray(input.buildings) ||
        input.buildings.some((b) => typeof b !== 'string' || !b.trim() || b.length > 70)
      )
        throw new HttpsError('invalid-argument', '請檢查棟別');
      await db.runTransaction(async (tx) => {
        await authz.assertSchoolAdmin(schoolId, uid, tx);
        const memberRef = school.collection('members').doc(target),
          accountRef = db.collection('users').doc(target),
          serviceRef = school.collection('dormStaffRoles').doc(target);
        const [member, account, oldRoles] = await tx.getAll(memberRef, accountRef, serviceRef);
        if (!member.exists || (member.data().status && member.data().status !== 'active'))
          throw new HttpsError('permission-denied', '帳號不是本校啟用成員');
        if (
          !account.exists ||
          account.data()?.status === 'deleted' ||
          account.data()?.accountDeletionInProgress
        )
          throw new HttpsError('failed-precondition', '帳號已停用');
        const granting = input.packages === true || input.repairs === true;
        tx.set(
          serviceRef,
          {
            status: granting ? 'active' : oldRoles.data()?.status || 'inactive',
            packages: input.packages === true,
            repairs: input.repairs === true,
            staffSubtype: 'dorm_staff',
            buildings: input.buildings,
            updatedBy: uid,
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
        tx.create(school.collection('adminLogs').doc(), {
          action: 'dormStaffRole',
          targetUid: target,
          actorUid: uid,
          packages: input.packages === true,
          repairs: input.repairs === true,
          buildings: input.buildings,
          createdAt: FieldValue.serverTimestamp(),
        });
      });
      return { success: true };
    }
    if (action === 'announce') {
      staff('packages');
      const building = required(input.building, 70);
      inBuilding({ building });
      const title = required(input.title, 120),
        body = required(input.body, 2000);
      const residents = (await list('dormResidents')).filter((r) => r.building === building);
      const ref = await school
        .collection('dormAnnouncements')
        .add({ building, title, body, createdBy: uid, createdAt: FieldValue.serverTimestamp() });
      let delivered = 0;
      const recipients = [...new Set(residents.map((r) => r.userId))];
      for (let offset = 0; offset < recipients.length; offset += 20)
        await Promise.all(
          recipients.slice(offset, offset + 20).map(async (id) => {
            try {
              await sendPushToUser(
                id,
                { title, body },
                { type: 'announcement', schoolId, channel: 'dormitory' },
              );
              delivered++;
            } catch {
              /* announcement remains available */
            }
          }),
        );
      return { success: true, id: ref.id, delivered, recipients: residents.length };
    }
    if (action === 'workspace') {
      if (!repairs && !packages) staff('repairs');
      return {
        repairs: repairs
          ? (await list('dormRepairs')).filter((r) => r.workflow === 'dorm_staff')
          : [],
        leaves: repairs ? await list('dormLeaves') : [],
        packages: packages ? await list('dormPackages') : [],
        residents: packages ? await list('dormResidents') : [],
      };
    }
    const activeResidence = async (tx, userId) => {
      const roster = await tx.get(school.collection('dormResidents').where('userId', '==', userId));
      const active = roster.docs.map((d) => d.data()).filter((r) => r.active !== false);
      if (active.length !== 1)
        throw new HttpsError('failed-precondition', '請先向宿舍服務台確認啟用住宿名冊');
      return {
        building: required(active[0].building, 70),
        room: required(active[0].room, 50),
      };
    };
    if (action === 'submitRepair' || action === 'requestLeave') {
      const building = action === 'submitRepair' ? required(input.building, 70) : undefined,
        room = action === 'submitRepair' ? required(input.room, 50) : undefined;
      const key = required(input.key, 100);
      if (!/^[a-zA-Z0-9_-]+$/.test(key)) throw new HttpsError('invalid-argument', '重試代碼錯誤');
      let row;
      if (action === 'submitRepair') {
        const images = input.images || [];
        if (
          !Array.isArray(images) ||
          images.length > 3 ||
          images.some((x) => typeof x !== 'string' || x.length > 2048 || !/^https:\/\//.test(x))
        )
          throw new HttpsError('invalid-argument', '照片最多三張，請使用已上傳照片網址');
        row = {
          workflow: 'dorm_staff',
          userId: uid,
          dormitory: building,
          building,
          room,
          title: required(input.title, 90),
          description: required(input.description),
          category: required(input.category, 50),
          images,
          status: 'pending',
          dormStatus: 'sent',
          history: [{ status: 'sent', at: Date.now() }],
        };
      } else {
        const date = required(input.date, 10);
        if (
          !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
          !Number.isFinite(Date.parse(date + 'T00:00:00Z')) ||
          new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) !== date ||
          date < new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)
        )
          throw new HttpsError('invalid-argument', '請選擇今天或之後的有效日期');
        row = {
          userId: uid,
          building,
          room,
          date,
          reason: required(input.reason, 500),
          status: 'pending',
          history: [{ status: 'pending', at: Date.now() }],
        };
      }
      const ref = school
        .collection(action === 'submitRepair' ? 'dormRepairs' : 'dormLeaves')
        .doc(uid + '_' + key);
      await db.runTransaction(async (tx) => {
        const old = await tx.get(ref);
        if (!old.exists) {
          if (action === 'requestLeave') Object.assign(row, await activeResidence(tx, uid));
          tx.create(ref, { ...row, createdAt: FieldValue.serverTimestamp() });
        }
      });
      return { success: true, id: ref.id };
    }
    if (action === 'repairStatus' || action === 'repairDetails' || action === 'decideLeave') {
      const ref = school
        .collection(action !== 'decideLeave' ? 'dormRepairs' : 'dormLeaves')
        .doc(required(input.id, 200));
      let owner;
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw new HttpsError('not-found', '找不到紀錄');
        const row = snap.data();
        owner = row.userId;
        const next = input.status;
        if (action !== 'decideLeave') {
          if (action === 'repairDetails') {
            staff('repairs');
            inBuilding(row);
            if (row.workflow !== 'dorm_staff')
              throw new HttpsError('failed-precondition', '這是原有備忘');
            const patch = {};
            for (const field of ['schoolReference', 'vendor', 'expectedDate'])
              patch[field] =
                typeof input[field] === 'string' ? input[field].trim().slice(0, 120) : '';
            tx.update(ref, { ...patch, updatedAt: FieldValue.serverTimestamp() });
            return;
          }
          if (row.workflow !== 'dorm_staff')
            throw new HttpsError('failed-precondition', '這是原有備忘');
          const student = row.userId === uid;
          if (!student) {
            staff('repairs');
            inBuilding(row);
          }
          if (!transition(row.dormStatus, next, student))
            throw new HttpsError('failed-precondition', '狀態已更新，請重新整理');
          const patch = {
            dormStatus: next,
            status: {
              sent: 'pending',
              received: 'assigned',
              scheduled: 'in_progress',
              fixed: 'completed',
              closed: 'closed',
            }[next],
            history: [...(row.history || []), { status: next, at: Date.now() }],
            updatedAt: FieldValue.serverTimestamp(),
          };
          if (!student)
            for (const field of ['schoolReference', 'vendor', 'expectedDate'])
              patch[field] =
                typeof input[field] === 'string'
                  ? input[field].trim().slice(0, 120)
                  : row[field] || '';
          tx.update(ref, patch);
        } else {
          staff('repairs');
          inBuilding(row);
          const residence = await activeResidence(tx, row.userId);
          if (residence.building !== row.building || residence.room !== row.room)
            throw new HttpsError('failed-precondition', '住宿名冊已變更，請重新申請');
          if (row.status !== 'pending' || !['approved', 'rejected'].includes(next))
            throw new HttpsError('failed-precondition', '申請已審核');
          tx.update(ref, {
            status: next,
            reviewedBy: uid,
            history: [...row.history, { status: next, at: Date.now() }],
          });
        }
      });
      // A notification failure must not turn a committed transition into a failed action.
      try {
        await sendPushToUser(
          owner,
          {
            title:
              action === 'decideLeave'
                ? '外宿卡審核結果'
                : LABELS[input.status] || '維修安排已更新',
            body: '請開啟宿舍查看最新紀錄。',
          },
          { type: 'repair', schoolId, channel: 'dormitory' },
        );
      } catch {
        /* record remains authoritative */
      }
      return { success: true };
    }
    if (action === 'deactivateResident') {
      staff('packages');
      const ref = school.collection('dormResidents').doc(required(input.studentId, 50));
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw new HttpsError('not-found', '找不到住宿生');
        inBuilding(snap.data());
        tx.update(ref, { active: false, updatedBy: uid, updatedAt: FieldValue.serverTimestamp() });
      });
      return { success: true };
    }
    if (action === 'importResidents') {
      staff('packages');
      if (!Array.isArray(input.rows) || !input.rows.length || input.rows.length > 400)
        throw new HttpsError('invalid-argument', '每批 1–400 位住宿生');
      const rows = [];
      const studentIds = new Set();
      for (const r of input.rows) {
        const studentId = required(r.studentId, 50);
        if (!/^[a-zA-Z0-9_-]+$/.test(studentId))
          throw new HttpsError('invalid-argument', '學號格式錯誤');
        if (studentIds.has(studentId)) throw new HttpsError('invalid-argument', '名冊內學號重複');
        studentIds.add(studentId);
        const row = {
          studentId,
          building: required(r.building, 70),
          room: required(r.room, 50),
          bed: required(r.bed, 30),
        };
        inBuilding(row);
        // School membership studentId is maintained by verified school login;
        // users.studentId is client-editable and must never establish identity.
        const members = await school
          .collection('members')
          .where('studentId', '==', studentId)
          .get();
        const matches = [];
        for (const member of members.docs)
          if (await authz.getActiveSchoolMembership(schoolId, member.id)) matches.push(member);
        if (matches.length !== 1)
          throw new HttpsError(
            'failed-precondition',
            '學號需對應唯一的本校已啟用帳號，請先以校方 SSO 重新登入同步學號：' + studentId,
          );
        rows.push({
          ...row,
          active: true,
          userId: matches[0].id,
          name: matches[0].data().displayName || '',
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
      await db.runTransaction(async (tx) => {
        const refs = rows.map((row) => school.collection('dormResidents').doc(row.studentId));
        const existing = await tx.getAll(...refs);
        // Read every destination before writing so concurrent moves retry safely.
        existing.forEach((snap, index) => {
          if (!snap.exists) return;
          inBuilding(snap.data());
          if (!admin && snap.data().building !== rows[index].building)
            throw new HttpsError('permission-denied', '跨棟移轉需要學校管理員處理');
        });
        rows.forEach((row, index) => tx.set(refs[index], row));
      });
      return { success: true };
    }
    if (action === 'registerPackage') {
      staff('packages');
      const residentRef = school.collection('dormResidents').doc(required(input.studentId, 50));
      const packageKey = required(input.key, 100);
      if (!/^[a-zA-Z0-9_-]+$/.test(packageKey))
        throw new HttpsError('invalid-argument', '重試代碼錯誤');
      const ref = school.collection('dormPackages').doc(uid + '_' + packageKey);
      const description = required(input.description, 120);
      const location = required(input.location, 120);
      const parcel = await db.runTransaction(async (tx) => {
        const [old, resident] = await tx.getAll(ref, residentRef);
        if (old.exists) return null;
        if (!resident.exists || resident.data().active === false)
          throw new HttpsError('failed-precondition', '學號不在住宿生名單');
        const r = resident.data();
        inBuilding(r);
        const parcel = {
          recipientId: r.userId,
          studentId: r.studentId,
          building: r.building,
          description,
          location,
          status: 'waiting',
          arrivedAt: FieldValue.serverTimestamp(),
        };
        tx.create(ref, parcel);
        // Existing student feed contains only the legacy parcel fields.
        tx.create(school.collection('packages').doc(ref.id), {
          recipientId: parcel.recipientId,
          description: parcel.description,
          location: parcel.location,
          status: parcel.status,
          arrivedAt: parcel.arrivedAt,
        });
        return parcel;
      });
      if (!parcel) return { success: true, id: ref.id };
      try {
        await sendPushToUser(
          parcel.recipientId,
          { title: '包裹到了・' + parcel.location, body: '請出示學號及姓名領取。' },
          { type: 'package', schoolId, channel: 'dormitory' },
        );
      } catch {
        /* arrival remains visible */
      }
      return { success: true, id: ref.id };
    }
    if (action === 'collectPackages' || action === 'returnPackage') {
      staff('packages');
      const refs =
        action === 'returnPackage'
          ? [school.collection('dormPackages').doc(required(input.id, 200))]
          : (
              await school
                .collection('dormPackages')
                .where('studentId', '==', required(input.studentId, 50))
                .get()
            ).docs
              .filter((d) => d.data().status === 'waiting' && canAccessBuilding(d.data()))
              .map((d) => d.ref);
      await db.runTransaction(async (tx) => {
        const snaps = await Promise.all(refs.map((r) => tx.get(r)));
        for (const snap of snaps) {
          if (!snap.exists) continue;
          const row = snap.data();
          if (action === 'collectPackages' && row.status !== 'waiting') continue;
          inBuilding(row);
          if (/郵局|掛號|收發室/.test(row.location || '')) continue;
          if (row.status === 'waiting') {
            tx.update(snap.ref, {
              status: action === 'returnPackage' ? 'returned' : 'picked_up',
              handledBy: uid,
              handledAt: FieldValue.serverTimestamp(),
            });
            tx.update(school.collection('packages').doc(snap.id), {
              status: action === 'returnPackage' ? 'returned' : 'picked_up',
            });
          }
        }
      });
      return { success: true };
    }
    throw new HttpsError('invalid-argument', '未知操作');
  };
}
module.exports = { createDormWorkflowHandler, transition, LABELS };

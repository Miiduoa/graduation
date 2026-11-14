const { randomUUID } = require('node:crypto');
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
function createDormWorkflowHandler({
  db,
  sendPushToUser,
  getBucket = () => require('firebase-admin/storage').getStorage().bucket(),
}) {
  const authz = createAuthzHelpers(db);
  return async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', '請先登入');
    const input = request.data || {};
    const schoolId = required(input.schoolId, 100);
    if (!/^[a-zA-Z0-9_-]+$/.test(schoolId))
      throw new HttpsError('invalid-argument', '學校代碼錯誤');
    const school = db.collection('schools').doc(schoolId);
    const action = input.action;
    // Public handles never contain account IDs; legacy documents receive a lookup field lazily.
    const handles = new Map();
    const publicId = (name, id) => handles.get(name + '/' + id);
    const resolveRef = async (name, id) => {
      if (!id.startsWith('dw_')) return school.collection(name).doc(id);
      const matches = await school.collection(name).where('publicId', '==', id).limit(1).get();
      if (!matches.docs.length) throw new HttpsError('not-found', '找不到紀錄');
      return matches.docs[0].ref;
    };
    const ensureHandle = async (name, d) => {
      const handle = await db.runTransaction(async (tx) => {
        const current = await tx.get(d.ref);
        const value = current.data()?.publicId || 'dw_' + randomUUID();
        if (current.exists && !current.data().publicId) tx.update(d.ref, { publicId: value });
        return value;
      });
      handles.set(name + '/' + d.id, handle);
      return handle;
    };
    const residentRef = async (value) => resolveRef('dormResidents', required(value, 200));
    const ownRow = (row) => {
      const allowed = [
        'id',
        'title',
        'description',
        'dormitory',
        'building',
        'room',
        'category',
        'workflow',
        'status',
        'dormStatus',
        'schoolReference',
        'expectedDate',
        'date',
        'reason',
        'applicantName',
        'maskedStudentId',
        'createdAt',
        'updatedAt',
      ];
      return {
        ...Object.fromEntries(
          allowed.filter((key) => row[key] !== undefined).map((key) => [key, row[key]]),
        ),
        images: (row.images || []).map((_, i) => String(i)),
        history: (row.history || []).map(({ status, at }) => ({ status, at })),
      };
    };
    // Legacy recipient access is independent of school membership and workflow enablement.
    if (action === 'parcels') {
      const snap = await school.collection('packages').where('recipientId', '==', uid).get();
      const rows = [];
      const allowed = [
        'description',
        'sender',
        'item',
        'itemName',
        'courier',
        'carrier',
        'location',
        'status',
        'arrivedAt',
        'createdAt',
      ];
      for (const d of snap.docs) {
        const row = serialize(d.data());
        rows.push({
          id: await ensureHandle('packages', d),
          data: Object.fromEntries(
            allowed.filter((key) => row[key] !== undefined).map((key) => [key, row[key]]),
          ),
        });
      }
      return { rows };
    }
    const membership = await authz.assertActiveSchoolMember(schoolId, uid);
    const [schoolDoc, dormRolesDoc] = await Promise.all([
      school.get(),
      school.collection('dormStaffRoles').doc(uid).get(),
    ]);
    const roles = dormRolesDoc.data() || {};
    const scoped = Array.isArray(roles.buildings) && roles.buildings.length > 0;
    const admin = membership.role === 'admin';
    const repairs = admin || (scoped && roles.status === 'active' && roles.repairs === true);
    const packages = admin || (scoped && roles.status === 'active' && roles.packages === true);
    const enabled = schoolDoc.data()?.dormWorkflowEnabled === true;
    if (input.action === 'config')
      return {
        enabled,
        repairs,
        packages,
        admin,
        role: repairs || packages ? 'dorm_staff' : 'student',
      };
    if (!enabled && !['mine', 'parcels'].includes(input.action))
      throw new HttpsError('failed-precondition', '這所學校尚未開通宿舍工作流程');
    const staff = (domain) => {
      if (!(domain === 'packages' ? packages : repairs))
        throw new HttpsError('permission-denied', '需要宿舍服務權限');
    };
    const canAccessBuilding = (row) =>
      admin || (scoped && roles.buildings.includes(row.building || row.dormitory));
    const inBuilding = (row) => {
      if (!canAccessBuilding(row)) throw new HttpsError('permission-denied', '不屬於值班棟別');
    };
    if (action === 'uploadPhoto') {
      const contentType = required(input.contentType, 40);
      if (
        !['image/jpeg', 'image/png', 'image/webp'].includes(contentType) ||
        typeof input.base64 !== 'string' ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(input.base64) ||
        input.base64.length > 8 * 1024 * 1024
      )
        throw new HttpsError('invalid-argument', '請使用 6MB 以內的 JPG、PNG 或 WebP 照片');
      const bytes = Buffer.from(input.base64, 'base64');
      if (!bytes.length || bytes.length > 6 * 1024 * 1024)
        throw new HttpsError('invalid-argument', '照片過大');
      const photoId = randomUUID();
      const path = 'dorm-private/' + photoId;
      await getBucket().file(path).save(bytes, {
        resumable: false,
        metadata: {
          contentType,
        },
      });
      await db.runTransaction(async (tx) => {
        const account = await tx.get(db.collection('users').doc(uid));
        if (account.data()?.status === 'deleted' || account.data()?.accountDeletionInProgress)
          throw new HttpsError('failed-precondition', '帳號已停用');
        tx.create(school.collection('dormPhotoUploads').doc(photoId), {
          userId: uid,
          path,
          createdAt: FieldValue.serverTimestamp(),
        });
      });
      return { path };
    }
    if (action === 'repairPhoto') {
      const ticket = await (await resolveRef('dormRepairs', required(input.id, 200))).get();
      if (!ticket.exists) throw new HttpsError('not-found', '找不到工單');
      const row = ticket.data();
      if (row.userId !== uid) {
        staff('repairs');
        inBuilding(row);
      }
      if (row.workflow !== 'dorm_staff') throw new HttpsError('permission-denied', '不是宿舍工單');
      if (!Number.isInteger(input.index) || input.index < 0 || !row.images?.[input.index])
        throw new HttpsError('not-found', '找不到照片');
      const bucket = getBucket();
      let path = row.images[input.index];
      if (!/^dorm-private\/[0-9a-f-]{36}$/.test(path)) {
        // Read legacy Firebase URLs only from this bucket; never fetch arbitrary remote URLs.
        let url;
        try {
          url = new URL(path);
        } catch {
          throw new HttpsError('not-found', '照片格式錯誤');
        }
        const prefix = '/v0/b/' + bucket.name + '/o/';
        if (
          url.origin !== 'https://firebasestorage.googleapis.com' ||
          !url.pathname.startsWith(prefix)
        )
          throw new HttpsError('not-found', '照片來源錯誤');
        const oldPath = decodeURIComponent(url.pathname.slice(prefix.length));
        if (!oldPath.startsWith('temp/' + row.userId + '/dorm_'))
          throw new HttpsError('permission-denied', '照片不屬於工單');
        const source = bucket.file(oldPath);
        path = 'dorm-private/' + randomUUID();
        await source.copy(bucket.file(path));
        // Do not copy legacy public download tokens to the private object.
        await bucket
          .file(path)
          .setMetadata({ metadata: null, cacheControl: 'private, no-store, max-age=0' });
        await source.setMetadata({ metadata: { firebaseStorageDownloadTokens: null } });
        await db.runTransaction(async (tx) => {
          const current = await tx.get(ticket.ref);
          if (current.data()?.images?.[input.index] === row.images[input.index]) {
            const images = [...current.data().images];
            images[input.index] = path;
            tx.update(ticket.ref, { images });
          }
        });
      }
      const [url] = await bucket
        .file(path)
        .getSignedUrl({ action: 'read', expires: Date.now() + 60000 });
      return { url };
    }
    const list = async (name, own = false) => {
      let q = school.collection(name);
      if (own) q = q.where('userId', '==', uid);
      const snap = await q.get();
      return snap.docs
        .map((d) => ({ id: d.id, ...serialize(d.data()) }))
        .filter((row) => name !== 'dormResidents' || row.active !== false)
        .filter((row) => own || canAccessBuilding(row));
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
        announcements.push(
          ...snap.docs.map((d) => {
            const { building, title, body } = d.data();
            return { id: d.id, building, title, body };
          }),
        );
      }
      return {
        leaves: (await list('dormLeaves', true)).map(ownRow),
        repairs: (await list('dormRepairs', true))
          .filter((r) => r.workflow === 'dorm_staff')
          .map(ownRow),
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
      if ((input.packages === true || input.repairs === true) && !input.buildings.length)
        throw new HttpsError('invalid-argument', '請至少指定一個值班棟別');
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
      const nextCursors = {};
      const pageSize = 50;
      const page = async (name, statuses, time) => {
        const rows = [];
        // Separate streams avoid the Firestore `in` operand limit for multi-building staff.
        for (const building of admin ? [null] : [...new Set(roles.buildings)]) {
          const key = JSON.stringify([name, building]);
          const cursor = input.cursors?.[key];
          if (cursor === null) continue;
          let q = school.collection(name);
          if (building !== null) q = q.where('building', '==', building);
          if (statuses) q = q.where('status', 'in', statuses);
          if (name === 'dormRepairs') q = q.where('workflow', '==', 'dorm_staff');
          q = q.orderBy(time, 'desc').orderBy('__name__', 'desc');
          if (cursor !== undefined) {
            if (typeof cursor !== 'string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(cursor))
              throw new HttpsError('invalid-argument', '分頁代碼錯誤');
            const last = await (await resolveRef(name, cursor)).get();
            if (!last.exists || !canAccessBuilding(last.data()))
              throw new HttpsError('invalid-argument', '分頁已失效，請重新整理');
            q = q.startAfter(last);
          }
          const snap = await q.limit(pageSize + 1).get();
          const docs = snap.docs.slice(0, pageSize);
          for (const d of docs) await ensureHandle(name, d);
          nextCursors[key] = snap.docs.length > pageSize ? publicId(name, docs.at(-1).id) : null;
          rows.push(...docs.map((d) => ({ id: d.id, ...serialize(d.data()) })));
        }
        return rows.filter((row) => name !== 'dormResidents' || row.active !== false);
      };
      const result = {
        repairs: repairs
          ? await page(
              'dormRepairs',
              input.includeHistory === true
                ? ['pending', 'assigned', 'in_progress', 'completed', 'closed']
                : ['pending', 'assigned', 'in_progress', 'completed'],
              'createdAt',
            )
          : [],
        leaves: repairs
          ? await page(
              'dormLeaves',
              input.includeHistory === true ? ['pending', 'approved', 'rejected'] : ['pending'],
              'createdAt',
            )
          : [],
        packages: packages
          ? await page(
              'dormPackages',
              input.includeHistory === true ? ['waiting', 'picked_up', 'returned'] : ['waiting'],
              'arrivedAt',
            )
          : [],
        residents: packages ? await page('dormResidents', null, 'updatedAt') : [],
        nextCursors,
      };
      // Older applications resolve their applicant from the authorized building's roster too.
      const applicants = new Map();
      for (const row of result.leaves) {
        if (row.applicantName && row.maskedStudentId) continue;
        const applicantKey = JSON.stringify([row.userId, row.building]);
        if (!applicants.has(applicantKey)) {
          const roster = await school
            .collection('dormResidents')
            .where('userId', '==', row.userId)
            .where('building', '==', row.building)
            .limit(1)
            .get();
          applicants.set(
            applicantKey,
            roster.docs
              .map((d) => ({ studentId: d.id, ...d.data() }))
              .find((r) => r.building === row.building && canAccessBuilding(r)),
          );
        }
        const applicant = applicants.get(applicantKey);
        row.applicantName = applicant?.name || row.applicantName || '姓名待確認';
        row.maskedStudentId = applicant?.studentId
          ? '***' + applicant.studentId.slice(-3)
          : row.maskedStudentId || '待確認';
      }
      const fields = {
        repairs: [
          'title',
          'description',
          'dormitory',
          'building',
          'room',
          'category',
          'status',
          'dormStatus',
          'schoolReference',
          'vendor',
          'expectedDate',
          'images',
          'createdAt',
        ],
        leaves: [
          'building',
          'room',
          'date',
          'reason',
          'status',
          'applicantName',
          'maskedStudentId',
          'createdAt',
        ],
        packages: [
          'studentId',
          'building',
          'room',
          'description',
          'location',
          'status',
          'arrivedAt',
        ],
        residents: ['studentId', 'name', 'building', 'room', 'bed', 'active'],
      };
      const collections = {
        repairs: 'dormRepairs',
        leaves: 'dormLeaves',
        packages: 'dormPackages',
      };
      for (const [kind, allowed] of Object.entries(fields)) {
        result[kind] = result[kind].map((row) => ({
          id: publicId(kind === 'residents' ? 'dormResidents' : collections[kind], row.id),
          ...Object.fromEntries(
            allowed
              .filter((key) => row[key] !== undefined)
              .map((key) => [
                key,
                ['studentId', 'maskedStudentId'].includes(key)
                  ? '***' + String(row[key]).slice(-3)
                  : key === 'images'
                    ? (row.images || []).map((_, i) => String(i))
                    : row[key],
              ]),
          ),
          ...(['repairs', 'leaves'].includes(kind)
            ? { history: (row.history || []).map(({ status, at }) => ({ status, at })) }
            : {}),
        }));
      }
      return result;
    }

    const activeResidence = async (tx, userId) => {
      const roster = await tx.get(school.collection('dormResidents').where('userId', '==', userId));
      const active = roster.docs
        .map((d) => ({ studentId: d.id, ...d.data() }))
        .filter((r) => r.active !== false);
      if (active.length !== 1)
        throw new HttpsError('failed-precondition', '請先向宿舍服務台確認啟用住宿名冊');
      return {
        building: required(active[0].building, 70),
        room: required(active[0].room, 50),
        applicantName: active[0].name || '姓名待確認',
        maskedStudentId: '***' + String(active[0].studentId).slice(-3),
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
          images.some((x) => typeof x !== 'string' || !/^dorm-private\/[0-9a-f-]{36}$/.test(x))
        )
          throw new HttpsError('invalid-argument', '照片最多三張，請先上傳本人照片');
        for (const path of images) {
          const photo = await school.collection('dormPhotoUploads').doc(path.split('/')[1]).get();
          if (!photo.exists || photo.data().userId !== uid || photo.data().path !== path)
            throw new HttpsError('permission-denied', '照片不屬於本人');
        }
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
        const account = await tx.get(db.collection('users').doc(uid));
        if (account.data()?.status === 'deleted' || account.data()?.accountDeletionInProgress)
          throw new HttpsError('failed-precondition', '帳號已停用');
        const old = await tx.get(ref);
        if (!old.exists) {
          if (action === 'requestLeave') Object.assign(row, await activeResidence(tx, uid));
          tx.create(ref, { ...row, createdAt: FieldValue.serverTimestamp() });
        }
      });
      return { success: true, id: ref.id };
    }
    if (action === 'repairStatus' || action === 'repairDetails' || action === 'decideLeave') {
      const ref = await resolveRef(
        action !== 'decideLeave' ? 'dormRepairs' : 'dormLeaves',
        required(input.id, 200),
      );
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
      const ref = await residentRef(input.studentId);
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
        // Only the backend-only verified SSO mapping establishes roster identity.
        await require('./dormSsoIdentity').resolveDormSsoIdentity({ db, schoolId, studentId });
        const members = await school
          .collection('dormSsoIdentities')
          .where('studentId', '==', studentId)
          .get();
        const matches = [];
        for (const member of members.docs)
          if (await authz.getActiveSchoolMembership(schoolId, member.id)) matches.push(member);
        if (matches.length !== 1)
          throw new HttpsError(
            'failed-precondition',
            '學號需對應唯一的本校已啟用帳號，請先以校方 SSO 登入：' + studentId,
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
        const accounts = await tx.getAll(
          ...rows.map((row) => db.collection('users').doc(row.userId)),
        );
        if (
          accounts.some(
            (a) => a.data()?.status === 'deleted' || a.data()?.accountDeletionInProgress,
          )
        )
          throw new HttpsError('failed-precondition', '名冊包含已停用帳號');
        const existing = await tx.getAll(...refs);
        // Read every destination before writing so concurrent moves retry safely.
        existing.forEach((snap, index) => {
          if (!snap.exists) return;
          inBuilding(snap.data());
          if (!admin && snap.data().building !== rows[index].building)
            throw new HttpsError('permission-denied', '跨棟移轉需要學校管理員處理');
        });
        rows.forEach((row, index) =>
          tx.set(refs[index], {
            ...row,
            publicId: existing[index].data()?.publicId || 'dw_' + randomUUID(),
          }),
        );
      });
      return { success: true };
    }
    if (action === 'registerPackage') {
      staff('packages');
      const selectedResidentRef = await residentRef(input.studentId);
      const packageKey = required(input.key, 100);
      if (!/^[a-zA-Z0-9_-]+$/.test(packageKey))
        throw new HttpsError('invalid-argument', '重試代碼錯誤');
      const ref = school.collection('dormPackages').doc(randomUUID());
      const description = required(input.description, 120);
      const location = required(input.location, 120);
      const parcel = await db.runTransaction(async (tx) => {
        const duplicates = await tx.get(
          school
            .collection('dormPackages')
            .where('registeredBy', '==', uid)
            .where('requestKey', '==', packageKey)
            .limit(1),
        );
        if (duplicates.docs.length) {
          inBuilding(duplicates.docs[0].data());
          return { existingId: duplicates.docs[0].id };
        }
        const [old, resident] = await tx.getAll(ref, selectedResidentRef);
        if (old.exists) return { existingId: ref.id };
        if (!resident.exists || resident.data().active === false)
          throw new HttpsError('failed-precondition', '學號不在住宿生名單');
        const r = resident.data();
        const account = await tx.get(db.collection('users').doc(r.userId));
        if (account.data()?.status === 'deleted' || account.data()?.accountDeletionInProgress)
          throw new HttpsError('failed-precondition', '住宿生帳號已停用');
        inBuilding(r);
        const parcel = {
          registeredBy: uid,
          requestKey: packageKey,
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
      if (parcel.existingId) return { success: true, id: parcel.existingId };
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
          ? [await resolveRef('dormPackages', required(input.id, 200))]
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

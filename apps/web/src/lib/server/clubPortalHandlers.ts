import { FieldValue } from 'firebase-admin/firestore';
import { HttpsError } from './httpsError';
import type { CallableRequest, GroupFirestore } from './groupInviteHandlers';
import type { ClubListing, ClubPortalView } from '@campus/shared/src/clubPortal';

const record = (value: unknown): Record<string, any> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : {};
function text(value: unknown, max = 2000) {
  if (typeof value !== 'string' || value.length > max)
    throw new HttpsError('invalid-argument', '欄位格式不正確');
  return value.trim();
}
function id(value: unknown) {
  const result = text(value, 160);
  if (!/^[\w-]+$/.test(result)) throw new HttpsError('invalid-argument', '識別碼無效');
  return result;
}
function denied(message = '沒有社團管理權限'): never {
  throw new HttpsError('permission-denied', message);
}
function count(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0)
    throw new HttpsError('failed-precondition', '社員數需要校正，請聯絡管理員');
  return value as number;
}
function link(value: unknown, host: string) {
  const result = text(value, 500);
  if (result) {
    let url;
    try {
      url = new URL(result);
    } catch {
      throw new HttpsError('invalid-argument', '請填寫完整外連網址');
    }
    if (
      url.protocol !== 'https:' ||
      !(url.hostname === host || url.hostname.endsWith('.' + host)) ||
      url.username ||
      url.password
    )
      throw new HttpsError('invalid-argument', '外連網址不正確');
  }
  return result;
}
function safeLink(value: unknown, host: string) {
  try {
    return link(typeof value === 'string' ? value : '', host);
  } catch {
    return '';
  }
}
function listing(
  groupId: string,
  group: Record<string, any>,
  official: Record<string, any>,
): ClubListing {
  return {
    id: groupId,
    name: String(group.name || '未命名社團'),
    category: String(official.category || '未分類'),
    meetingTime: String(group.clubProfile?.meetingTime || '社課時間未提供'),
    recruiting: group.clubProfile?.recruiting === true,
    approval: String(official.status || 'unverified'),
    joinPolicy: group.clubProfile?.joinPolicy === 'review' ? 'review' : 'open',
  };
}

export function createClubPortal({
  db,
  now = Date.now,
}: {
  db: GroupFirestore;
  now?: () => number;
}) {
  return async (request: CallableRequest): Promise<ClubPortalView> => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', '請先登入');
    const input = record(request.data),
      schoolId = id(input.schoolId),
      action = input.action || 'directory';
    return db.runTransaction(async (tx) => {
      const school = db.collection('schools').doc(schoolId);
      const [seatDoc, userDoc, serviceDoc] = await tx.getAll(
        school.collection('members').doc(uid),
        db.collection('users').doc(uid),
        school.collection('serviceRoles').doc(uid),
      );
      const seat = seatDoc.data() || {},
        account = userDoc.data() || {},
        service = serviceDoc.data() || {};
      if (
        seat.status !== 'active' ||
        account.accountDeletionInProgress ||
        ['deleted', 'disabled', 'suspended', 'inactive'].includes(account.status)
      )
        denied('需要有效的本校學號身分');
      // Platform operators need an explicit school grant too; no cross-school superuser shortcut.
      const studentSuffix = String(
        seat.studentId || (account.schoolId === schoolId ? account.studentId : '') || '',
      ).slice(-4);
      const office =
        seat.role === 'admin' ||
        (seat.role === 'staff' && service.status === 'active' && service.clubs === true);
      const officialRef = school.collection('clubs');
      const bounded = async (query: any, maximum = 500) => {
        const snap = await tx.get(query.limit(maximum + 1));
        if (snap.size > maximum)
          throw new HttpsError('resource-exhausted', '資料超過單次讀取上限，請聯絡管理員');
        return snap.docs as any[];
      };
      if (action === 'directory' || action === 'office') {
        if (action === 'office' && !office) denied();
        if (action === 'office') {
          const groups = (
            await bounded(
              db.collection('groups').where('schoolId', '==', schoolId).where('type', '==', 'club'),
            )
          ).filter((g) => g.data().type === 'club');
          const approvals = groups.length
            ? await tx.getAll(...groups.map((g) => officialRef.doc(g.id)))
            : [];
          return {
            success: true,
            office,
            clubs: groups.map((g, index) => listing(g.id, g.data(), approvals[index].data() || {})),
          };
        }
        const entries = await bounded(officialRef.where('status', '==', 'approved'));
        const groups = entries.length
          ? await tx.getAll(...entries.map((entry) => db.collection('groups').doc(entry.id)))
          : [];
        return {
          success: true,
          office,
          clubs: entries.flatMap((entry, index) => {
            const group = groups[index].data();
            return group?.schoolId === schoolId && group.type === 'club'
              ? [listing(entry.id, group, entry.data())]
              : [];
          }),
        };
      }
      const groupId = id(input.groupId),
        groupRef = db.collection('groups').doc(groupId),
        memberRef = groupRef.collection('members').doc(uid),
        approvalRef = officialRef.doc(groupId),
        requestRef = groupRef.collection('joinRequests').doc(uid);
      const [groupDoc, memberDoc, approvalDoc, applicationDoc] = await tx.getAll(
        groupRef,
        memberRef,
        approvalRef,
        requestRef,
      );
      const group = groupDoc.data() || {},
        member = memberDoc.data() || {},
        official = approvalDoc.data() || {},
        application = applicationDoc.data() || {};
      if (!groupDoc.exists || group.type !== 'club' || group.schoolId !== schoolId)
        denied('找不到本校社團');
      const active = member.status === 'active',
        officer = active && ['owner', 'admin'].includes(member.role);
      const approved = official.status === 'approved';
      const mirror = (target: string, membership: Record<string, any>) =>
        tx.set(db.collection('users').doc(target).collection('groups').doc(groupId), {
          groupId,
          schoolId,
          name: group.name || '',
          type: 'club',
          joinCode: group.joinCode || null,
          ...membership,
        });
      if (action === 'leave') {
        if (active && member.role === 'owner')
          throw new HttpsError('failed-precondition', '社長請先完成擁有權轉讓再退出');
        if (active) {
          const membership = { ...member, status: 'left', leftAt: FieldValue.serverTimestamp() };
          tx.set(memberRef, membership);
          mirror(uid, membership);
          tx.update(groupRef, { memberCount: Math.max(0, count(group.memberCount) - 1) });
        }
        return { success: true, office, status: 'left' };
      }
      if (action === 'join') {
        if (!approved) denied('僅課外組核可的社團可使用學號入社；邀請碼加入仍可使用');
        if (active) return { success: true, office, status: 'active' };
        if (group.clubProfile?.joinPolicy === 'review') {
          if (application.status !== 'pending')
            tx.set(requestRef, {
              uid,
              status: 'pending',
              displayName: String(seat.displayName || account.displayName || '未提供姓名'),
              requestedAt: FieldValue.serverTimestamp(),
            });
          return { success: true, office, status: 'pending' };
        }
        const membership = {
          uid,
          status: 'active',
          role: 'member',
          joinedAt: FieldValue.serverTimestamp(),
        };
        tx.set(memberRef, membership);
        mirror(uid, membership);
        tx.update(groupRef, { memberCount: count(group.memberCount) + 1 });
        if (application.status === 'pending')
          tx.update(requestRef, {
            status: 'approved',
            reviewedAt: FieldValue.serverTimestamp(),
            reviewedBy: uid,
          });
        return { success: true, office, status: 'active' };
      }
      if (action === 'review') {
        if (!officer) denied();
        const targetUid = id(input.targetUid),
          targetRef = groupRef.collection('members').doc(targetUid),
          appRef = groupRef.collection('joinRequests').doc(targetUid);
        const [appDoc, targetDoc, targetSeat, targetAccount] = await tx.getAll(
          appRef,
          targetRef,
          school.collection('members').doc(targetUid),
          db.collection('users').doc(targetUid),
        );
        if (!['approved', 'declined'].includes(input.decision))
          throw new HttpsError('invalid-argument', '審核結果無效');
        if (appDoc.data()?.status !== 'pending')
          throw new HttpsError('failed-precondition', '申請已處理，請重新整理');
        const reason = text(input.reason || '', 200);
        if (input.decision === 'approved') {
          if (
            targetSeat.data()?.status !== 'active' ||
            targetAccount.data()?.accountDeletionInProgress ||
            ['deleted', 'disabled', 'suspended', 'inactive'].includes(targetAccount.data()?.status)
          )
            denied('申請人的學校身分已失效');
          if (targetDoc.data()?.status !== 'active') {
            const membership = {
              uid: targetUid,
              role: 'member',
              status: 'active',
              joinedAt: FieldValue.serverTimestamp(),
            };
            tx.set(targetRef, membership);
            mirror(targetUid, membership);
            tx.update(groupRef, { memberCount: count(group.memberCount) + 1 });
          }
        }
        tx.update(appRef, {
          status: input.decision,
          reason,
          reviewedBy: uid,
          reviewedAt: FieldValue.serverTimestamp(),
        });
        return { success: true, office };
      }
      if (action === 'confirmOfficer') {
        if (!office) denied();
        const targetUid = id(input.targetUid);
        const [target, targetSeat] = await tx.getAll(
          groupRef.collection('members').doc(targetUid),
          school.collection('members').doc(targetUid),
        );
        if (
          target.data()?.status !== 'active' ||
          !['owner', 'admin'].includes(target.data()?.role) ||
          targetSeat.data()?.status !== 'active' ||
          target.data()?.role !== input.role
        )
          throw new HttpsError('failed-precondition', '幹部資料已變更，請重新整理');
        tx.set(approvalRef.collection('officers').doc(targetUid), {
          role: target.data().role,
          confirmedBy: uid,
          confirmedAt: FieldValue.serverTimestamp(),
        });
        return { success: true, office };
      }
      if (action === 'official') {
        if (!office) denied();
        if (!['approved', 'suspended'].includes(input.status))
          throw new HttpsError('invalid-argument', '核可狀態無效');
        tx.set(approvalRef, {
          ...official,
          status: input.status,
          category: text(input.category, 80),
          confirmedBy: uid,
          confirmedAt: FieldValue.serverTimestamp(),
        });
        return { success: true, office };
      }
      if (action === 'profile') {
        if (!officer) denied();
        if (!['open', 'review'].includes(input.joinPolicy))
          throw new HttpsError('invalid-argument', '入社方式無效');
        const name = text(input.name, 120);
        if (!name) throw new HttpsError('invalid-argument', '請填社名');
        tx.update(groupRef, {
          name,
          description: text(input.description),
          clubProfile: {
            meetingTime: text(input.meetingTime, 200),
            recruiting: input.recruiting === true,
            joinPolicy: input.joinPolicy,
            instagram: link(input.instagram, 'instagram.com'),
            line: link(input.line, 'line.me'),
          },
        });
        return { success: true, office };
      }
      if (action === 'announcement') {
        if (!officer) denied();
        const postId = id(input.operationId),
          title = text(input.title, 120),
          body = text(input.body, 10000);
        if (!title || !body) throw new HttpsError('invalid-argument', '請填公告標題與內容');
        const ref = groupRef.collection('posts').doc(postId),
          prior = await tx.get(ref);
        if (prior.exists) {
          if (
            prior.data().authorId !== uid ||
            prior.data().title !== title ||
            prior.data().body !== body
          )
            throw new HttpsError('already-exists', '操作代碼已使用');
        } else
          tx.create(ref, {
            kind: 'announcement',
            title,
            body,
            topic: '討論',
            schoolId,
            authorId: uid,
            authorName: String(account.displayName || ''),
            createdAt: FieldValue.serverTimestamp(),
            likes: 0,
            likedBy: [],
            clientIntentId: postId,
          });
        return { success: true, office };
      }
      if (action === 'dues') {
        if (!officer) denied();
        const ref = groupRef.collection('members').doc(id(input.targetUid)),
          target = await tx.get(ref);
        if (target.data()?.status !== 'active')
          throw new HttpsError('failed-precondition', '社員已離社');
        tx.set(groupRef.collection('clubMemberRecords').doc(id(input.targetUid)), {
          duesPaid: input.duesPaid === true,
          updatedBy: uid,
          updatedAt: FieldValue.serverTimestamp(),
        });
        return { success: true, office };
      }
      const eventRef = groupRef.collection('clubEvents');
      // Older events use server aggregates until their next write initializes counters.
      // Aggregate queries return counts only, never the complete registration collection.
      const totals = async (ref: any, event: Record<string, any>) => {
        if (
          Number.isSafeInteger(event.registeredCount) &&
          event.registeredCount >= 0 &&
          Number.isSafeInteger(event.checkedInCount) &&
          event.checkedInCount >= 0
        )
          return { registeredCount: event.registeredCount, checkedInCount: event.checkedInCount };
        const query = ref.collection('registrations').where('status', '==', 'registered');
        const [registered, checkedIn] = await Promise.all([
          tx.get(query.count()),
          tx.get(query.where('checkedInAt', '>', 0).count()),
        ]);
        return { registeredCount: registered.data().count, checkedInCount: checkedIn.data().count };
      };
      if (action === 'createEvent') {
        if (!officer) denied();
        const title = text(input.title, 120),
          location = text(input.location, 200);
        const ref = eventRef.doc(id(input.operationId)),
          prior = await tx.get(ref);
        const payload = {
          title,
          location,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          registrationDeadline: input.registrationDeadline,
          cancellationDeadline: input.cancellationDeadline,
          capacity: input.capacity,
          visibility: input.visibility,
          createdBy: uid,
        };
        if (prior.exists) {
          if (Object.entries(payload).some(([key, value]) => prior.data()[key] !== value))
            throw new HttpsError('already-exists', '操作代碼已使用');
        } else {
          if (
            !title ||
            !location ||
            ![
              input.startsAt,
              input.endsAt,
              input.registrationDeadline,
              input.cancellationDeadline,
              input.capacity,
            ].every(Number.isSafeInteger) ||
            input.startsAt <= now() ||
            input.endsAt <= input.startsAt ||
            input.registrationDeadline > input.startsAt ||
            input.cancellationDeadline > input.startsAt ||
            input.registrationDeadline <= now() ||
            input.cancellationDeadline <= now() ||
            input.capacity < 1 ||
            input.capacity > 1000 ||
            !['members', 'public'].includes(input.visibility)
          )
            throw new HttpsError('invalid-argument', '請確認活動時間、截止時間、地點與名額');
          tx.create(ref, { ...payload, registeredCount: 0, checkedInCount: 0 });
        }
        return { success: true, office };
      }
      if (['register', 'cancel', 'checkIn'].includes(action)) {
        const ref = eventRef.doc(id(input.eventId)),
          eventDoc = await tx.get(ref),
          event = eventDoc.data();
        if (!eventDoc.exists) throw new HttpsError('not-found', '活動不存在');
        const summary = await totals(ref, event);
        let target = uid;
        if (action === 'checkIn') {
          if (!officer) denied();
          if (input.checkInCode) {
            const code = text(input.checkInCode, 500);
            const prefix = `nuni-club:${groupId}:${id(input.eventId)}:`;
            if (code.startsWith(prefix)) target = id(code.slice(prefix.length));
            else if (/^[A-Za-z0-9]{4}$/.test(code)) {
              const records = (
                await tx.get(
                  ref
                    .collection('registrations')
                    .where('status', '==', 'registered')
                    .where('studentSuffix', '==', code)
                    .limit(2),
                )
              ).docs as any[];
              const matches = records.filter(
                (r) => r.data().status === 'registered' && r.data().studentSuffix === code,
              );
              if (matches.length !== 1)
                throw new HttpsError(
                  'failed-precondition',
                  matches.length ? '學號後四碼重複，請改掃 QR' : '這位不在報名名單',
                );
              target = matches[0].id;
            } else throw new HttpsError('invalid-argument', '簽到碼不屬於這場活動');
          } else target = id(input.targetUid);
        }
        const regRef = ref.collection('registrations').doc(target),
          regDoc = await tx.get(regRef),
          old = regDoc.data() || {};
        if (action === 'checkIn') {
          if (!officer) denied();
          if (now() < event.startsAt || now() > event.endsAt)
            throw new HttpsError('failed-precondition', '僅活動期間可簽到');
          const [targetSeat, targetMember, targetDirectory, targetAccount] = await tx.getAll(
            school.collection('members').doc(target),
            groupRef.collection('members').doc(target),
            school.collection('directory').doc(target),
            db.collection('users').doc(target),
          );
          if (
            targetSeat.data()?.status !== 'active' ||
            targetAccount.data()?.accountDeletionInProgress ||
            ['deleted', 'disabled', 'suspended', 'inactive'].includes(
              targetAccount.data()?.status,
            ) ||
            (event.visibility !== 'public' && targetMember.data()?.status !== 'active')
          )
            denied('參加者身分已失效');
          if (old.status !== 'registered' && input.allowWalkIn !== true)
            throw new HttpsError('failed-precondition', '這位不在報名名單');
          if (old.status !== 'registered') {
            if (summary.registeredCount >= (event.capacity || 1000))
              throw new HttpsError('resource-exhausted', '名額已滿');
          }
          if (!old.checkedInAt) {
            tx.update(ref, {
              registeredCount: summary.registeredCount + (old.status === 'registered' ? 0 : 1),
              checkedInCount: summary.checkedInCount + 1,
            });
            tx.set(regRef, {
              ...old,
              status: 'registered',
              checkedInAt: now(),
              checkedInBy: uid,
              onSite: old.status !== 'registered',
              studentSuffix: String(
                targetSeat.data()?.studentId ||
                  (targetAccount.data()?.schoolId === schoolId
                    ? targetAccount.data()?.studentId
                    : '') ||
                  '',
              ).slice(-4),
            });
          }
          return {
            success: true,
            office,
            message: old.checkedInAt
              ? `已簽到 ${new Date(old.checkedInAt).toLocaleTimeString('zh-TW', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hour12: false })}`
              : `${String(targetDirectory.data()?.displayName || targetMember.data()?.displayName || targetSeat.data()?.displayName || '未提供姓名')} 已簽到`,
          };
        } else {
          if (!active && !(approved && event.visibility === 'public')) denied('此活動只限社員');
          if (action === 'register' && old.status === 'registered')
            return { success: true, office };
          if (
            now() >=
              (action === 'cancel'
                ? (event.cancellationDeadline ?? event.startsAt)
                : (event.registrationDeadline ?? event.startsAt)) ||
            old.checkedInAt
          )
            throw new HttpsError(
              'failed-precondition',
              action === 'cancel' ? '已過取消時間，請聯絡幹部' : '已過報名時間',
            );
          if (action === 'register') {
            if (summary.registeredCount >= (event.capacity || 1000))
              throw new HttpsError('resource-exhausted', '名額已滿');
          }
          tx.update(ref, {
            ...summary,
            registeredCount:
              summary.registeredCount +
              (action === 'register' ? 1 : old.status === 'registered' ? -1 : 0),
          });
          tx.set(regRef, {
            status: action === 'register' ? 'registered' : 'cancelled',
            checkedInAt: null,
            studentSuffix: studentSuffix,
          });
        }
        return { success: true, office };
      }
      if (action !== 'read') throw new HttpsError('invalid-argument', '操作無效');
      if (!active && !approved && !office) denied('此社團僅供社員閱讀');
      // Independent cursors keep large rosters/history from blocking the club page.
      const page = async (query: any, cursor: unknown, size: number) => {
        let ordered = query.orderBy('__name__');
        if (cursor !== undefined) ordered = ordered.startAfter(id(cursor));
        const docs = (await tx.get(ordered.limit(size + 1))).docs as any[];
        return {
          docs: docs.slice(0, size),
          next: docs.length > size ? docs[size - 1].id : undefined,
        };
      };
      const memberPage =
        officer || office
          ? await page(
              groupRef.collection('members').where('status', '==', 'active'),
              input.memberCursor,
              100,
            )
          : { docs: [], next: undefined };
      const members = memberPage.docs;
      const privateMembers =
        officer && members.length
          ? await tx.getAll(
              ...members.map((m) => groupRef.collection('clubMemberRecords').doc(m.id)),
            )
          : [];
      const officerMembers = members.filter((m) => ['owner', 'admin'].includes(m.data().role));
      const confirmations = officerMembers.length
        ? await tx.getAll(
            ...officerMembers.map((m) => approvalRef.collection('officers').doc(m.id)),
          )
        : [];
      const requestPage = officer
        ? await page(
            groupRef.collection('joinRequests').where('status', '==', 'pending'),
            input.requestCursor,
            100,
          )
        : { docs: [], next: undefined };
      const requests = requestPage.docs;
      const posts =
        active || office
          ? (
              await tx.get(
                (groupRef.collection('posts') as any).orderBy('createdAt', 'desc').limit(20),
              )
            ).docs
          : [];
      const rosterEvent =
        input.rosterEventId === undefined
          ? undefined
          : await tx.get(eventRef.doc(id(input.rosterEventId)));
      // Freeze the live/history boundary in the cursor so paging remains stable as time passes.
      type EventCursor = { phase: 'live' | 'history'; clock: number; end?: number; key?: string };
      let cursor: EventCursor = { phase: 'live', clock: now() };
      if (input.eventCursor !== undefined) {
        try {
          const value = JSON.parse(text(input.eventCursor, 500));
          if (
            !['live', 'history'].includes(value.phase) ||
            !Number.isSafeInteger(value.clock) ||
            !Number.isSafeInteger(value.end) ||
            typeof value.key !== 'string'
          )
            throw new Error();
          cursor = { phase: value.phase, clock: value.clock, end: value.end, key: id(value.key) };
        } catch {
          throw new HttpsError('invalid-argument', '活動分頁代碼無效');
        }
      }
      const canReadHistory = officer || office;
      const eventDocs: any[] = [];
      let nextEvent: string | undefined;
      if (!rosterEvent) {
        for (const phase of cursor.phase === 'live' && canReadHistory
          ? (['live', 'history'] as const)
          : [cursor.phase]) {
          if (phase === 'history' && !canReadHistory) break;
          let query: any = eventRef.where('endsAt', phase === 'live' ? '>=' : '<', cursor.clock);
          if (!active && !office) query = query.where('visibility', '==', 'public');
          query = query.orderBy('endsAt').orderBy('__name__');
          if (phase === cursor.phase && cursor.key)
            query = query.startAfter(cursor.end, cursor.key);
          const batch = (await tx.get(query.limit(21 - eventDocs.length))).docs as any[];
          eventDocs.push(...batch);
          if (eventDocs.length > 20) {
            const last = eventDocs[19];
            // The last displayed row can belong to the previous phase at the boundary.
            nextEvent = JSON.stringify({
              phase: last.data().endsAt >= cursor.clock ? 'live' : 'history',
              clock: cursor.clock,
              end: last.data().endsAt,
              key: last.id,
            });
            break;
          }
        }
      }
      const eventPage = rosterEvent
        ? { docs: rosterEvent.exists ? [rosterEvent] : [], next: undefined }
        : { docs: eventDocs.slice(0, 20), next: nextEvent };
      const events = eventPage.docs;
      const directories = members.length
        ? await tx.getAll(...members.map((m) => school.collection('directory').doc(m.id)))
        : [];
      const profiles =
        officer && members.length
          ? await tx.getAll(...members.map((m) => db.collection('users').doc(m.id)))
          : [];
      const rows: NonNullable<ClubPortalView['events']> = [];
      for (const doc of events) {
        const e = doc.data();
        if (!active && !office && e.visibility !== 'public') continue;
        const activeQuery = doc.ref.collection('registrations').where('status', '==', 'registered');
        const { registeredCount: registered, checkedInCount: checkedIn } = await totals(doc.ref, e);
        const mine = (await tx.get(doc.ref.collection('registrations').doc(uid))).data();
        const rosterPage =
          officer || office
            ? await page(
                activeQuery,
                input.rosterEventId === doc.id ? input.registrationCursor : undefined,
                100,
              )
            : { docs: [], next: undefined };
        // Resolve attendees independently of the current member page, including public guests.
        const attendeeNames = new Map<string, string>();
        if (officer || office) {
          for (let offset = 0; offset < rosterPage.docs.length; offset += 100) {
            const batch = rosterPage.docs.slice(offset, offset + 100);
            const names = await tx.getAll(
              ...batch.map((r) => school.collection('directory').doc(r.id)),
            );
            batch.forEach((r, index) =>
              attendeeNames.set(r.id, String(names[index].data()?.displayName || '未提供姓名')),
            );
          }
        }
        rows.push({
          id: doc.id,
          title: e.title,
          location: e.location || '',
          startsAt: e.startsAt,
          endsAt: e.endsAt,
          capacity: e.capacity || 1000,
          registrationDeadline: e.registrationDeadline ?? e.startsAt,
          cancellationDeadline: e.cancellationDeadline ?? e.startsAt,
          visibility: e.visibility || 'members',
          registered,
          checkedIn,
          mine: mine?.status === 'registered',
          myCheckIn: Boolean(mine?.checkedInAt),
          ...(mine?.status === 'registered'
            ? {
                myCheckInCode: `nuni-club:${groupId}:${doc.id}:${uid}`,
                studentSuffix: studentSuffix,
              }
            : {}),
          ...(officer || office
            ? {
                registrationCursor: rosterPage.next,
                registrations: rosterPage.docs.map((r) => ({
                  uid: r.id,
                  name: attendeeNames.get(r.id) || '未提供姓名',
                  checkedInAt: r.data().checkedInAt || null,
                })),
              }
            : {}),
        });
      }
      return {
        success: true,
        office,
        club: {
          ...listing(groupId, group, official),
          description: String(group.description || ''),
          instagram: safeLink(group.clubProfile?.instagram, 'instagram.com'),
          line: safeLink(group.clubProfile?.line, 'line.me'),
          memberCount: Number.isSafeInteger(group.memberCount) ? group.memberCount : null,
        },
        role: active ? member.role : 'visitor',
        status: active ? 'active' : application.status || 'none',
        reason: String(application.reason || ''),
        members: members.map((m, index) => ({
          id: m.id,
          name: String(
            directories[index]?.data()?.displayName || m.data().displayName || '未提供姓名',
          ),
          role: m.data().role,
          phone: officer
            ? String(
                m.data().phone ||
                  (profiles[index]?.data()?.schoolId === schoolId
                    ? profiles[index]?.data()?.phone
                    : '') ||
                  '',
              )
            : '',
          duesPaid: officer && privateMembers[index]?.data()?.duesPaid === true,
        })),
        officialOfficers: officerMembers.map((m, index) => ({
          id: m.id,
          role: m.data().role,
          status: confirmations[index].data()?.role === m.data().role ? 'confirmed' : 'pending',
        })),
        requests: requests.map((r) => ({
          id: r.id,
          name: String(r.data().displayName || '未提供姓名'),
        })),
        announcements: posts
          .filter((p: any) => p.data().kind === 'announcement')
          .sort(
            (a: any, b: any) =>
              (b.data().createdAt?.toMillis?.() || 0) - (a.data().createdAt?.toMillis?.() || 0),
          )
          .slice(0, 3)
          .map((p: any) => ({
            id: p.id,
            title: String(p.data().title || ''),
            body: String(p.data().body || ''),
          })),
        requestCursor: requestPage.next,
        memberCursor: memberPage.next,
        eventCursor: eventPage.next,
        events: rows,
      };
    });
  };
}

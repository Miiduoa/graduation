// @vitest-environment node
import { beforeEach, expect, test } from 'vitest';
import { clubRosterCsv } from '@campus/shared/src/clubExport';
import { createClubPortal } from './clubPortalHandlers';
import { createMemoryGroupStore } from './memoryGroupStore';
import { createGroupInviteHandlers } from './groupInviteHandlers';
let store: ReturnType<typeof createMemoryGroupStore>,
  run: ReturnType<typeof createClubPortal>,
  time: number;
let reads: { path: string; aggregate: boolean; size: number; maximum: number }[];
const call = (uid = 'student', data: Record<string, unknown> = {}) =>
  run({ auth: { uid }, data: { schoolId: 'school', groupId: 'club', action: 'read', ...data } });
beforeEach(() => {
  time = 1000;
  reads = [];
  store = createMemoryGroupStore([
    [
      'groups/club',
      { name: '攝影社', type: 'club', schoolId: 'school', memberCount: 1, joinCode: 'INVITE12' },
    ],
    ['schools/school/clubs/club', { status: 'approved', category: '學藝' }],
    ...['student', 'officer', 'staff', 'other'].map((uid): [string, Record<string, unknown>] => [
      `schools/school/members/${uid}`,
      {
        status: 'active',
        studentId: uid === 'student' ? 'S12345678' : 'S87654321',
        role: uid === 'staff' ? 'staff' : 'student',
      },
    ]),
    [
      'groups/club/members/officer',
      { status: 'active', role: 'owner', phone: 'private-phone', duesPaid: true },
    ],
    ['schools/school/serviceRoles/staff', { status: 'active', clubs: true }],
  ]);
  // Keep advanced Firestore query support local to this lane's tests.
  const wrap = (source: any, orders: string[] = [], after?: any[], aggregate = false): any =>
    new Proxy(source, {
      get(target, key) {
        if (key === 'collection') return (name: string) => wrap(target.collection(name));
        if (key === 'doc') return (name: string) => wrap(target.doc(name));
        if (key === 'where') return (...args: any[]) => wrap(target.where(...args), orders, after);
        if (key === 'orderBy')
          return (field: string) => wrap(target.orderBy(field), [...orders, field], after);
        if (key === 'startAfter') return (...values: any[]) => wrap(target, orders, values);
        if (key === 'limit') return (size: number) => wrap(target.limit(size), orders, after);
        if (key === 'count') return () => wrap(target, orders, after, true);
        if (key === 'clubQuery')
          return async () => {
            let rows = [...store.docs.entries()]
              .filter(
                ([path, data]) =>
                  path.startsWith(target.path + '/') &&
                  !path.slice(target.path.length + 1).includes('/') &&
                  target.filters.every((f: any) =>
                    f.op === '>='
                      ? (data[f.field] as number) >= f.value
                      : f.op === '<'
                        ? (data[f.field] as number) < f.value
                        : f.op === '>'
                          ? (data[f.field] as number) > f.value
                          : data[f.field] === f.value,
                  ),
              )
              .map(([path, data]) => ({
                id: path.split('/').pop()!,
                data: () => data,
                ref: wrap(store.db.doc(path)),
              }));
            const compare = (a: any[], b: any[]) => {
              for (let n = 0; n < a.length; n++) {
                if (a[n] < b[n]) return -1;
                if (a[n] > b[n]) return 1;
              }
              return 0;
            };
            const values = (row: any) =>
              orders.map((field) => (field === '__name__' ? row.id : row.data()[field]));
            rows.sort((a, b) => compare(values(a), values(b)));
            if (after) rows = rows.filter((row) => compare(values(row), after) > 0);
            if (aggregate) {
              reads.push({ path: target.path, aggregate: true, size: 0, maximum: target.maximum });
              return { data: () => ({ count: rows.length }) };
            }
            rows = rows.slice(0, target.maximum);
            reads.push({
              path: target.path,
              aggregate: false,
              size: rows.length,
              maximum: target.maximum,
            });
            return { docs: rows, size: rows.length, empty: !rows.length };
          };
        return target[key];
      },
    });
  const collection = store.db.collection.bind(store.db);
  store.db.collection = (name: string) => wrap(collection(name));
  const transaction = store.db.runTransaction.bind(store.db);
  store.db.runTransaction = (callback) =>
    transaction((tx: any) => {
      const get = tx.get.bind(tx);
      tx.get = async (query: any) => {
        if (query.filters) return query.clubQuery();
        const doc = await get(query);
        return { ...doc, ref: wrap(doc.ref) };
      };
      return callback(tx);
    });
  run = createClubPortal({ db: store.db, now: () => time });
});
test('開放一鍵加入與索引原子更新，重送不重複，退出重入', async () => {
  await call('student', { action: 'join' });
  await call('student', { action: 'join' });
  expect(store.docs.get('groups/club')?.memberCount).toBe(2);
  expect(store.docs.get('users/student/groups/club')).toMatchObject({
    role: 'member',
    status: 'active',
  });
  await createGroupInviteHandlers({ db: store.db }).leaveGroup({
    auth: { uid: 'student' },
    data: { groupId: 'club' },
  });
  expect(store.docs.get('groups/club')?.memberCount).toBe(1);
  await call('student', { action: 'join' });
  expect(store.docs.get('groups/club')?.memberCount).toBe(2);
});
test('交易失敗不回報成功、不留下半份會籍', async () => {
  store.failNextCommit();
  await expect(call('student', { action: 'join' })).rejects.toThrow();
  expect(store.docs.has('users/student/groups/club')).toBe(false);
  expect(store.docs.get('groups/club')?.memberCount).toBe(1);
});
test('待審與不通過理由僅本人讀取，通過重驗身分且不重複加人', async () => {
  store.docs.get('groups/club')!.clubProfile = { joinPolicy: 'review' };
  expect((await call('student', { action: 'join' })).status).toBe('pending');
  expect(store.docs.has('groups/club/members/student')).toBe(false);
  expect((await call('other')).requests).toEqual([]);
  await call('officer', {
    action: 'review',
    targetUid: 'student',
    decision: 'declined',
    reason: '請先面試',
  });
  expect((await call()).reason).toBe('請先面試');
  await call('student', { action: 'join' });
  store.docs.get('schools/school/members/student')!.status = 'inactive';
  await expect(
    call('officer', { action: 'review', targetUid: 'student', decision: 'approved' }),
  ).rejects.toHaveProperty('code', 'permission-denied');
  store.docs.get('schools/school/members/student')!.status = 'active';
  await call('officer', { action: 'review', targetUid: 'student', decision: 'approved' });
  await expect(
    call('officer', { action: 'review', targetUid: 'student', decision: 'approved' }),
  ).rejects.toHaveProperty('code', 'failed-precondition');
  expect(store.docs.get('groups/club')?.memberCount).toBe(2);
});
test('未核可及停權不能學號加入，但邀請碼不加限制', async () => {
  store.docs.delete('schools/school/clubs/club');
  await expect(call('student', { action: 'join' })).rejects.toHaveProperty(
    'code',
    'permission-denied',
  );
  expect((await call('student', { action: 'directory' })).clubs).toEqual([]);
  const joined = await createGroupInviteHandlers({ db: store.db }).joinGroupByCode({
    auth: { uid: 'student' },
    data: { schoolId: 'school', joinCode: 'INVITE12' },
  });
  expect(joined.success).toBe(true);
  expect((await call()).status).toBe('active');
});
test('跨校、學校失效、離社幹部、普通學生皆不得提權或讀電話社費', async () => {
  const student = await call();
  expect(JSON.stringify(student)).not.toMatch(/private-phone|duesPaid/);
  for (const action of [
    'profile',
    'review',
    'official',
    'announcement',
    'createEvent',
    'office',
    'dues',
  ])
    await expect(call('student', { action })).rejects.toHaveProperty('code', 'permission-denied');
  store.docs.get('groups/club/members/officer')!.status = 'left';
  await expect(call('officer', { action: 'createEvent' })).rejects.toHaveProperty(
    'code',
    'permission-denied',
  );
  await expect(call('student', { schoolId: 'elsewhere' })).rejects.toHaveProperty(
    'code',
    'permission-denied',
  );
});
test('官方分類核可獨立，只有本校授權課外組可改，staff 本身不夠', async () => {
  store.docs.get('schools/school/serviceRoles/staff')!.clubs = false;
  await expect(
    call('staff', { action: 'official', status: 'suspended', category: '服務' }),
  ).rejects.toHaveProperty('code', 'permission-denied');
  store.docs.get('schools/school/serviceRoles/staff')!.clubs = true;
  await call('staff', { action: 'official', status: 'suspended', category: '服務' });
  expect((await call('staff', { action: 'office' })).clubs?.[0].approval).toBe('suspended');
  expect((await call('student', { action: 'directory' })).clubs).toEqual([]);
});
const event = () =>
  call('officer', {
    action: 'createEvent',
    operationId: 'event',
    title: '社課',
    location: '教室',
    startsAt: 5000,
    endsAt: 6000,
    registrationDeadline: 4000,
    cancellationDeadline: 3000,
    capacity: 1,
    visibility: 'public',
  });
test('建立活動逾期後相同操作仍確認成功，衝突與首次逾期建立仍拒絕', async () => {
  await event();
  const original = { ...store.docs.get('groups/club/clubEvents/event')! };
  time = 7000;
  await expect(event()).resolves.toMatchObject({ success: true });
  expect(store.docs.get('groups/club/clubEvents/event')).toEqual(original);
  await expect(
    call('officer', {
      action: 'createEvent',
      operationId: 'event',
      ...original,
      title: '不同活動',
    }),
  ).rejects.toHaveProperty('code', 'already-exists');
  store.docs.set('groups/club/members/other', { status: 'active', role: 'admin' });
  await expect(
    call('other', {
      action: 'createEvent',
      operationId: 'event',
      ...original,
    }),
  ).rejects.toHaveProperty('code', 'already-exists');
  await expect(
    call('officer', {
      action: 'createEvent',
      operationId: 'new-event',
      ...original,
    }),
  ).rejects.toHaveProperty('code', 'invalid-argument');
  expect(store.docs.has('groups/club/clubEvents/new-event')).toBe(false);
});
test('活動有名額、兩個截止、公開範圍；報名簽到重送不重複', async () => {
  await event();
  await event();
  await call('student', { action: 'register', eventId: 'event' });
  await call('student', { action: 'register', eventId: 'event' });
  await expect(call('other', { action: 'register', eventId: 'event' })).rejects.toHaveProperty(
    'message',
    '名額已滿',
  );
  time = 3500;
  await expect(call('student', { action: 'cancel', eventId: 'event' })).rejects.toThrow(
    '已過取消時間',
  );
  time = 5500;
  await call('officer', { action: 'checkIn', eventId: 'event', targetUid: 'student' });
  await call('officer', { action: 'checkIn', eventId: 'event', targetUid: 'student' });
  expect((await call()).events?.[0]).toMatchObject({
    registered: 1,
    checkedIn: 1,
    mine: true,
    myCheckIn: true,
  });
  expect((await call()).events?.[0].registrations).toBeUndefined();
  expect(store.docs.has('schools/school/clubEvents/event')).toBe(false);
});
test('公告沿用 posts 模型，重送冪等且訪客不可讀內部公告', async () => {
  await call('officer', {
    action: 'announcement',
    operationId: 'post',
    title: '社課',
    body: '帶相機',
  });
  await call('officer', {
    action: 'announcement',
    operationId: 'post',
    title: '社課',
    body: '帶相機',
  });
  expect(store.docs.get('groups/club/posts/post')).toMatchObject({
    kind: 'announcement',
    authorId: 'officer',
    schoolId: 'school',
  });
  expect((await call()).announcements).toEqual([]);
  expect((await call('officer')).announcements?.[0].body).toBe('帶相機');
});

test('QR 與後四碼由伺服器驗證，不在報名名單須明確現場加入', async () => {
  store.docs.get('schools/school/members/student')!.studentId = 'S12345678';
  await event();
  await call('student', { action: 'register', eventId: 'event' });
  const view = await call();
  expect(view.events?.[0].studentSuffix).toBe('5678');
  expect(view.events?.[0].myCheckInCode).toBe('nuni-club:club:event:student');
  time = 5500;
  await expect(
    call('officer', {
      action: 'checkIn',
      eventId: 'event',
      checkInCode: 'nuni-club:other:event:student',
    }),
  ).rejects.toHaveProperty('code', 'invalid-argument');
  await call('officer', { action: 'checkIn', eventId: 'event', checkInCode: '5678' });
  await expect(
    call('officer', { action: 'checkIn', eventId: 'event', targetUid: 'other' }),
  ).rejects.toThrow('這位不在報名名單');
  await expect(
    call('officer', {
      action: 'checkIn',
      eventId: 'event',
      targetUid: 'other',
      allowWalkIn: true,
    }),
  ).rejects.toThrow('名額已滿');
  expect(store.docs.has('groups/club/clubEvents/event/registrations/other')).toBe(false);
  store.docs.get('groups/club/clubEvents/event')!.capacity = 2;
  await call('officer', {
    action: 'checkIn',
    eventId: 'event',
    targetUid: 'other',
    allowWalkIn: true,
  });
  // Repeated check-in remains valid even after the walk-in fills the last seat.
  await call('officer', {
    action: 'checkIn',
    eventId: 'event',
    targetUid: 'other',
    allowWalkIn: true,
  });
  expect(store.docs.get('groups/club/clubEvents/event/registrations/other')).toMatchObject({
    onSite: true,
    status: 'registered',
  });
});

test('課外組逐筆確認官方幹部，舊角色確認不得套在新角色上', async () => {
  expect((await call('staff')).officialOfficers?.[0].status).toBe('pending');
  await expect(
    call('officer', { action: 'confirmOfficer', targetUid: 'officer', role: 'owner' }),
  ).rejects.toHaveProperty('code', 'permission-denied');
  await call('staff', { action: 'confirmOfficer', targetUid: 'officer', role: 'owner' });
  expect((await call('staff')).officialOfficers?.[0].status).toBe('confirmed');
  store.docs.get('groups/club/members/officer')!.role = 'admin';
  expect((await call('staff')).officialOfficers?.[0].status).toBe('pending');
});

test('社費保存在預設拒絕的幹部私有路徑，不寫入社員可讀的 members', async () => {
  await call('student', { action: 'join' });
  await call('officer', { action: 'dues', targetUid: 'student', duesPaid: true });
  expect(store.docs.get('groups/club/members/student')).not.toHaveProperty('duesPaid');
  expect(store.docs.get('groups/club/clubMemberRecords/student')).toMatchObject({
    duesPaid: true,
    updatedBy: 'officer',
  });
  expect((await call('officer')).members?.find((m) => m.id === 'student')?.duesPaid).toBe(true);
  expect((await call('student')).members).toEqual([]);
});

test('幹部與課外組回應及匯出不含完整學號', async () => {
  await call('student', { action: 'join' });
  store.docs.get('groups/club/members/student')!.studentId = 'S12345678';
  store.docs.set('users/student', { schoolId: 'school', studentId: 'S12345678' });
  for (const uid of ['student', 'officer', 'staff']) {
    const view = await call(uid);
    expect(JSON.stringify(view)).not.toContain('S12345678');
    expect(JSON.stringify(view)).not.toContain('studentId');
    expect(clubRosterCsv(view)).not.toContain('S12345678');
    expect(clubRosterCsv(view)).not.toContain('學號');
  }
});

test('超過五百位社員與一百場活動仍可閱讀介紹公告並逐頁讀完', async () => {
  for (let n = 0; n < 505; n++) {
    store.docs.set(`groups/club/members/member-${String(n).padStart(3, '0')}`, {
      status: 'active',
      role: 'member',
    });
  }
  for (let n = 0; n < 105; n++) {
    store.docs.set(`groups/club/clubEvents/event-${String(n).padStart(3, '0')}`, {
      title: '社課',
      startsAt: 5000,
      endsAt: 6000,
      visibility: n % 2 ? 'members' : 'public',
    });
  }
  await call('officer', {
    action: 'announcement',
    operationId: 'notice',
    title: '公告',
    body: '照常閱讀',
  });
  const first = await call('officer');
  expect(first.club?.name).toBe('攝影社');
  expect(first.announcements?.[0].body).toBe('照常閱讀');
  expect(first.members).toHaveLength(100);
  expect(first.events).toHaveLength(20);
  const members = [...first.members!],
    events = [...first.events!];
  let memberCursor = first.memberCursor,
    eventCursor = first.eventCursor;
  while (memberCursor) {
    const next = await call('officer', { memberCursor });
    members.push(...next.members!);
    memberCursor = next.memberCursor;
  }
  while (eventCursor) {
    const next = await call('officer', { eventCursor });
    events.push(...next.events!);
    eventCursor = next.eventCursor;
  }
  expect(new Set(members.map((m) => m.id)).size).toBe(506);
  expect(new Set(events.map((e) => e.id)).size).toBe(105);
  const visitor = await call('student');
  expect(visitor.club?.name).toBe('攝影社');
  expect(visitor.members).toEqual([]);
  expect(visitor.events?.every((e) => e.visibility === 'public')).toBe(true);
  expect(visitor.eventCursor).toBeTruthy();
});

test('報名姓名不依賴社員分頁，公開活動非社員也能核對且學生不取得名單', async () => {
  await event();
  const attendees = ['member-z', 'student'];
  for (let n = 0; n < 101; n++)
    store.docs.set(`groups/club/members/member-${String(n).padStart(3, '0')}`, {
      status: 'active',
      role: 'member',
    });
  store.docs.set('groups/club/members/member-z', { status: 'active', role: 'member' });
  for (const uid of attendees) {
    store.docs.set(`groups/club/clubEvents/event/registrations/${uid}`, { status: 'registered' });
    store.docs.set(`schools/school/directory/${uid}`, { displayName: `姓名-${uid}` });
  }
  delete store.docs.get('groups/club/clubEvents/event')!.registeredCount;
  for (const uid of ['officer', 'staff']) {
    const view = await call(uid);
    expect(view.members?.some((m) => m.id === 'member-z')).toBe(false);
    expect(view.events?.[0].registrations?.map((r) => r.name).sort()).toEqual(
      attendees.map((id) => `姓名-${id}`).sort(),
    );
  }
  expect((await call('student')).events?.[0].registrations).toBeUndefined();
});

test('五百筆以上申請可逐頁審核，不阻斷介紹、公告與活動，也不外洩申請', async () => {
  await event();
  await call('officer', {
    action: 'announcement',
    operationId: 'notice',
    title: '公告',
    body: '正常',
  });
  for (let n = 0; n < 505; n++)
    store.docs.set(`groups/club/joinRequests/applicant-${String(n).padStart(3, '0')}`, {
      status: 'pending',
      displayName: `申請者${n}`,
    });
  store.docs.set('groups/club/joinRequests/declined', {
    status: 'declined',
    displayName: '不顯示',
  });
  const first = await call('officer');
  expect(first.club?.name).toBe('攝影社');
  expect(first.announcements?.[0].body).toBe('正常');
  expect(first.events).toHaveLength(1);
  expect(first.requests).toHaveLength(100);
  const ids = first.requests!.map((r) => r.id);
  let cursor = first.requestCursor;
  while (cursor) {
    const next = await call('officer', { requestCursor: cursor });
    ids.push(...next.requests!.map((r) => r.id));
    cursor = next.requestCursor;
  }
  expect(ids).toHaveLength(505);
  expect(new Set(ids).size).toBe(505);
  for (const uid of ['student', 'staff']) {
    const view = await call(uid, { requestCursor: first.requestCursor });
    expect(view.requests).toEqual([]);
    expect(view.requestCursor).toBeUndefined();
  }
});

test('千筆以上取消紀錄不影響閱讀、報名、後四碼簽到與現場名額', async () => {
  await event();
  store.docs.get('groups/club/clubEvents/event')!.capacity = 2;
  for (let n = 0; n < 1005; n++)
    store.docs.set(`groups/club/clubEvents/event/registrations/cancelled-${n}`, {
      status: 'cancelled',
      studentSuffix: '5678',
    });
  expect((await call('officer')).events?.[0]).toMatchObject({ registered: 0, registrations: [] });
  await call('student', { action: 'register', eventId: 'event' });
  expect((await call()).events?.[0]).toMatchObject({ registered: 1, mine: true });
  time = 5500;
  await call('officer', { action: 'checkIn', eventId: 'event', checkInCode: '5678' });
  await call('officer', {
    action: 'checkIn',
    eventId: 'event',
    targetUid: 'other',
    allowWalkIn: true,
  });
  await expect(
    call('officer', {
      action: 'checkIn',
      eventId: 'event',
      targetUid: 'staff',
      allowWalkIn: true,
    }),
  ).rejects.toThrow('名額已滿');
  const row = (await call('officer')).events?.[0];
  expect(row).toMatchObject({ registered: 2, checkedIn: 2 });
  expect(row?.registrations).toHaveLength(2);
  time = 1000;
  await expect(call('staff', { action: 'register', eventId: 'event' })).rejects.toThrow('名額已滿');
});

test('超過千位有效報名仍可閱讀並獨立翻頁，不外洩名單且總數不受分頁影響', async () => {
  await event();
  await call('officer', {
    action: 'createEvent',
    operationId: 'second',
    title: '另一活動',
    location: '教室',
    startsAt: 5000,
    endsAt: 6000,
    registrationDeadline: 4000,
    cancellationDeadline: 3000,
    capacity: 1,
    visibility: 'public',
  });
  for (let n = 0; n < 1005; n++) {
    const uid = `attendee-${String(n).padStart(4, '0')}`;
    store.docs.set(`groups/club/clubEvents/event/registrations/${uid}`, {
      status: 'registered',
      checkedInAt: n % 2 ? 5500 : null,
    });
  }
  delete store.docs.get('groups/club/clubEvents/event')!.registeredCount;
  for (const uid of ['officer', 'staff']) {
    const first = await call(uid);
    expect(first.club?.name).toBe('攝影社');
    expect(first.events).toHaveLength(2);
    const row = first.events!.find((e) => e.id === 'event')!;
    expect(row).toMatchObject({ registered: 1005, checkedIn: 502 });
    expect(row.registrations).toHaveLength(100);
    const ids = row.registrations!.map((r) => r.uid);
    let cursor = row.registrationCursor;
    while (cursor) {
      const page = (await call(uid, { rosterEventId: 'event', registrationCursor: cursor }))
        .events![0];
      expect(page).toMatchObject({ registered: 1005, checkedIn: 502 });
      ids.push(...page.registrations!.map((r) => r.uid));
      cursor = page.registrationCursor;
    }
    expect(ids).toHaveLength(1005);
    expect(new Set(ids).size).toBe(1005);
  }
  const visitor = (
    await call('student', { rosterEventId: 'event', registrationCursor: 'attendee-0001' })
  ).events![0];
  expect(visitor.registrations).toBeUndefined();
  expect(visitor.registrationCursor).toBeUndefined();
});

test('歷史活動超過一頁時仍優先顯示近期活動，管理可繼續讀取歷史', async () => {
  for (let n = 0; n < 105; n++) {
    store.docs.set(`groups/club/clubEvents/old-${String(n).padStart(3, '0')}`, {
      title: '歷史社課',
      startsAt: 100,
      endsAt: 200,
      visibility: 'public',
    });
  }
  for (const [id, startsAt, endsAt] of [
    ['z-later', 5000, 6000],
    ['z-sooner', 2000, 3000],
    ['z-ongoing', 500, 1500],
  ] as const) {
    store.docs.set(`groups/club/clubEvents/${id}`, {
      title: id,
      startsAt,
      endsAt,
      visibility: 'public',
    });
  }
  for (const uid of ['student', 'officer', 'staff']) {
    const first = await call(uid);
    expect(first.events!.slice(0, 3).map((e) => e.id)).toEqual([
      'z-ongoing',
      'z-sooner',
      'z-later',
    ]);
    if (uid === 'student') {
      expect(first.events).toHaveLength(3);
      expect(first.eventCursor).toBeUndefined();
    } else {
      const ids = first.events!.map((e) => e.id);
      let cursor = first.eventCursor;
      while (cursor) {
        const next = await call(uid, { eventCursor: cursor });
        ids.push(...next.events!.map((e) => e.id));
        cursor = next.eventCursor;
      }
      expect(new Set(ids).size).toBe(108);
    }
  }
});

test('活動與報名讀取量受頁面限制，已有計數不再掃描報名統計', async () => {
  for (let n = 0; n < 2005; n++)
    store.docs.set(`groups/club/clubEvents/event-${String(n).padStart(4, '0')}`, {
      title: '社課',
      startsAt: 5000,
      endsAt: 6000,
      visibility: 'public',
      registeredCount: 800,
      checkedInCount: 300,
    });
  const first = await call('officer');
  expect(first.events).toHaveLength(20);
  expect(first.events![0]).toMatchObject({ registered: 800, checkedIn: 300 });
  expect(
    reads.filter((r) => r.path === 'groups/club/clubEvents').reduce((n, r) => n + r.size, 0),
  ).toBe(21);
  expect(reads.some((r) => r.aggregate)).toBe(false);
  expect(
    reads.filter((r) => r.path.endsWith('/registrations')).every((r) => r.maximum === 101),
  ).toBe(true);
  reads = [];
  const next = await call('officer', { eventCursor: first.eventCursor });
  expect(next.events).toHaveLength(20);
  expect(next.events!.some((e) => first.events!.some((prior) => prior.id === e.id))).toBe(false);
  expect(
    reads.filter((r) => r.path === 'groups/club/clubEvents').reduce((n, r) => n + r.size, 0),
  ).toBe(21);
});

test('取消重送、重報、重複簽到與交易失敗皆維持正確計數', async () => {
  await event();
  await call('student', { action: 'register', eventId: 'event' });
  await call('student', { action: 'cancel', eventId: 'event' });
  await call('student', { action: 'cancel', eventId: 'event' });
  expect(store.docs.get('groups/club/clubEvents/event')).toMatchObject({
    registeredCount: 0,
    checkedInCount: 0,
  });
  store.failNextCommit();
  await expect(call('student', { action: 'register', eventId: 'event' })).rejects.toThrow();
  expect(store.docs.get('groups/club/clubEvents/event')!.registeredCount).toBe(0);
  await call('student', { action: 'register', eventId: 'event' });
  time = 5500;
  await call('officer', { action: 'checkIn', eventId: 'event', targetUid: 'student' });
  await call('officer', { action: 'checkIn', eventId: 'event', targetUid: 'student' });
  expect(store.docs.get('groups/club/clubEvents/event')).toMatchObject({
    registeredCount: 1,
    checkedInCount: 1,
  });
});

test('即時與歷史頁交界不漏資料，游標固定時間邊界且拒絕無效游標', async () => {
  for (let n = 0; n < 21; n++)
    store.docs.set(`groups/club/clubEvents/live-${String(n).padStart(2, '0')}`, {
      title: '近期',
      startsAt: 5000,
      endsAt: 6000,
      visibility: 'public',
      registeredCount: 0,
      checkedInCount: 0,
    });
  store.docs.set('groups/club/clubEvents/history', {
    title: '歷史',
    startsAt: 1,
    endsAt: 2,
    visibility: 'public',
    registeredCount: 0,
    checkedInCount: 0,
  });
  const first = await call('officer');
  time = 9000;
  const next = await call('officer', { eventCursor: first.eventCursor });
  expect(next.events!.map((e) => e.id)).toEqual(['live-20', 'history']);
  expect(next.eventCursor).toBeUndefined();
  await expect(call('officer', { eventCursor: 'invalid' })).rejects.toHaveProperty(
    'code',
    'invalid-argument',
  );
});

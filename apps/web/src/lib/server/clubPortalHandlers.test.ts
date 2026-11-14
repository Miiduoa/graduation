// @vitest-environment node
import { beforeEach, expect, test } from 'vitest';
import { createClubPortal } from './clubPortalHandlers';
import { createMemoryGroupStore } from './memoryGroupStore';
import { createGroupInviteHandlers } from './groupInviteHandlers';
let store: ReturnType<typeof createMemoryGroupStore>,
  run: ReturnType<typeof createClubPortal>,
  time: number;
const call = (uid = 'student', data: Record<string, unknown> = {}) =>
  run({ auth: { uid }, data: { schoolId: 'school', groupId: 'club', action: 'read', ...data } });
beforeEach(() => {
  time = 1000;
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

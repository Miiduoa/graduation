const { createClubAdmin } = require('./clubAdmin');
const { transactionStore } = require('./testSupport/transactionStore');

describe('社團後台授權與統計', () => {
  let store, run, time;
  const request = (uid = 'president', data = {}) =>
    run({ auth: { uid }, data: { groupId: 'club', schoolId: 'school', ...data } });
  beforeEach(() => {
    time = 1000;
    store = transactionStore([
      ['groups/club', { type: 'club', schoolId: 'school', name: '測試社' }],
      ...['president', 'officer', 'student'].flatMap((uid, i) => [
        [`schools/school/members/${uid}`, { status: 'active' }],
        [
          `groups/club/members/${uid}`,
          {
            status: 'active',
            role: ['owner', 'admin', 'member'][i],
            displayName: uid,
            studentId: 'S123',
            phone: '0900000000',
          },
        ],
      ]),
    ]);
    run = createClubAdmin({
      db: store.db,
      enabled: () => true,
      pilotGroupId: 'club',
      now: () => time,
    });
  });
  const create = () =>
    request('officer', {
      action: 'create',
      eventId: 'event',
      title: '測試活動',
      location: '教室',
      startsAt: 2000,
      endsAt: 3000,
    });
  test('預設關閉且拒絕未登入', async () => {
    await expect(createClubAdmin({ db: store.db, enabled: () => false })({})).rejects.toMatchObject(
      { code: 'failed-precondition' },
    );
    await expect(run({})).rejects.toMatchObject({ code: 'unauthenticated' });
  });
  test.each([{ schoolId: 'another' }, { groupId: 'another' }, { groupId: '../club' }])(
    '拒絕跨社團與無效路徑 %j',
    async (data) => {
      await expect(request('student', data)).rejects.toHaveProperty('code');
    },
  );
  test.each(['create', 'checkIn', 'export', 'role'])('社員不可執行 %s', async (action) => {
    await expect(request('student', { action })).rejects.toMatchObject({
      code: 'permission-denied',
    });
  });
  test('私人欄位只回傳給幹部以上；社員不取得他人報名識別碼', async () => {
    await create();
    await request('student', { action: 'register', eventId: 'event' });
    const student = await request('student');
    expect(JSON.stringify(student)).not.toMatch(/S123|0900000000|registrations/);
    expect((await request('officer')).members[0]).toHaveProperty('phone', '0900000000');
    expect((await request('president', { action: 'export' })).csv).toContain('S123');
  });
  test('重載保留、重送報名及簽到不重複，取消後不計數', async () => {
    await create();
    await create();
    for (let i = 0; i < 2; i++) await request('student', { action: 'register', eventId: 'event' });
    expect((await request()).events[0].registered).toBe(1);
    await request('student', { action: 'cancel', eventId: 'event' });
    expect((await request()).events[0].registered).toBe(0);
    await request('student', { action: 'register', eventId: 'event' });
    await expect(
      request('officer', { action: 'checkIn', eventId: 'event', targetUid: 'student' }),
    ).rejects.toHaveProperty('code', 'failed-precondition');
    time = 2500;
    for (let i = 0; i < 2; i++)
      await request('officer', { action: 'checkIn', eventId: 'event', targetUid: 'student' });
    run = createClubAdmin({
      db: store.db,
      enabled: () => true,
      pilotGroupId: 'club',
      now: () => time,
    });
    expect((await request()).events[0]).toMatchObject({ registered: 1, checkedIn: 1 });
    expect((await request('president', { action: 'export' })).csv).toContain('"1","1"');
    await expect(request('student', { action: 'cancel', eventId: 'event' })).rejects.toHaveProperty(
      'code',
      'failed-precondition',
    );
  });
  test('撤權與離社不納入統計；學校身分失效拒絕讀寫', async () => {
    await create();
    await request('student', { action: 'register', eventId: 'event' });
    store.docs.get('groups/club/members/student').status = 'left';
    expect((await request()).events[0].registered).toBe(0);
    await expect(request('student')).rejects.toHaveProperty('code', 'permission-denied');
    store.docs.get('schools/school/members/officer').status = 'inactive';
    await expect(request('officer')).rejects.toHaveProperty('code', 'permission-denied');
  });
  test('只有會長可調整幹部且同步使用者索引，不可修改會長', async () => {
    await expect(
      request('officer', { action: 'role', targetUid: 'student', role: 'admin' }),
    ).rejects.toHaveProperty('code', 'permission-denied');
    await request('president', { action: 'role', targetUid: 'student', role: 'admin' });
    expect(store.docs.get('users/student/groups/club').role).toBe('admin');
    await expect(
      request('president', { action: 'role', targetUid: 'president', role: 'member' }),
    ).rejects.toHaveProperty('code', 'failed-precondition');
  });
  test('空狀態、活動輸入驗證與匯出試算表字串處理', async () => {
    expect((await request()).events).toEqual([]);
    await expect(
      request('officer', {
        action: 'create',
        eventId: 'bad',
        title: '',
        startsAt: 2000,
        endsAt: 1000,
      }),
    ).rejects.toHaveProperty('code', 'invalid-argument');
    store.docs.get('groups/club/members/student').displayName = '=SUM(1,2)';
    expect((await request('president', { action: 'export' })).csv).toContain('"\'=SUM(1,2)"');
  });
  test('提交失敗不回報成功也不留下活動', async () => {
    store.failNextCommit();
    await expect(create()).rejects.toThrow('commit unavailable');
    expect((await request()).events).toEqual([]);
  });
  test('指定試辦社團且私人資料來源必須屬於目前學校', async () => {
    await expect(
      createClubAdmin({ db: store.db, enabled: () => true, pilotGroupId: '' })({
        auth: { uid: 'student' },
        data: { groupId: 'club', schoolId: 'school' },
      }),
    ).rejects.toHaveProperty('code', 'failed-precondition');
    store.docs.set('users/student', {
      schoolId: 'another',
      studentId: 'PRIVATE',
      phone: 'PRIVATE',
    });
    delete store.docs.get('groups/club/members/student').studentId;
    delete store.docs.get('groups/club/members/student').phone;
    store.docs.set('schools/school/directory/student', { displayName: '公開姓名' });
    const view = await request('officer');
    expect(view.members.find((m) => m.id === 'student')).toMatchObject({
      name: '公開姓名',
      studentId: '',
      phone: '',
    });
    expect(JSON.stringify(await request('student'))).not.toContain('PRIVATE');
  });
  test('調整幹部保留既有群組索引欄位', async () => {
    store.docs.set('users/student/groups/club', { joinCode: 'EXISTING', custom: '保留' });
    await request('president', { action: 'role', targetUid: 'student', role: 'admin' });
    expect(store.docs.get('users/student/groups/club')).toMatchObject({
      joinCode: 'EXISTING',
      custom: '保留',
      role: 'admin',
    });
  });
});

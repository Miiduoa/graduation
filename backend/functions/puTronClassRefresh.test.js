const { canonicalizePuStudentId, createPuTronClassRefresher } = require('./puTronClassRefresh');

const NOW = Date.parse('2026-10-27T10:00:00Z');
const TTL = 30 * 24 * 60 * 60 * 1000;
const STUDENT_ID = '411234567';
const UID = `pu-${STUDENT_ID}`;
const PROFILE_PATH = `users/${UID}`;
const MEMBER_PATH = `schools/pu/members/${UID}`;
const PORTAL_PATH = '_puSessions/current-portal';

function fixture() {
  const rows = new Map([
    [PROFILE_PATH, { schoolId: 'pu', studentId: STUDENT_ID }],
    [MEMBER_PATH, { status: 'active', studentId: STUDENT_ID }],
    [PORTAL_PATH, {
      ownerUid: UID,
      studentId: STUDENT_ID,
      cookies: { SID: 'portal-cookie' },
      expiresAt: new Date(NOW + 60_000),
      tronClassSessionId: null,
    }],
  ]);
  const snapshot = (path) => ({
    exists: rows.has(path),
    data: () => rows.get(path),
    ref: { path },
  });
  const queryCalls = [];
  const db = {
    doc: (path) => ({ path, get: async () => snapshot(path) }),
    collection: (collection) => {
      expect(collection).toBe('_puSessions');
      const query = {
        where(field, operator, value) {
          queryCalls.push([field, operator, value]);
          expect([field, operator]).toEqual(['ownerUid', '==']);
          this.owner = value;
          return this;
        },
        orderBy(field, direction) {
          expect([field, direction]).toEqual(['expiresAt', 'desc']);
          return this;
        },
        limit(count) {
          expect(count).toBe(1);
          return this;
        },
        read() {
          return {
            docs: [...rows.entries()]
              .filter(([path, row]) => path.startsWith('_puSessions/') && row.ownerUid === this.owner)
              .sort((a, b) => b[1].expiresAt - a[1].expiresAt)
              .slice(0, 1)
              .map(([path]) => snapshot(path)),
          };
        },
      };
      return query;
    },
    runTransaction: jest.fn(async (callback) => {
      const writes = [];
      const result = await callback({
        getAll: async (...refs) => refs.map((ref) => snapshot(ref.path)),
        get: async (query) => query.read(),
        create: (ref, value) => writes.push(() => {
          if (rows.has(ref.path)) throw new Error('Already exists');
          rows.set(ref.path, value);
        }),
        update: (ref, value) => writes.push(() => {
          if (!rows.has(ref.path)) throw new Error('Missing document');
          rows.set(ref.path, { ...rows.get(ref.path), ...value });
        }),
      });
      writes.forEach((write) => write());
      return result;
    }),
  };
  const loginResult = {
    success: true,
    cookies: { session: 'login-cookie' },
    session: { userId: 57, userName: 'student' },
  };
  const identity = {
    profile: { id: 57, login_name: `s${STUDENT_ID}`, email: `${STUDENT_ID}@pu.edu.tw`, name: '同學' },
    cookies: { session: 'rotated-cookie' },
  };
  const login = jest.fn(async () => loginResult);
  const fetchIdentityProfile = jest.fn(async () => identity);
  const refresh = createPuTronClassRefresher({
    db, login, fetchIdentityProfile, sessionTtlMs: TTL, now: () => NOW,
  });
  const request = { authUser: { uid: UID, schoolId: 'pu' }, studentId: STUDENT_ID, password: 'test-password' };
  const storedLmsSessions = () => [...rows.entries()].filter(([path]) => path.startsWith('_puTronClassSessions/'));
  return { rows, db, queryCalls, login, loginResult, identity, fetchIdentityProfile, refresh, request, storedLmsSessions };
}

describe('PU TronClass refresh account binding', () => {
  test.each([STUDENT_ID, `s${STUDENT_ID}`, `S${STUDENT_ID}@PU.EDU.TW`, ` ${STUDENT_ID}@pu.edu.tw `])(
    'uses the same canonical student identity for %s', (input) => {
      expect(canonicalizePuStudentId(input)).toBe(STUDENT_ID);
    },
  );

  test('links the newest owned portal and stores only a verified, rotated LMS session', async () => {
    const f = fixture();
    f.rows.set('_puSessions/older', { ...f.rows.get(PORTAL_PATH), expiresAt: new Date(NOW + 30_000) });
    f.rows.set('_puSessions/another-user', {
      ...f.rows.get(PORTAL_PATH), ownerUid: 'pu-499999999', expiresAt: new Date(NOW + 120_000),
    });
    f.rows.get(PORTAL_PATH).studentId = `s${STUDENT_ID}@pu.edu.tw`;
    const result = await f.refresh({ ...f.request, studentId: `S${STUDENT_ID}@PU.EDU.TW`, sessionId: 'another-user' });
    expect(result).toMatchObject({ success: true, tronClassUserId: 57, tronClassSessionId: expect.stringMatching(/^[a-f0-9]{32}$/) });
    expect(f.rows.get(PORTAL_PATH).tronClassSessionId).toBe(result.tronClassSessionId);
    expect(f.rows.get('_puSessions/older').tronClassSessionId).toBeNull();
    expect(f.rows.get('_puSessions/another-user').tronClassSessionId).toBeNull();
    expect(f.storedLmsSessions()).toEqual([[`_puTronClassSessions/${result.tronClassSessionId}`, {
      studentId: STUDENT_ID, ownerUid: UID, cookies: { session: 'rotated-cookie' },
      userId: 57, userName: '同學', createdAt: new Date(NOW), expiresAt: new Date(NOW + TTL),
    }]]);
    expect(f.queryCalls).toEqual([['ownerUid', '==', UID]]);
    expect(f.fetchIdentityProfile).toHaveBeenCalledWith({ session: 'login-cookie' });
  });

  test('rejects another student even when the editable profile claims that student', async () => {
    const f = fixture();
    f.rows.get(PROFILE_PATH).studentId = '499999999';
    await expect(f.refresh({ ...f.request, studentId: '499999999' })).rejects.toMatchObject({ statusCode: 403 });
    expect(f.login).not.toHaveBeenCalled();
    expect(f.storedLmsSessions()).toEqual([]);
  });

  test.each([
    { uid: UID }, { uid: UID, schoolId: 'other' },
    { uid: 'random-firebase-user', schoolId: 'pu' },
    { uid: `pu-t-s${STUDENT_ID}`, schoolId: 'pu' },
  ])('rejects a nonmatching authenticated account before contacting the school: %j', async (authUser) => {
    const f = fixture();
    await expect(f.refresh({ ...f.request, authUser })).rejects.toMatchObject({ statusCode: 403 });
    expect(f.login).not.toHaveBeenCalled();
  });

  test.each([
    ['missing profile', (rows) => rows.delete(PROFILE_PATH)],
    ['different school', (rows) => { rows.get(PROFILE_PATH).schoolId = 'other'; }],
    ['different profile student', (rows) => { rows.get(PROFILE_PATH).studentId = '499999999'; }],
    ['account deletion', (rows) => { rows.get(PROFILE_PATH).accountDeletionInProgress = true; }],
    ['deleted account', (rows) => { rows.get(PROFILE_PATH).status = 'deleted'; }],
    ['missing membership', (rows) => rows.delete(MEMBER_PATH)],
    ['inactive membership', (rows) => { rows.get(MEMBER_PATH).status = 'inactive'; }],
    ['unspecified membership status', (rows) => { delete rows.get(MEMBER_PATH).status; }],
    ['different membership student', (rows) => { rows.get(MEMBER_PATH).studentId = '499999999'; }],
  ])('rejects %s before using credentials', async (_label, mutate) => {
    const f = fixture();
    mutate(f.rows);
    await expect(f.refresh(f.request)).rejects.toMatchObject({ statusCode: 403 });
    expect(f.login).not.toHaveBeenCalled();
    expect(f.db.runTransaction).not.toHaveBeenCalled();
  });

  test.each([null, ['411234567'], '411234567@example.com', 'faculty', '123'])('rejects malformed student IDs: %j', async (studentId) => {
    const f = fixture();
    await expect(f.refresh({ ...f.request, studentId })).rejects.toMatchObject({ statusCode: 400 });
    expect(f.login).not.toHaveBeenCalled();
  });

  test.each([
    ['constructed numeric-only profile', { id: 57, login_name: '', email: null }, 502],
    ['foreign email', { id: 57, email: `${STUDENT_ID}@example.com` }, 502],
    ['no numeric profile ID', { login_name: STUDENT_ID }, 502],
    ['another login identity', { id: 57, login_name: 's499999999' }, 403],
    ['conflicting email identity', { id: 57, login_name: STUDENT_ID, email: '499999999@pu.edu.tw' }, 403],
    ['different numeric profile', { id: 58, login_name: STUDENT_ID }, 403],
  ])('does not persist %s', async (_label, profile, statusCode) => {
    const f = fixture();
    f.identity.profile = profile;
    await expect(f.refresh(f.request)).rejects.toMatchObject({ statusCode });
    expect(f.storedLmsSessions()).toEqual([]);
    expect(f.rows.get(PORTAL_PATH).tronClassSessionId).toBeNull();
  });

  test('can establish the numeric LMS ID only from a freshly verified profile', async () => {
    const f = fixture();
    f.loginResult.session.userId = null;
    f.identity.profile = { user: { id: '57', user_name: `s${STUDENT_ID}` } };
    await expect(f.refresh(f.request)).resolves.toMatchObject({ success: true, tronClassUserId: 57 });
  });

  test('does not store a login when the identity endpoint is unavailable', async () => {
    const f = fixture();
    f.fetchIdentityProfile.mockRejectedValue(new Error('HTTP 503'));
    await expect(f.refresh(f.request)).rejects.toMatchObject({ statusCode: 502 });
    expect(f.storedLmsSessions()).toEqual([]);
  });

  test('does not verify or store a failed school login', async () => {
    const f = fixture();
    f.loginResult.success = false;
    await expect(f.refresh(f.request)).rejects.toMatchObject({ statusCode: 401 });
    expect(f.fetchIdentityProfile).not.toHaveBeenCalled();
    expect(f.storedLmsSessions()).toEqual([]);
  });

  test.each([
    ['missing portal', (rows) => rows.delete(PORTAL_PATH)],
    ['expired portal', (rows) => { rows.get(PORTAL_PATH).expiresAt = new Date(NOW - 1); }],
    ['portal expiring now', (rows) => { rows.get(PORTAL_PATH).expiresAt = new Date(NOW); }],
    ['another owner', (rows) => { rows.get(PORTAL_PATH).ownerUid = 'pu-499999999'; }],
    ['ownerless portal', (rows) => { delete rows.get(PORTAL_PATH).ownerUid; }],
    ['another student on the same owner', (rows) => { rows.get(PORTAL_PATH).studentId = '499999999'; }],
    ['unspecified portal student', (rows) => { delete rows.get(PORTAL_PATH).studentId; }],
  ])('keeps a verified standalone refresh usable with %s without attaching it', async (_label, mutate) => {
    const f = fixture();
    mutate(f.rows);
    const previousPortal = f.rows.has(PORTAL_PATH) ? { ...f.rows.get(PORTAL_PATH) } : undefined;
    await expect(f.refresh(f.request)).resolves.toMatchObject({ success: true });
    expect(f.storedLmsSessions()).toHaveLength(1);
    expect(f.rows.get(PORTAL_PATH)).toEqual(previousPortal);
  });

  test('does not attach an older matching portal when the current portal belongs to another school account', async () => {
    const f = fixture();
    f.rows.set('_puSessions/older', { ...f.rows.get(PORTAL_PATH), expiresAt: new Date(NOW + 30_000) });
    f.rows.get(PORTAL_PATH).studentId = '499999999';
    await f.refresh(f.request);
    expect(f.rows.get(PORTAL_PATH).tronClassSessionId).toBeNull();
    expect(f.rows.get('_puSessions/older').tronClassSessionId).toBeNull();
  });

  test.each([
    ['deletion', (rows) => { rows.get(PROFILE_PATH).accountDeletionInProgress = true; }],
    ['revoked membership', (rows) => { rows.get(MEMBER_PATH).status = 'inactive'; }],
    ['changed identity', (rows) => { rows.get(PROFILE_PATH).studentId = '499999999'; }],
  ])('rechecks %s after the school request before committing any session', async (_label, mutate) => {
    const f = fixture();
    f.fetchIdentityProfile.mockImplementation(async () => {
      mutate(f.rows);
      return f.identity;
    });
    await expect(f.refresh(f.request)).rejects.toMatchObject({ statusCode: 403 });
    expect(f.storedLmsSessions()).toEqual([]);
    expect(f.rows.get(PORTAL_PATH).tronClassSessionId).toBeNull();
  });

  test('selects the current portal inside the commit transaction after the school login', async () => {
    const f = fixture();
    f.login.mockImplementation(async () => {
      f.rows.set('_puSessions/newer', { ...f.rows.get(PORTAL_PATH), expiresAt: new Date(NOW + 120_000) });
      return f.loginResult;
    });
    const result = await f.refresh(f.request);
    expect(f.rows.get('_puSessions/newer').tronClassSessionId).toBe(result.tronClassSessionId);
    expect(f.rows.get(PORTAL_PATH).tronClassSessionId).toBeNull();
  });
});

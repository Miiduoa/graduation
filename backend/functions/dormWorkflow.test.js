const { hasServiceDomainAccess } = require('./authz');
const { createDormWorkflowHandler, transition } = require('./dormWorkflow');
function fixture(options = {}) {
  const data = new Map([
    ['schools/pu', { dormWorkflowEnabled: true }],
    ['schools/pu/members/student', { role: 'student' }],
    ['schools/pu/dormSsoIdentities/student', { studentId: '123', displayName: '同學' }],
    ['schools/pu/members/staff', { role: 'staff' }],
    ['schools/pu/members/admin', { role: 'admin' }],
    [
      'schools/pu/dormStaffRoles/staff',
      { status: 'active', repairs: true, packages: true, buildings: ['A'] },
    ],
    ['users/student', { studentId: '123', displayName: '同學' }],
  ]);
  let next = 0;
  const snapshot = (path) => ({
    id: path.split('/').at(-1),
    exists: data.has(path),
    data: () => data.get(path),
    ref: doc(path),
  });
  const doc = (path) => ({
    id: path.split('/').at(-1),
    path,
    get: async () => snapshot(path),
    collection: (name) => collection(path + '/' + name),
  });
  const queries = [];
  const collection = (path, filters = [], orders = [], after = null, max = Infinity) => ({
    doc: (id) => doc(path + '/' + (id || `auto${++next}`)),
    where: (f, op, v) => collection(path, [...filters, [f, op, v]], orders, after, max),
    orderBy: (f, direction) => collection(path, filters, [...orders, [f, direction]], after, max),
    startAfter: (snap) => collection(path, filters, orders, snap.id, max),
    limit: (n) => collection(path, filters, orders, after, n),
    get: async () => {
      queries.push({ path, filters, orders, after, max });
      let keys = [...data.keys()].filter(
        (k) =>
          k.startsWith(path + '/') &&
          k.split('/').length === path.split('/').length + 1 &&
          filters.every(([f, op, v]) =>
            op === 'in' ? v.includes(data.get(k)[f]) : data.get(k)[f] === v,
          ),
      );
      if (orders.length)
        keys.sort((a, b) => {
          for (const [field, direction] of orders) {
            const av = field === '__name__' ? a.split('/').at(-1) : data.get(a)[field];
            const bv = field === '__name__' ? b.split('/').at(-1) : data.get(b)[field];
            if (av !== bv) return (av > bv ? 1 : -1) * (direction === 'desc' ? -1 : 1);
          }
          return 0;
        });
      if (after) keys = keys.slice(keys.findIndex((k) => k.split('/').at(-1) === after) + 1);
      return { docs: keys.slice(0, max).map(snapshot) };
    },
    add: async (row) => {
      const r = doc(path + '/auto' + ++next);
      data.set(r.path, row);
      return r;
    },
  });
  const writer = () => ({
    get: async (ref) => (ref.path ? snapshot(ref.path) : ref.get()),
    getAll: async (...refs) => refs.map((r) => snapshot(r.path)),
    create: (ref, row) => data.set(ref.path, row),
    set: (ref, row, opts) =>
      data.set(ref.path, opts?.merge ? { ...data.get(ref.path), ...row } : row),
    update: (ref, row) => data.set(ref.path, { ...data.get(ref.path), ...row }),
    commit: async () => {},
  });
  const db = { collection, runTransaction: async (fn) => fn(writer()), batch: writer };
  const sendPushToUser = jest.fn().mockResolvedValue({});
  const handler = createDormWorkflowHandler({ db, sendPushToUser, ...options });
  const call = (uid, input) => handler({ auth: { uid }, data: { schoolId: 'pu', ...input } });
  return { call, data, sendPushToUser, db, queries };
}
const repair = {
  action: 'submitRepair',
  key: 'retry1',
  title: '電燈故障',
  description: '無法開啟',
  category: 'electric',
  building: 'A',
  room: '101',
};
test('five states require receipt, schedule, fix and student confirmation; reopen keeps history', async () => {
  const { call, data } = fixture();
  const { id } = await call('student', repair);
  await call('student', repair);
  expect([...data.keys()].filter((k) => k.includes('/dormRepairs/'))).toHaveLength(1);
  await expect(
    call('staff', { action: 'repairStatus', id, status: 'fixed' }),
  ).rejects.toMatchObject({ code: 'failed-precondition' });
  for (const status of ['received', 'scheduled', 'fixed'])
    await call('staff', { action: 'repairStatus', id, status, schoolReference: 'A123' });
  await expect(
    call('staff', { action: 'repairStatus', id, status: 'closed' }),
  ).rejects.toMatchObject({ code: 'failed-precondition' });
  await call('student', { action: 'repairStatus', id, status: 'closed' });
  await call('student', { action: 'repairStatus', id, status: 'sent' });
  const row = data.get('schools/pu/dormRepairs/' + id);
  expect(row.history.map((h) => h.status)).toEqual([
    'sent',
    'received',
    'scheduled',
    'fixed',
    'closed',
    'sent',
  ]);
  expect(row.schoolReference).toBe('A123');
  expect(row.history.every((h) => Number.isFinite(h.at))).toBe(true);
});
test('feature gate, school membership, service domain and building enforced', async () => {
  const { call, data } = fixture();
  await expect(call('outsider', repair)).rejects.toMatchObject({ code: 'permission-denied' });
  const { id } = await call('student', { ...repair, building: 'B' });
  await expect(
    call('staff', { action: 'repairStatus', id, status: 'received' }),
  ).rejects.toMatchObject({ code: 'permission-denied' });
  await expect(call('student', { action: 'workspace' })).rejects.toMatchObject({
    code: 'permission-denied',
  });
  data.set('schools/pu', {});
  expect(await call('student', { action: 'config' })).toMatchObject({ enabled: false });
  await expect(call('student', repair)).rejects.toMatchObject({ code: 'failed-precondition' });
});
test('leave is owner-only, requires one staff decision and validates real dates', async () => {
  const { call, data } = fixture();
  data.set('schools/pu/dormResidents/123', {
    userId: 'student',
    building: 'A',
    room: '101',
    active: true,
  });
  const request = {
    action: 'requestLeave',
    key: 'leave1',
    building: 'A',
    room: '101',
    date: '2099-01-01',
    reason: '返家',
  };
  await expect(call('student', { ...request, date: '2099-02-30' })).rejects.toMatchObject({
    code: 'invalid-argument',
  });
  const { id } = await call('student', request);
  await expect(
    call('student', { action: 'decideLeave', id, status: 'approved' }),
  ).rejects.toMatchObject({ code: 'permission-denied' });
  await call('staff', { action: 'decideLeave', id, status: 'approved' });
  await expect(
    call('staff', { action: 'decideLeave', id, status: 'rejected' }),
  ).rejects.toMatchObject({ code: 'failed-precondition' });
  expect((await call('student', { action: 'mine' })).leaves[0].status).toBe('approved');
  expect((await call('staff', { action: 'mine' })).leaves).toEqual([]);
});
test('packages require roster, retry is idempotent, all waiting packages are collected', async () => {
  const { call, data } = fixture();
  const request = {
    action: 'registerPackage',
    studentId: '123',
    key: 'p1',
    description: '書',
    location: '服務台',
  };
  await expect(call('staff', request)).rejects.toMatchObject({ code: 'failed-precondition' });
  await call('staff', {
    action: 'importResidents',
    rows: [{ studentId: '123', building: 'A', room: '101', bed: '1' }],
  });
  const { id } = await call('staff', request);
  await call('staff', request);
  expect([...data.keys()].filter((k) => k.includes('/packages/'))).toHaveLength(1);
  await call('staff', { action: 'collectPackages', studentId: '123' });
  expect(data.get('schools/pu/packages/' + id).status).toBe('picked_up');
});
test('batch pickup selects only waiting parcels in authorized buildings after a student moves', async () => {
  const { call, data, db } = fixture();
  data.get('schools/pu/dormStaffRoles/staff').buildings = ['B'];
  const parcels = {
    historical: { studentId: '123', building: 'A', status: 'picked_up' },
    oldWaiting: { studentId: '123', building: 'A', status: 'waiting' },
    current: { studentId: '123', building: 'B', status: 'waiting' },
    returned: { studentId: '123', building: 'B', status: 'returned' },
    otherStudent: { studentId: '456', building: 'B', status: 'waiting' },
  };
  for (const [id, row] of Object.entries(parcels)) {
    data.set('schools/pu/dormPackages/' + id, { ...row, location: '服務台' });
    data.set('schools/pu/packages/' + id, { recipientId: 'student', status: row.status });
  }
  const read = jest.fn();
  const runTransaction = db.runTransaction;
  db.runTransaction = (fn) =>
    runTransaction((tx) =>
      fn({
        ...tx,
        get: (ref) => {
          read(ref.path);
          return tx.get(ref);
        },
      }),
    );
  await expect(call('staff', { action: 'collectPackages', studentId: '123' })).resolves.toEqual({
    success: true,
  });
  expect(read.mock.calls).toEqual([['schools/pu/dormPackages/current']]);
  for (const [id, row] of Object.entries(parcels)) {
    const status = id === 'current' ? 'picked_up' : row.status;
    for (const collection of ['dormPackages', 'packages'])
      expect(data.get(`schools/pu/${collection}/${id}`).status).toBe(status);
  }
});

test.each([
  [{ status: 'picked_up' }, null],
  [{ status: 'returned' }, null],
  [{ building: 'B' }, 'permission-denied'],
])(
  'batch pickup rechecks concurrent parcel change %j inside the transaction',
  async (change, code) => {
    const { call, data, db } = fixture();
    const path = 'schools/pu/dormPackages/current';
    data.set(path, { studentId: '123', building: 'A', status: 'waiting', location: '服務台' });
    data.set('schools/pu/packages/current', { recipientId: 'student', status: 'waiting' });
    const runTransaction = db.runTransaction;
    const update = jest.fn();
    db.runTransaction = (fn) => {
      data.set(path, { ...data.get(path), ...change });
      return runTransaction((tx) => fn({ ...tx, update }));
    };
    const result = call('staff', { action: 'collectPackages', studentId: '123' });
    if (code) await expect(result).rejects.toMatchObject({ code });
    else await expect(result).resolves.toEqual({ success: true });
    expect(update).not.toHaveBeenCalled();
    expect(data.get(path)).toMatchObject(change);
    expect(data.get('schools/pu/packages/current').status).toBe('waiting');
  },
);

test('push failure does not report a committed ticket transition as failed', async () => {
  const { call, sendPushToUser } = fixture();
  const { id } = await call('student', repair);
  sendPushToUser.mockRejectedValue(new Error('unavailable'));
  await expect(
    call('staff', { action: 'repairStatus', id, status: 'received' }),
  ).resolves.toMatchObject({ success: true });
});
test('student cannot advance staff steps or alter legacy memos', () => {
  expect(transition('sent', 'received', true)).toBe(false);
  expect(transition('fixed', 'closed', true)).toBe(true);
  expect(transition('closed', 'sent', true)).toBe(true);
});
test('admin changes only dorm domains, records audit and cannot grant to another school', async () => {
  const { call, data } = fixture();
  data.set('users/staff', { displayName: '輔導員' });
  data.set('schools/pu/serviceRoles/staff', {
    status: 'active',
    orders: true,
    repairs: true,
    packages: true,
  });
  await call('admin', {
    action: 'setStaff',
    targetUid: 'staff',
    packages: false,
    repairs: false,
    buildings: [],
  });
  expect(data.get('schools/pu/serviceRoles/staff')).toMatchObject({
    orders: true,
    repairs: true,
    packages: true,
  });
  expect([...data.keys()].some((k) => k.includes('/adminLogs/'))).toBe(true);
  await expect(
    call('admin', {
      action: 'setStaff',
      targetUid: 'outsider',
      packages: true,
      repairs: true,
      buildings: ['A'],
    }),
  ).rejects.toMatchObject({ code: 'permission-denied' });
});
test('building announcements reach only roster residents and remain available to them', async () => {
  const { call, data, sendPushToUser } = fixture();
  data.set('schools/pu/dormResidents/123', {
    userId: 'student',
    studentId: '123',
    building: 'A',
    room: '101',
    bed: '1',
  });
  data.set('schools/pu/dormResidents/456', { userId: 'other', studentId: '456', building: 'B' });
  await call('staff', { action: 'announce', building: 'A', title: '停水', body: '明日施工' });
  expect(sendPushToUser).toHaveBeenCalledTimes(1);
  expect(sendPushToUser.mock.calls[0][0]).toBe('student');
  expect((await call('student', { action: 'mine' })).announcements).toHaveLength(1);
  expect((await call('staff', { action: 'mine' })).announcements).toHaveLength(0);
});

test('removing a resident preserves the record but blocks new packages and building announcements', async () => {
  const { call, data } = fixture();
  data.set('schools/pu/dormResidents/123', {
    userId: 'student',
    studentId: '123',
    building: 'A',
    room: '101',
    bed: '1',
  });
  await call('staff', { action: 'deactivateResident', studentId: '123' });
  expect(data.get('schools/pu/dormResidents/123').active).toBe(false);
  expect((await call('staff', { action: 'workspace' })).residents).toEqual([]);
  await expect(
    call('staff', {
      action: 'registerPackage',
      studentId: '123',
      key: 'p1',
      description: '書',
      location: '服務台',
    }),
  ).rejects.toMatchObject({ code: 'failed-precondition' });
});

test.each([false, true])(
  'roster import cannot overwrite another building, including inactive residents (%s)',
  async (inactive) => {
    const { call, data } = fixture();
    const original = {
      studentId: '123',
      userId: 'student',
      building: 'B',
      room: '201',
      active: !inactive,
    };
    data.set('schools/pu/dormResidents/123', original);
    const rows = [{ studentId: '123', building: 'A', room: '101', bed: '1' }];
    await expect(call('staff', { action: 'importResidents', rows })).rejects.toMatchObject({
      code: 'permission-denied',
    });
    expect(data.get('schools/pu/dormResidents/123')).toEqual(original);
    expect((await call('staff', { action: 'workspace' })).residents).toEqual([]);
    await call('admin', { action: 'importResidents', rows });
    expect(data.get('schools/pu/dormResidents/123')).toMatchObject({ building: 'A', active: true });
  },
);

test('staff can update own building but even multi-building staff cannot transfer residents', async () => {
  const { call, data } = fixture();
  const rows = [{ studentId: '123', building: 'A', room: '102', bed: '2' }];
  await call('staff', { action: 'importResidents', rows });
  await call('staff', { action: 'importResidents', rows: [{ ...rows[0], room: '103' }] });
  expect(data.get('schools/pu/dormResidents/123').room).toBe('103');
  data.get('schools/pu/dormStaffRoles/staff').buildings = ['A', 'B'];
  await expect(
    call('staff', { action: 'importResidents', rows: [{ ...rows[0], building: 'B' }] }),
  ).rejects.toMatchObject({ code: 'permission-denied' });
});

test.each(['active', 'inactive'])(
  'dorm grants preserve effective non-dorm access for %s records',
  async (status) => {
    const { call, data } = fixture();
    data.set('users/staff', { displayName: '輔導員' });
    const before = { status, orders: true, printing: true, health: true, customMetadata: 'keep' };
    data.set('schools/pu/serviceRoles/staff', before);
    await call('admin', {
      action: 'setStaff',
      targetUid: 'staff',
      packages: true,
      repairs: false,
      buildings: ['A'],
    });
    const after = data.get('schools/pu/serviceRoles/staff');
    for (const domain of ['orders', 'printing', 'health'])
      expect(hasServiceDomainAccess(after, domain)).toBe(hasServiceDomainAccess(before, domain));
    expect(after.customMetadata).toBe('keep');
    expect(after).toEqual(before);
    expect(hasServiceDomainAccess(after, 'packages')).toBe(false);
    expect(await call('staff', { action: 'config' })).toMatchObject({
      packages: true,
      repairs: false,
    });
    await call('admin', {
      action: 'setStaff',
      targetUid: 'staff',
      packages: false,
      repairs: false,
      buildings: [],
    });
    const revoked = data.get('schools/pu/serviceRoles/staff');
    expect(revoked).toEqual(before);
    expect(await call('staff', { action: 'config' })).toMatchObject({
      packages: false,
      repairs: false,
    });
    for (const domain of ['orders', 'printing', 'health'])
      expect(hasServiceDomainAccess(revoked, domain)).toBe(hasServiceDomainAccess(before, domain));
    expect(hasServiceDomainAccess(revoked, 'packages')).toBe(false);
  },
);

test('disabled schools retain only the signed-in member history and reject mutations', async () => {
  const { call, data } = fixture();
  const { id } = await call('student', repair);
  await call('staff', { action: 'repairStatus', id, status: 'received' });
  data.set('schools/pu', { dormWorkflowEnabled: false });
  expect((await call('student', { action: 'mine' })).repairs.map((r) => r.id)).toEqual([id]);
  expect((await call('staff', { action: 'mine' })).repairs).toEqual([]);
  await expect(
    call('student', { action: 'repairStatus', id, status: 'sent' }),
  ).rejects.toMatchObject({ code: 'failed-precondition' });
  await expect(call('staff', { action: 'workspace' })).rejects.toMatchObject({
    code: 'failed-precondition',
  });
});
test('scoped grants and personal data never enter legacy school-wide access paths', async () => {
  const { call, data } = fixture();
  data.set('users/staff', { displayName: '輔導員' });
  await call('admin', {
    action: 'setStaff',
    targetUid: 'staff',
    packages: true,
    repairs: true,
    buildings: ['A'],
  });
  expect(data.has('schools/pu/serviceRoles/staff')).toBe(false);
  await call('student', repair);
  expect([...data.keys()].some((k) => k.includes('/repairRequests/'))).toBe(false);
  await call('staff', {
    action: 'importResidents',
    rows: [{ studentId: '123', building: 'A', room: '101', bed: '1' }],
  });
  const { id } = await call('staff', {
    action: 'registerPackage',
    key: 'private',
    studentId: '123',
    description: '書',
    location: '服務台',
  });
  expect(data.get('schools/pu/dormPackages/' + id)).toMatchObject({
    studentId: '123',
    building: 'A',
  });
  expect(data.get('schools/pu/packages/' + id)).not.toHaveProperty('studentId');
  expect(data.get('schools/pu/packages/' + id)).not.toHaveProperty('building');
  data.set('schools/pu/dormPackages/other', { studentId: '456', building: 'B', status: 'waiting' });
  data.set('schools/pu/dormRepairs/other', {
    userId: 'other',
    building: 'B',
    workflow: 'dorm_staff',
  });
  const workspace = await call('staff', { action: 'workspace' });
  expect(workspace.packages).toHaveLength(1);
  expect(workspace.packages[0].id).toMatch(/^dw_/);
  await call('staff', { action: 'returnPackage', id: workspace.packages[0].id });
  expect(workspace.repairs).toHaveLength(1);
  await expect(call('staff', { action: 'returnPackage', id: 'other' })).rejects.toMatchObject({
    code: 'permission-denied',
  });
});

test('legacy pickup atomically updates both feeds and prevents staff return', async () => {
  const { confirmPackagePickup } = require('./packagePickup');
  const { call, data, db } = fixture();
  data.set('schools/pu/dormResidents/123', {
    studentId: '123',
    userId: 'student',
    building: 'A',
    room: '101',
    active: true,
  });
  const { id } = await call('staff', {
    action: 'registerPackage',
    studentId: '123',
    key: 'pickup',
    description: '書',
    location: 'A櫃台',
  });
  const runTransaction = jest.spyOn(db, 'runTransaction');
  await confirmPackagePickup({ db, schoolId: 'pu', packageId: id, uid: 'student' });
  expect(runTransaction).toHaveBeenCalledTimes(1);
  for (const collection of ['packages', 'dormPackages'])
    expect(data.get(`schools/pu/${collection}/${id}`).status).toBe('picked_up');
  expect((await call('staff', { action: 'workspace' })).packages).toEqual([]);
  const workspace = await call('staff', { action: 'workspace', includeHistory: true });
  expect(workspace.packages[0].status).toBe('picked_up');
  await call('staff', { action: 'returnPackage', id });
  expect(data.get(`schools/pu/dormPackages/${id}`).status).toBe('picked_up');
});
test('legacy pickup keeps recipient authorization and supports legacy-only parcels', async () => {
  const { confirmPackagePickup } = require('./packagePickup');
  const { data, db } = fixture();
  data.set('schools/pu/packages/legacy', { recipientId: 'student', status: 'waiting' });
  await expect(
    confirmPackagePickup({ db, schoolId: 'pu', packageId: 'legacy', uid: 'other' }),
  ).rejects.toMatchObject({ code: 'permission-denied' });
  expect(data.get('schools/pu/packages/legacy').status).toBe('waiting');
  await confirmPackagePickup({ db, schoolId: 'pu', packageId: 'legacy', uid: 'student' });
  expect(data.get('schools/pu/packages/legacy').status).toBe('picked_up');
  expect(data.has('schools/pu/dormPackages/legacy')).toBe(false);
});

const leaveRequest = {
  action: 'requestLeave',
  key: 'roster',
  date: '2099-01-01',
  reason: '返家',
  building: '偽造棟',
  room: '999',
};
test('leave uses server roster and rejects missing, inactive or ambiguous residence', async () => {
  const { call, data } = fixture();
  for (const active of [null, false]) {
    if (active === false)
      data.set('schools/pu/dormResidents/123', {
        userId: 'student',
        building: 'A',
        room: '101',
        active,
      });
    await expect(call('student', leaveRequest)).rejects.toMatchObject({
      code: 'failed-precondition',
    });
    expect(data.has('schools/pu/dormLeaves/student_roster')).toBe(false);
  }
  data.set('schools/pu/dormResidents/123', {
    userId: 'student',
    building: 'A',
    room: '101',
    active: true,
  });
  const { id } = await call('student', leaveRequest);
  expect(data.get('schools/pu/dormLeaves/' + id)).toMatchObject({ building: 'A', room: '101' });
  data.set('schools/pu/dormResidents/456', {
    userId: 'student',
    building: 'B',
    room: '201',
    active: true,
  });
  await expect(call('student', { ...leaveRequest, key: 'duplicate' })).rejects.toMatchObject({
    code: 'failed-precondition',
  });
});
test.each(['inactive', 'building', 'room', 'missing'])(
  'leave review rechecks residence: %s',
  async (change) => {
    const { call, data } = fixture();
    const path = 'schools/pu/dormResidents/123';
    const resident = { userId: 'student', building: 'A', room: '101', active: true };
    data.set(path, resident);
    const { id } = await call('student', leaveRequest);
    if (change === 'missing') data.delete(path);
    else
      data.set(path, {
        ...resident,
        ...(change === 'inactive' ? { active: false } : { [change]: 'B' }),
      });
    await expect(
      call('staff', { action: 'decideLeave', id, status: 'approved' }),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(data.get('schools/pu/dormLeaves/' + id).status).toBe('pending');
  },
);
test('returned legacy parcels retain pickup behavior, dorm parcels reject returned status in either feed', async () => {
  const { confirmPackagePickup } = require('./packagePickup');
  const { data, db } = fixture();
  data.set('schools/pu/packages/legacy', { recipientId: 'student', status: 'returned' });
  await confirmPackagePickup({ db, schoolId: 'pu', packageId: 'legacy', uid: 'student' });
  expect(data.get('schools/pu/packages/legacy').status).toBe('picked_up');
  for (const returnedFeed of ['packages', 'dormPackages']) {
    for (const feed of ['packages', 'dormPackages'])
      data.set(`schools/pu/${feed}/new`, {
        recipientId: 'student',
        status: feed === returnedFeed ? 'returned' : 'waiting',
      });
    await expect(
      confirmPackagePickup({ db, schoolId: 'pu', packageId: 'new', uid: 'student' }),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(data.get(`schools/pu/${returnedFeed}/new`).status).toBe('returned');
  }
});

test('roster identity uses server-owned membership and ignores forged or duplicate profile IDs', async () => {
  const { call, data } = fixture();
  data.set('users/forged', { studentId: '123', displayName: '冒用者' });
  data.set('schools/pu/members/forged', { role: 'student' });
  data.set('users/student', { studentId: 'edited', displayName: '自行修改' });
  await call('staff', {
    action: 'importResidents',
    rows: [{ studentId: '123', building: 'A', room: '101', bed: '1' }],
  });
  expect(data.get('schools/pu/dormResidents/123')).toMatchObject({
    userId: 'student',
    name: '同學',
  });
  data.delete('schools/pu/members/student');
  await expect(
    call('staff', {
      action: 'importResidents',
      rows: [{ studentId: '123', building: 'A', room: '102', bed: '1' }],
    }),
  ).rejects.toMatchObject({ code: 'failed-precondition' });
  expect(data.get('schools/pu/dormResidents/123').room).toBe('101');
});

test('duplicate verified membership IDs fail without partially importing the roster', async () => {
  const { call, data } = fixture();
  data.set('schools/pu/members/other', { role: 'student' });
  data.set('schools/pu/dormSsoIdentities/other', { studentId: '123' });
  await expect(
    call('staff', {
      action: 'importResidents',
      rows: [{ studentId: '123', building: 'A', room: '101', bed: '1' }],
    }),
  ).rejects.toMatchObject({ code: 'failed-precondition' });
  expect(data.has('schools/pu/dormResidents/123')).toBe(false);
});

test.each([
  [{ active: false }, 'failed-precondition'],
  [{ building: 'B' }, 'permission-denied'],
])(
  'parcel registration checks concurrent roster change %j inside transaction',
  async (change, code) => {
    const { call, data, db, sendPushToUser } = fixture();
    const residentPath = 'schools/pu/dormResidents/123';
    data.set(residentPath, { studentId: '123', userId: 'student', building: 'A', active: true });
    const runTransaction = db.runTransaction;
    db.runTransaction = async (fn) => {
      data.set(residentPath, { ...data.get(residentPath), ...change });
      return runTransaction(fn);
    };
    await expect(
      call('staff', {
        action: 'registerPackage',
        studentId: '123',
        key: 'race',
        description: '書',
        location: '服務台',
      }),
    ).rejects.toMatchObject({ code });
    expect([...data.keys()].some((path) => /\/(dormPackages|packages)\//.test(path))).toBe(false);
    expect(sendPushToUser).not.toHaveBeenCalled();
  },
);

test('parcel transaction retry notifies only the committed recipient and keeps retries idempotent', async () => {
  const { call, data, db, sendPushToUser } = fixture();
  const residentPath = 'schools/pu/dormResidents/123';
  data.set(residentPath, { studentId: '123', userId: 'student', building: 'A', active: true });
  const runTransaction = db.runTransaction;
  db.runTransaction = async (fn) => {
    // Simulate a Firestore attempt aborted by a concurrent resident rebind.
    await runTransaction((tx) => fn({ ...tx, create: () => {} }));
    data.set(residentPath, { ...data.get(residentPath), userId: 'new-student' });
    return runTransaction(fn);
  };
  const request = {
    action: 'registerPackage',
    studentId: '123',
    key: 'race',
    description: '書',
    location: '服務台',
  };
  const { id } = await call('staff', request);
  expect(data.get('schools/pu/dormPackages/' + id).recipientId).toBe('new-student');
  expect(data.get('schools/pu/packages/' + id).recipientId).toBe('new-student');
  expect(sendPushToUser).toHaveBeenCalledTimes(1);
  expect(sendPushToUser.mock.calls[0][0]).toBe('new-student');
  db.runTransaction = runTransaction;
  data.get(residentPath).active = false;
  await call('staff', request);
  expect(sendPushToUser).toHaveBeenCalledTimes(1);
});

test.each([false, true])(
  'verified general SSO identity supports roster import (existing=%s)',
  async (existing) => {
    const { createSchoolLoginProfileWriter } = require('./schoolLoginProfile');
    const { writeDormSsoIdentity } = require('./dormSsoIdentity');
    const { call, data, db } = fixture();
    data.delete('schools/pu/members/student');
    data.delete('schools/pu/dormSsoIdentities/student');
    if (existing) data.set('schools/pu/members/student', { role: 'member', status: 'active' });
    data.set('users/student', { studentId: 'forged', displayName: '自行修改' });
    const input = {
      action: 'importResidents',
      rows: [{ studentId: '123', building: 'A', room: '101', bed: '1' }],
    };
    await expect(call('staff', input)).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(data.has('schools/pu/dormResidents/123')).toBe(false);
    const writer = createSchoolLoginProfileWriter({ db });
    await writer({
      uid: 'student',
      schoolId: 'pu',
      profile: { role: 'student', displayName: '校方姓名' },
    });
    await writeDormSsoIdentity({
      db,
      uid: 'student',
      schoolId: 'pu',
      userInfo: { studentId: '123', name: '校方姓名' },
    });
    expect(data.get('schools/pu/members/student')).not.toHaveProperty('studentId');
    expect(data.get('schools/pu/members/student')).not.toHaveProperty('displayName');
    await call('staff', input);
    expect(data.get('schools/pu/dormResidents/123')).toMatchObject({
      userId: 'student',
      name: '校方姓名',
    });
    const workspace = await call('staff', { action: 'workspace' });
    expect(workspace.residents.filter((r) => r.name.includes('校方姓名'))).toHaveLength(1);
    await call('student', {
      action: 'requestLeave',
      date: '2099-01-01',
      reason: '返家',
      key: 'sso-leave',
    });
    expect([...data.keys()].some((k) => k.startsWith('schools/pu/dormLeaves/'))).toBe(true);
  },
);

test('SSO mapping replaces missing or malformed claims without exposing them in membership', async () => {
  const { writeDormSsoIdentity } = require('./dormSsoIdentity');
  const { db, data } = fixture();
  for (const userInfo of [
    {},
    { studentId: '../forged' },
    { employee_id: ' E123 ', displayName: ' 校方姓名 ' },
  ]) {
    await writeDormSsoIdentity({ db, uid: 'student', schoolId: 'pu', userInfo });
    expect(data.get('schools/pu/dormSsoIdentities/student')).toEqual({
      studentId: userInfo.employee_id ? 'E123' : null,
      displayName: userInfo.employee_id ? '校方姓名' : '',
    });
    expect(data.get('schools/pu/members/student')).not.toHaveProperty('studentId');
  }
});

test.each([
  undefined,
  {},
  { status: 'active', packages: true, repairs: true },
  { status: 'active', packages: true, repairs: true, buildings: [] },
])(
  'shared service permissions never grant dorm access without explicit building scope: %j',
  async (dormRoles) => {
    const { call, data } = fixture();
    const legacy = { status: 'active', repairs: true, packages: true };
    data.set('schools/pu/serviceRoles/staff', legacy);
    data.delete('schools/pu/dormStaffRoles/staff');
    if (dormRoles) data.set('schools/pu/dormStaffRoles/staff', dormRoles);
    expect(await call('staff', { action: 'config' })).toMatchObject({
      repairs: false,
      packages: false,
    });
    await expect(call('staff', { action: 'workspace' })).rejects.toMatchObject({
      code: 'permission-denied',
    });
    expect(data.get('schools/pu/serviceRoles/staff')).toEqual(legacy);
    expect(hasServiceDomainAccess(legacy, 'packages')).toBe(true);
  },
);

test('dorm grants require buildings while school administrators retain access', async () => {
  const { call } = fixture();
  await expect(
    call('admin', { action: 'setStaff', targetUid: 'staff', packages: true, buildings: [] }),
  ).rejects.toMatchObject({ code: 'invalid-argument' });
  expect(await call('admin', { action: 'workspace' })).toHaveProperty('residents');
});

test('readable member profile IDs cannot establish a dorm roster identity', async () => {
  const { call, data } = fixture();
  data.delete('schools/pu/dormSsoIdentities/student');
  data.set('schools/pu/members/student', {
    role: 'member',
    studentId: '123',
    displayName: '非隔離映射',
  });
  await expect(
    call('staff', {
      action: 'importResidents',
      rows: [{ studentId: '123', building: 'A', room: '101', bed: '1' }],
    }),
  ).rejects.toMatchObject({ code: 'failed-precondition' });
  expect(data.has('schools/pu/dormResidents/123')).toBe(false);
});

test('enabled dorm import lazily resolves verified links, without trusting user profiles', async () => {
  const { call, data } = fixture();
  data.delete('schools/pu/dormSsoIdentities/student');
  data.set('ssoLinks/pu_verified', {
    schoolId: 'pu',
    firebaseUid: 'student',
    studentId: '123',
    name: '校方姓名',
  });
  data.set('ssoLinks/other_verified', {
    schoolId: 'other',
    firebaseUid: 'outsider',
    studentId: '123',
  });
  await call('staff', {
    action: 'importResidents',
    rows: [{ studentId: '123', building: 'A', room: '101', bed: '1' }],
  });
  expect(data.get('schools/pu/dormResidents/123')).toMatchObject({
    userId: 'student',
    name: '校方姓名',
  });
  expect(data.has('schools/pu/dormSsoIdentities/outsider')).toBe(false);
});
test('disabled dorm features never resolve SSO identity and sync failures stay in dorm', async () => {
  const { call, data, db, queries } = fixture();
  data.set('schools/pu', { dormWorkflowEnabled: false });
  await call('student', { action: 'config' });
  await call('student', { action: 'mine' });
  await expect(call('staff', { action: 'importResidents', rows: [] })).rejects.toMatchObject({
    code: 'failed-precondition',
  });
  expect(queries.some((q) => q.path === 'ssoLinks')).toBe(false);
  data.set('schools/pu', { dormWorkflowEnabled: true });
  data.set('ssoLinks/pu_verified', { schoolId: 'pu', firebaseUid: 'student', studentId: '123' });
  db.runTransaction = jest.fn().mockRejectedValue(new Error('dorm sync unavailable'));
  await expect(
    call('staff', {
      action: 'importResidents',
      rows: [{ studentId: '123', building: 'A', room: '101', bed: '1' }],
    }),
  ).rejects.toThrow('dorm sync unavailable');
  await expect(call('student', { action: 'config' })).resolves.toMatchObject({ enabled: true });
});
test('workspace queries authorized buildings and statuses with stable bounded cursor pages', async () => {
  const { call, data, queries } = fixture();
  for (let i = 0; i < 120; i++)
    data.set('schools/pu/dormLeaves/leave' + String(i).padStart(3, '0'), {
      userId: 'student',
      building: i < 60 ? 'A' : 'B',
      room: '101',
      status: 'pending',
      createdAt: 1,
    });
  data.set('schools/pu/dormResidents/123456', {
    userId: 'student',
    studentId: '123456',
    name: '王同學',
    building: 'A',
    updatedAt: 1,
  });
  const first = await call('staff', { action: 'workspace' });
  expect(first.leaves).toHaveLength(50);
  expect(first.leaves[0]).toMatchObject({ applicantName: '王同學', maskedStudentId: '***456' });
  expect(first.leaves[0]).not.toHaveProperty('studentId');
  const second = await call('staff', { action: 'workspace', cursors: first.nextCursors });
  expect(second.leaves).toHaveLength(10);
  expect(new Set([...first.leaves, ...second.leaves].map((r) => r.id)).size).toBe(60);
  for (const query of queries.filter((q) => q.orders.length)) {
    expect(query.filters).toContainEqual(['building', '==', 'A']);
    expect(query.max).toBe(51);
    expect(query.orders.at(-1)).toEqual(['__name__', 'desc']);
    if (!query.path.endsWith('/dormResidents'))
      expect(query.filters.some(([f, op]) => f === 'status' && op === 'in')).toBe(true);
  }
  expect(second.nextCursors[JSON.stringify(['dormLeaves', 'A'])]).toBeNull();
});

test('workspace supports multiple authorized buildings and rejects out-of-scope cursors', async () => {
  const { call, data } = fixture();
  data.get('schools/pu/dormStaffRoles/staff').buildings = ['A', 'B'];
  for (const building of ['A', 'B', 'C'])
    data.set('schools/pu/dormPackages/' + building, {
      building,
      status: 'waiting',
      arrivedAt: 1,
    });
  const result = await call('staff', { action: 'workspace' });
  expect(result.packages.map((r) => r.building)).toEqual(['A', 'B']);
  await expect(
    call('staff', {
      action: 'workspace',
      cursors: {
        [JSON.stringify(['dormPackages', 'A'])]: 'C',
      },
    }),
  ).rejects.toMatchObject({ code: 'invalid-argument' });
  expect((await call('admin', { action: 'workspace' })).packages).toHaveLength(3);
});

test('workspace defaults to actionable statuses and keeps history available explicitly', async () => {
  const { call, data, queries } = fixture();
  for (const status of ['waiting', 'picked_up', 'returned'])
    data.set('schools/pu/dormPackages/' + status, {
      building: 'A',
      status,
      arrivedAt: 1,
    });
  expect((await call('staff', { action: 'workspace' })).packages.map((r) => r.status)).toEqual([
    'waiting',
  ]);
  expect(queries.find((q) => q.path.endsWith('/dormPackages')).filters).toContainEqual([
    'status',
    'in',
    ['waiting'],
  ]);
  expect(
    (await call('staff', { action: 'workspace', includeHistory: true })).packages,
  ).toHaveLength(3);
});

// Execute the real legacy PU profile wrapper and profile writer before importing.
test('legacy PU login data can import a resident without ssoLinks or login changes', async () => {
  const fs = require('node:fs');
  const vm = require('node:vm');
  const { createSchoolLoginProfileWriter } = require('./schoolLoginProfile');
  const { call, data, db } = fixture();
  data.delete('schools/pu/dormSsoIdentities/student');
  const source = fs.readFileSync(require.resolve('./index'), 'utf8');
  const start = source.indexOf('async function upsertPuStudentProfile(');
  const end = source.indexOf('async function provisionUniversalDevAccount(', start);
  const upsert = vm.runInNewContext(source.slice(start, end) + '; upsertPuStudentProfile', {
    writeSchoolLoginProfile: createSchoolLoginProfileWriter({ db }),
    PROVIDENCE_UNIVERSITY_SCHOOL_ID: 'pu',
  });
  await upsert({
    uid: 'pu-123',
    studentId: '123',
    displayName: '校方姓名',
    email: '123@pu.edu.tw',
  });
  await call('staff', {
    action: 'importResidents',
    rows: [{ studentId: '123', building: 'A', room: '101', bed: '1' }],
  });
  expect(data.get('schools/pu/dormResidents/123')).toMatchObject({
    userId: 'pu-123',
    name: '校方姓名',
  });
  const result = await call('pu-123', {
    action: 'requestLeave',
    key: 'leave',
    date: '2099-01-01',
    reason: '返家',
  });
  expect(result.success).toBe(true);
  await call('staff', {
    action: 'registerPackage',
    key: 'parcel',
    studentId: '123',
    description: '包裹',
    location: '管理室',
  });
  expect(
    [...data.entries()].find(([path]) => path.startsWith('schools/pu/dormPackages/'))[1]
      .recipientId,
  ).toBe('pu-123');
});

test.each(['deleted', 'deleting'])(
  'closing accounts cannot recreate verified mappings or accept parcels (%s)',
  async (status) => {
    const { call, data } = fixture();
    data.delete('schools/pu/dormSsoIdentities/student');
    data.set(
      'users/student',
      status === 'deleted' ? { status } : { accountDeletionInProgress: true },
    );
    data.set('ssoLinks/verified', { schoolId: 'pu', firebaseUid: 'student', studentId: '123' });
    await expect(
      call('staff', {
        action: 'importResidents',
        rows: [{ studentId: '123', building: 'A', room: '101', bed: '1' }],
      }),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(data.has('schools/pu/dormSsoIdentities/student')).toBe(false);
    data.set('schools/pu/dormResidents/123', {
      studentId: '123',
      userId: 'student',
      building: 'A',
      active: true,
    });
    await expect(
      call('staff', {
        action: 'registerPackage',
        key: 'closing',
        studentId: '123',
        description: '包裹',
        location: '管理室',
      }),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(data.has('schools/pu/dormPackages/staff_closing')).toBe(false);
  },
);

test.each([
  { studentId: '123', status: 'active' },
  { studentId: '456', status: 'active', lastLoginAt: 1 },
  { studentId: '123', status: 'inactive', lastLoginAt: 1 },
])('legacy PU mapping rejects a membership without matching login evidence: %j', async (member) => {
  const { call, data } = fixture();
  data.delete('schools/pu/dormSsoIdentities/student');
  data.set('schools/pu/members/pu-123', member);
  data.set('users/pu-123', { studentId: '123' });
  await expect(
    call('staff', {
      action: 'importResidents',
      rows: [{ studentId: '123', building: 'A', room: '101', bed: '1' }],
    }),
  ).rejects.toMatchObject({ code: 'failed-precondition' });
  expect(data.has('schools/pu/dormResidents/123')).toBe(false);
});

test('closing accounts cannot recreate private repair or leave records while cleanup runs', async () => {
  const { call, data } = fixture();
  data.set('users/student', { accountDeletionInProgress: true });
  for (const input of [
    repair,
    { action: 'requestLeave', key: 'leave', date: '2099-01-01', reason: '返家' },
  ])
    await expect(call('student', input)).rejects.toMatchObject({ code: 'failed-precondition' });
  expect([...data.keys()].some((key) => /\/dorm(Repairs|Leaves)\//.test(key))).toBe(false);
});

test('repair-only workspace omits identity metadata from rows, history and cursors', async () => {
  const { call, data } = fixture();
  data.set('schools/pu/dormStaffRoles/staff', {
    status: 'active',
    repairs: true,
    buildings: ['A'],
  });
  for (let i = 0; i < 51; i++)
    data.set(`schools/pu/dormLeaves/pu-123456_${i}`, {
      userId: 'pu-123456',
      building: 'A',
      room: '101',
      status: 'pending',
      createdAt: i,
      applicantName: '王同學',
      maskedStudentId: '***456',
      studentId: '123456',
      reviewedBy: 'pu-654321',
      history: [{ status: 'pending', at: 1, actor: 'pu-123456' }],
    });
  const result = await call('staff', { action: 'workspace' });
  const json = JSON.stringify(result);
  expect(json).not.toMatch(/123456|654321|userId|studentId|reviewedBy|actor/);
  expect(result.leaves).toHaveLength(50);
  expect(result.leaves[0].id).toMatch(/^dw_/);
  expect(
    (await call('staff', { action: 'workspace', cursors: result.nextCursors })).leaves,
  ).toHaveLength(1);
});

test.each([undefined, 'old123'])(
  'explicit dorm identity refresh repairs legacy SSO link studentId=%s',
  async (oldId) => {
    const { call, data, db } = fixture();
    data.delete('schools/pu/dormSsoIdentities/student');
    data.set('ssoLinks/pu_verified', { schoolId: 'pu', firebaseUid: 'student', studentId: oldId });
    // Explicit dorm identity operation, never executed by the login callback.
    await require('./dormSsoIdentity').refreshDormSsoIdentity({
      db,
      uid: 'student',
      schoolId: 'pu',
      userInfo: { studentId: 'new123', name: '校方姓名' },
    });
    await call('staff', {
      action: 'importResidents',
      rows: [{ studentId: 'new123', building: 'A', room: '101', bed: '1' }],
    });
    expect(data.get('schools/pu/dormResidents/new123').userId).toBe('student');
    if (oldId)
      await expect(
        call('staff', {
          action: 'importResidents',
          rows: [{ studentId: oldId, building: 'A', room: '101', bed: '1' }],
        }),
      ).rejects.toMatchObject({ code: 'failed-precondition' });
  },
);

test('opaque workspace repair handles keep staff transitions and student history connected', async () => {
  const { call, data } = fixture();
  const original = await call('student', repair);
  const workspace = await call('staff', { action: 'workspace' });
  const handle = workspace.repairs[0].id;
  expect(handle).not.toBe(original.id);
  await call('staff', { action: 'repairStatus', id: handle, status: 'received' });
  expect(data.get(`schools/pu/dormRepairs/${original.id}`).dormStatus).toBe('received');
  expect((await call('student', { action: 'mine' })).repairs[0].id).toBe(original.id);
  expect((await call('staff', { action: 'workspace' })).repairs[0].id).toBe(handle);
});

test('whole workspace and roster cursors contain masked identities only, scoped to authorized buildings', async () => {
  const { call, data } = fixture();
  for (let n = 0; n < 51; n++) {
    const studentId = 'SYNTHETIC' + String(100000 + n);
    data.set('schools/pu/dormResidents/' + studentId, {
      studentId,
      userId: 'pu-' + studentId,
      name: '合成同學',
      building: 'A',
      room: '101',
      bed: '1',
      grade: 'SECRET_GRADE',
      updatedAt: n,
    });
  }
  data.set('schools/pu/dormResidents/OTHER999999', {
    studentId: 'OTHER999999',
    name: '別棟同學',
    building: 'B',
    updatedAt: 100,
  });
  data.set('schools/pu/dormPackages/pu-SYNTHETIC100000_legacy', {
    studentId: 'SYNTHETIC100000',
    recipientId: 'pu-SYNTHETIC100000',
    building: 'A',
    status: 'waiting',
    arrivedAt: 1,
    grade: 'SECRET_GRADE',
  });
  const first = await call('staff', { action: 'workspace' });
  const second = await call('staff', { action: 'workspace', cursors: first.nextCursors });
  expect(first.residents).toHaveLength(50);
  expect(second.residents).toHaveLength(1);
  expect(JSON.stringify([first, second])).not.toMatch(
    /SYNTHETIC|OTHER999999|SECRET_GRADE|別棟同學/,
  );
  expect(
    first.residents.every((r) => r.id.startsWith('dw_') && /^\*\*\*\d{3}$/.test(r.studentId)),
  ).toBe(true);
  await call('staff', { action: 'deactivateResident', studentId: second.residents[0].id });
  expect([...data.values()].filter((r) => r.active === false)).toHaveLength(1);
  await expect(call('student', { action: 'workspace' })).rejects.toMatchObject({
    code: 'permission-denied',
  });
});

test('student mine never returns staff identity, another student, grade or storage URL', async () => {
  const { call, data } = fixture();
  data.set('schools/pu/dormRepairs/own', {
    userId: 'student',
    workflow: 'dorm_staff',
    building: 'A',
    images: ['https://example.invalid/pu-OTHER123456/photo'],
    grade: 'PRIVATE_GRADE',
    updatedBy: 'pu-STAFF654321',
    history: [{ status: 'sent', at: 1, actor: 'pu-STAFF654321' }],
  });
  data.set('schools/pu/dormRepairs/other', {
    userId: 'other',
    workflow: 'dorm_staff',
    title: 'PRIVATE_OTHER',
    grade: 'PRIVATE_GRADE',
  });
  data.set('schools/pu/dormLeaves/own', {
    userId: 'student',
    reviewedBy: 'pu-STAFF654321',
    history: [{ status: 'approved', at: 1, actor: 'pu-STAFF654321' }],
  });
  data.set('schools/pu/dormResidents/123', { userId: 'student', building: 'A' });
  data.set('schools/pu/dormAnnouncements/a', {
    building: 'A',
    title: '公告',
    body: '內容',
    createdBy: 'pu-STAFF654321',
    grade: 'PRIVATE_GRADE',
  });
  const result = await call('student', { action: 'mine' });
  expect(result.repairs).toHaveLength(1);
  expect(result.repairs[0].images).toEqual(['0']);
  expect(JSON.stringify(result)).not.toMatch(
    /OTHER|STAFF|PRIVATE|https|reviewedBy|actor|createdBy/,
  );
});

test('random parcel documents and legacy parcel documents both remain operable', async () => {
  const { call, data, queries } = fixture();
  data.set('schools/pu/dormResidents/SYNTHETIC123456', {
    studentId: 'SYNTHETIC123456',
    userId: 'student',
    building: 'A',
    active: true,
  });
  const input = {
    action: 'registerPackage',
    key: 'parcel',
    studentId: 'SYNTHETIC123456',
    description: '合成包裹',
    location: '服務台',
  };
  const result = await call('staff', input);
  expect(result.id).toMatch(/^[0-9a-f-]{36}$/);
  expect(await call('staff', input)).toEqual(result);
  expect([...data.keys()].filter((k) => k.includes('/dormPackages/'))).toHaveLength(1);
  const legacy = 'pu-SYNTHETIC987654_old';
  data.set('schools/pu/dormPackages/' + legacy, {
    studentId: 'SYNTHETIC123456',
    recipientId: 'student',
    building: 'A',
    status: 'waiting',
    location: '服務台',
    arrivedAt: 0,
  });
  data.set('schools/pu/packages/' + legacy, { recipientId: 'student', status: 'waiting' });
  const workspace = await call('staff', { action: 'workspace' });
  expect(workspace.packages).toHaveLength(2);
  expect(JSON.stringify(workspace)).not.toMatch(/SYNTHETIC/);
  await call('staff', { action: 'collectPackages', studentId: 'SYNTHETIC123456' });
  expect(data.get('schools/pu/dormPackages/' + legacy).status).toBe('picked_up');
  expect(queries.some((q) => q.filters.some(([f]) => f === 'studentId'))).toBe(true);
});

function photoBucket() {
  const objects = new Map();
  const signed = jest.fn(async () => ['https://signed.invalid/random']);
  const file = (path) => ({
    save: jest.fn(async (bytes, opts) => objects.set(path, { bytes, ...opts.metadata })),
    getMetadata: jest.fn(async () => [objects.get(path)]),
    setMetadata: jest.fn(async (patch) => objects.set(path, { ...objects.get(path), ...patch })),
    copy: jest.fn(async (target) =>
      target.save(Buffer.from('legacy'), { metadata: { contentType: 'image/jpeg' } }),
    ),
    getSignedUrl: signed,
  });
  return { name: 'synthetic-bucket', file, objects, signed };
}

test('repair photos use identity-free paths, validate upload ownership, and sign only for owner or authorized building staff', async () => {
  const bucket = photoBucket();
  const { call, data } = fixture({ getBucket: () => bucket });
  const upload = await call('student', {
    action: 'uploadPhoto',
    contentType: 'image/jpeg',
    base64: Buffer.from('synthetic image').toString('base64'),
  });
  expect(upload.path).toMatch(/^dorm-private\/[0-9a-f-]{36}$/);
  expect(upload.path).not.toMatch(/student|pu-/);
  expect(JSON.stringify(bucket.objects.get(upload.path))).not.toMatch(/student|userId|owner/);
  expect(data.get('schools/pu/dormPhotoUploads/' + upload.path.split('/')[1]).userId).toBe(
    'student',
  );
  const { id } = await call('student', { ...repair, images: [upload.path] });
  const staffId = (await call('staff', { action: 'workspace' })).repairs[0].id;
  expect((await call('staff', { action: 'repairPhoto', id: staffId, index: 0 })).url).toContain(
    'signed.invalid',
  );
  expect(bucket.signed).toHaveBeenLastCalledWith({ action: 'read', expires: expect.any(Number) });
  const expires = bucket.signed.mock.calls.at(-1)[0].expires;
  expect(expires - Date.now()).toBeLessThanOrEqual(60000);
  data.set('schools/pu/members/other', { role: 'student' });
  await expect(call('other', { action: 'repairPhoto', id, index: 0 })).rejects.toMatchObject({
    code: 'permission-denied',
  });
  await expect(call('other', { ...repair, images: [upload.path] })).rejects.toMatchObject({
    code: 'permission-denied',
  });
  await expect(
    call('student', { ...repair, images: ['https://example.invalid/public'] }),
  ).rejects.toMatchObject({ code: 'invalid-argument' });
  data.set('schools/pu/dormStaffRoles/staff', {
    status: 'active',
    repairs: true,
    buildings: ['B'],
  });
  const before = bucket.signed.mock.calls.length;
  await expect(
    call('staff', { action: 'repairPhoto', id: staffId, index: 0 }),
  ).rejects.toMatchObject({ code: 'permission-denied' });
  expect(bucket.signed).toHaveBeenCalledTimes(before);
  expect(await call('student', { action: 'repairPhoto', id, index: 0 })).toHaveProperty('url');
  await expect(call('student', { action: 'repairPhoto', id, index: -1 })).rejects.toMatchObject({
    code: 'not-found',
  });
});

test('legacy repair photo URL is privately copied, public token revoked, and never returned', async () => {
  const bucket = photoBucket();
  const { call, data } = fixture({ getBucket: () => bucket });
  const oldPath = 'temp/pu-SYNTHETIC123456/dorm_old';
  data.set('schools/pu/dormRepairs/legacy', {
    workflow: 'dorm_staff',
    userId: 'pu-SYNTHETIC123456',
    building: 'A',
    status: 'pending',
    createdAt: 1,
    images: [
      'https://firebasestorage.googleapis.com/v0/b/synthetic-bucket/o/' +
        encodeURIComponent(oldPath) +
        '?alt=media&token=synthetic',
    ],
  });
  const workspace = await call('staff', { action: 'workspace' });
  expect(JSON.stringify(workspace)).not.toMatch(/SYNTHETIC|token=|firebasestorage|temp\//);
  await call('staff', { action: 'repairPhoto', id: workspace.repairs[0].id, index: 0 });
  expect(data.get('schools/pu/dormRepairs/legacy').images[0]).toMatch(/^dorm-private\//);
  expect(bucket.objects.get(oldPath).metadata.firebaseStorageDownloadTokens).toBeNull();
});

test('student legacy parcel feed returns only own parcels with opaque IDs and supports pickup without migration', async () => {
  const { call, data, db } = fixture();
  data.set('schools/pu/packages/pu-REGISTRANT654321_old', {
    recipientId: 'student',
    description: '合成舊包裹',
    status: 'waiting',
    registeredBy: 'pu-REGISTRANT654321',
    studentId: 'OWN123456',
    grade: 'PRIVATE_GRADE',
  });
  data.set('schools/pu/packages/other', { recipientId: 'other', description: 'PRIVATE_OTHER' });
  data.set('schools/pu', { dormWorkflowEnabled: false });
  const result = await call('student', { action: 'parcels' });
  expect(result.rows).toHaveLength(1);
  expect(result.rows[0].id).toMatch(/^dw_/);
  expect(JSON.stringify(result)).not.toMatch(
    /REGISTRANT|OWN123456|PRIVATE|recipientId|studentId|grade/,
  );
  await require('./packagePickup').confirmPackagePickup({
    db,
    schoolId: 'pu',
    packageId: result.rows[0].id,
    uid: 'student',
  });
  expect(data.get('schools/pu/packages/pu-REGISTRANT654321_old').status).toBe('picked_up');
  await expect(
    require('./packagePickup').confirmPackagePickup({
      db,
      schoolId: 'pu',
      packageId: result.rows[0].id,
      uid: 'staff',
    }),
  ).rejects.toMatchObject({ code: 'permission-denied' });
});

test('stored applicant IDs are masked again and unauthorized photo sources fail closed', async () => {
  const bucket = photoBucket();
  const { call, data } = fixture({ getBucket: () => bucket });
  data.set('schools/pu/dormLeaves/legacy', {
    userId: 'other',
    building: 'A',
    applicantName: '合成同學',
    maskedStudentId: 'SYNTHETIC123456',
    status: 'pending',
    createdAt: 1,
  });
  const leaves = (await call('staff', { action: 'workspace' })).leaves;
  expect(leaves[0].maskedStudentId).toBe('***456');
  for (const url of [
    'https://example.invalid/private',
    'https://firebasestorage.googleapis.com/v0/b/synthetic-bucket/o/temp%2Fother%2Fdorm_old',
  ]) {
    data.set('schools/pu/dormRepairs/source', {
      userId: 'student',
      building: 'A',
      workflow: 'dorm_staff',
      images: [url],
    });
    await expect(
      call('student', { action: 'repairPhoto', id: 'source', index: 0 }),
    ).rejects.toBeDefined();
  }
  expect(bucket.signed).not.toHaveBeenCalled();
  await expect(
    call('student', {
      action: 'uploadPhoto',
      contentType: 'image/svg+xml',
      base64: 'c3ludGhldGlj',
    }),
  ).rejects.toMatchObject({ code: 'invalid-argument' });
});

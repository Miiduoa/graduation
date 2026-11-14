const { hasServiceDomainAccess } = require('./authz');
const { createDormWorkflowHandler, transition } = require('./dormWorkflow');
function fixture() {
  const data = new Map([
    ['schools/pu', { dormWorkflowEnabled: true }],
    ['schools/pu/members/student', { role: 'student' }],
    ['schools/pu/members/staff', { role: 'staff' }],
    ['schools/pu/members/admin', { role: 'admin' }],
    [
      'schools/pu/serviceRoles/staff',
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
  const collection = (path, filters = []) => ({
    doc: (id) => doc(path + '/' + (id || `auto${++next}`)),
    where: (f, _op, v) => collection(path, [...filters, [f, v]]),
    get: async () => ({
      docs: [...data.keys()]
        .filter(
          (k) =>
            k.startsWith(path + '/') &&
            k.split('/').length === path.split('/').length + 1 &&
            filters.every(([f, v]) => data.get(k)[f] === v),
        )
        .map(snapshot),
    }),
    add: async (row) => {
      const r = doc(path + '/auto' + ++next);
      data.set(r.path, row);
      return r;
    },
  });
  const writer = () => ({
    get: async (ref) => snapshot(ref.path),
    getAll: async (...refs) => refs.map((r) => snapshot(r.path)),
    create: (ref, row) => data.set(ref.path, row),
    set: (ref, row, opts) =>
      data.set(ref.path, opts?.merge ? { ...data.get(ref.path), ...row } : row),
    update: (ref, row) => data.set(ref.path, { ...data.get(ref.path), ...row }),
    commit: async () => {},
  });
  const db = { collection, runTransaction: async (fn) => fn(writer()), batch: writer };
  const sendPushToUser = jest.fn().mockResolvedValue({});
  const handler = createDormWorkflowHandler({ db, sendPushToUser });
  const call = (uid, input) => handler({ auth: { uid }, data: { schoolId: 'pu', ...input } });
  return { call, data, sendPushToUser };
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
  expect([...data.keys()].filter((k) => k.includes('/repairRequests/'))).toHaveLength(1);
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
  const row = data.get('schools/pu/repairRequests/' + id);
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
  const { call } = fixture();
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
    repairs: false,
    packages: false,
  });
  expect([...data.keys()].some((k) => k.includes('/adminLogs/'))).toBe(true);
  await expect(
    call('admin', {
      action: 'setStaff',
      targetUid: 'outsider',
      packages: true,
      repairs: true,
      buildings: [],
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
  data.get('schools/pu/serviceRoles/staff').buildings = ['A', 'B'];
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
    expect(hasServiceDomainAccess(after, 'packages')).toBe(true);
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
    for (const domain of ['orders', 'printing', 'health'])
      expect(hasServiceDomainAccess(revoked, domain)).toBe(hasServiceDomainAccess(before, domain));
    expect(hasServiceDomainAccess(revoked, 'packages')).toBe(false);
  },
);

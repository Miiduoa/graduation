// @vitest-environment node
import { expect, test, vi } from 'vitest';
import { dispatchFnRequest } from './fnDispatch';
import { isHostedWebCallable } from '../hostedCallables';
import { createMemoryGroupStore } from './memoryGroupStore';

const names = ['careerWorkstudy', 'careerInternship', 'clubPortal'];
function request(data: object, token = true) {
  return new Request('https://nuni.tw/api/fn/test', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer fixture' } : {}),
    },
    body: JSON.stringify({ data: { schoolId: 'pu', ...data } }),
  });
}
function fixture(role = 'student', service = {}) {
  const store = createMemoryGroupStore([
    ['schools/pu/members/student', { status: 'active', role }],
    ['schools/pu/serviceRoles/student', { status: 'active', ...service }],
    ['users/student', { status: 'active' }],
  ]);
  const verifyIdToken = vi.fn(async () => ({ uid: 'student', admin: true, role: 'admin' }));
  return { db: store.db, verifyIdToken };
}
test.each(names)('%s is hosted and unavailable without admin runtime', async (name) => {
  expect(isHostedWebCallable(name)).toBe(true);
  const result = await dispatchFnRequest(
    name,
    request({ action: 'list', audience: 'student' }),
    null,
  );
  expect(result.status).toBe(503);
  expect((await result.json()).error.message).toBe('尚未啟用');
});
test.each(['clubPortal', 'careerInternship'])('%s requires login without writes', async (name) => {
  const runtime = fixture();
  const write = vi.spyOn(runtime.db, 'runTransaction');
  const result = await dispatchFnRequest(
    name,
    request({ action: 'list', audience: 'student' }, false),
    runtime,
  );
  expect(result.status).toBe(401);
  expect((await result.json()).error.message).toContain('請先登入');
  expect(write).not.toHaveBeenCalled();
});
test.each(['careerWorkstudy', 'careerInternship'])(
  '%s preserves student, staff and ops grants',
  async (name) => {
    const runtime = fixture();
    expect(
      (await dispatchFnRequest(name, request({ action: 'list', audience: 'student' }), runtime))
        .status,
    ).toBe(200);
    for (const audience of ['staff', 'ops']) {
      const result = await dispatchFnRequest(
        name,
        request({ action: 'list', audience, demoRole: 'admin' }),
        runtime,
      );
      expect(result.status).toBe(403);
      expect((await result.json()).error.status).toBe('PERMISSION_DENIED');
    }
    expect(runtime.verifyIdToken).toHaveBeenCalledWith('fixture', true);
    expect(
      (
        await dispatchFnRequest(
          name,
          request({ action: 'list', audience: 'staff' }),
          fixture('student', { career_staff: true }),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await dispatchFnRequest(
          name,
          request({ action: 'list', audience: 'ops' }),
          fixture('admin'),
        )
      ).status,
    ).toBe(200);
  },
);
test('internship department reviewer keeps independent access', async () => {
  expect(
    (
      await dispatchFnRequest(
        'careerInternship',
        request({ action: 'list', audience: 'staff' }),
        fixture('student', { internship_departments: ['資訊'] }),
      )
    ).status,
  ).toBe(200);
});
test('club office grant cannot come from token or client role', async () => {
  const runtime = fixture();
  expect(
    (await dispatchFnRequest('clubPortal', request({ action: 'directory' }), runtime)).status,
  ).toBe(200);
  const denied = await dispatchFnRequest(
    'clubPortal',
    request({ action: 'office', demoRole: 'admin' }),
    runtime,
  );
  expect(denied.status).toBe(403);
  expect(runtime.verifyIdToken).toHaveBeenCalledWith('fixture', true);
  expect(
    (
      await dispatchFnRequest(
        'clubPortal',
        request({ action: 'office' }),
        fixture('staff', { clubs: true }),
      )
    ).status,
  ).toBe(200);
});

test('club officer operations still require active group officer membership', async () => {
  const store = createMemoryGroupStore([
    ['schools/pu/members/student', { status: 'active', role: 'student' }],
    ['groups/club', { type: 'club', schoolId: 'pu', name: '測試社團', memberCount: 1 }],
    ['schools/pu/clubs/club', { status: 'approved' }],
  ]);
  const runtime = { db: store.db, verifyIdToken: async () => ({ uid: 'student' }) };
  const data = {
    action: 'profile',
    groupId: 'club',
    name: '測試社團',
    description: '',
    category: '',
    meetingTime: '',
    instagram: '',
    line: '',
    joinPolicy: 'open',
    recruiting: true,
  };
  expect((await dispatchFnRequest('clubPortal', request(data), runtime)).status).toBe(403);
  store.docs.set('groups/club/members/student', { status: 'active', role: 'owner' });
  expect((await dispatchFnRequest('clubPortal', request(data), runtime)).status).toBe(200);
});
test.each(names)(
  '%s never accepts an unverified bearer through a service-account runtime',
  async (name) => {
    const runtime = fixture();
    runtime.verifyIdToken.mockRejectedValueOnce(new Error('revoked'));
    const transaction = vi.spyOn(runtime.db, 'runTransaction');
    const response = await dispatchFnRequest(
      name,
      request({ action: 'list', audience: 'ops', role: 'admin' }),
      { ...runtime, serviceAccount: {} as never },
    );
    expect(response.status).toBe(401);
    expect(transaction).not.toHaveBeenCalled();
  },
);
test('visitor workstudy can list published opportunities but cannot apply', async () => {
  const runtime = fixture();
  expect(
    (
      await dispatchFnRequest(
        'careerWorkstudy',
        request({ action: 'list', audience: 'student' }, false),
        runtime,
      )
    ).status,
  ).toBe(200);
  expect(
    (await dispatchFnRequest('careerWorkstudy', request({ action: 'apply' }, false), runtime))
      .status,
  ).toBe(401);
});

test('each callable keeps its own 240 per uid per minute budget', async () => {
  const store = createMemoryGroupStore([
    ['schools/pu/members/polling', { status: 'active', role: 'student' }],
  ]);
  const runtime = { db: store.db, verifyIdToken: async () => ({ uid: 'polling' }) };
  for (const name of names) {
    const data =
      name === 'clubPortal' ? { action: 'directory' } : { action: 'list', audience: 'student' };
    for (let i = 0; i < 240; i++) {
      expect((await dispatchFnRequest(name, request(data), runtime)).status).toBe(200);
    }
    expect((await dispatchFnRequest(name, request(data), runtime)).status).toBe(429);
  }
});

test('missing active school membership never grants staff, ops or club access', async () => {
  const runtime = { ...fixture(), verifyIdToken: async () => ({ uid: 'outsider', admin: true }) };
  for (const name of names) {
    expect(
      (
        await dispatchFnRequest(
          name,
          request(
            name === 'clubPortal' ? { action: 'directory' } : { action: 'list', audience: 'staff' },
          ),
          runtime,
        )
      ).status,
    ).toBe(403);
  }
});

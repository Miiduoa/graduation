// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { handleNuni } from './api';
import { SESSION_COOKIE, sealCookie, sessionContext } from './server';
import {
  loadMerchantOverview,
  merchantWorkspaceStateLabel,
  validateMerchantApplicationInput,
} from '@campus/shared/src/nuniMerchant';
import { parseNuniMemberships } from '@campus/shared/src/nuniAccount';

const current = { sessionHandle: `ps_${'a'.repeat(43)}`, expiresAt: Date.now() + 3600_000 };
const input = {
  tenantId: 'school-one',
  campusId: 'main',
  idempotencyKey: 'apply-123456789012',
  businessKind: 'campus-stall',
  legalName: '店家有限公司',
  brandName: '測試餐坊',
  contactName: '申請人',
  contactEmail: 'owner@example.test',
  contactPhone: '0912345678',
  locationName: '第一門市',
  operatingAddress: '校園餐廳一樓',
  serviceModes: ['pickup'],
};
const application = {
  applicationId: 'fma_11111111-1111-4111-8111-111111111111',
  tenantId: 'school-one',
  brandName: '測試餐坊',
  locationName: '第一門市',
  state: 'submitted',
  reviewerNote: '',
  submittedAt: '2026-10-09T00:00:00Z',
};
const fetcher = vi.fn();
function request(
  path: string,
  body?: object,
  context = sessionContext(current),
  origin = 'https://nuni.tw',
) {
  return new NextRequest(`https://nuni.tw/api/nuni/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      Cookie: `${SESSION_COOKIE}=${sealCookie(SESSION_COOKIE, current)}`,
      'X-Campus-Session': context,
      Origin: origin,
      'Content-Type': 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
beforeEach(() => {
  vi.stubEnv('NUNI_CLASSROOM_ENABLED', 'true');
  vi.stubEnv('NUNI_API_BASE_URL', 'https://api.nuni.tw');
  vi.stubEnv('WEB_PUBLIC_ORIGIN', 'https://nuni.tw');
  vi.stubEnv('BFF_SESSION_SECRET', 'test-session-secret-longer-than-32-characters');
  vi.stubGlobal('fetch', fetcher.mockReset());
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
it('requires the current account context and same origin before accepting a merchant application', async () => {
  expect(
    (await handleNuni(request('merchant-applications', input, 'stale'), ['merchant-applications']))
      .status,
  ).toBe(409);
  expect(
    (
      await handleNuni(
        request('merchant-applications', input, sessionContext(current), 'https://other.test'),
        ['merchant-applications'],
      )
    ).status,
  ).toBe(403);
  expect(fetcher).not.toHaveBeenCalled();
});
it('forwards only validated applicant data under the existing platform session and verifies its receipt', async () => {
  fetcher.mockResolvedValue(
    new Response(JSON.stringify(application), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
  const result = await handleNuni(request('merchant-applications', input), [
    'merchant-applications',
  ]);
  expect(result.status).toBe(201);
  expect(await result.json()).toEqual(application);
  const [url, options] = fetcher.mock.calls[0];
  expect(url).toBe('https://api.nuni.tw/v1/auth/platform/merchant-applications');
  expect(JSON.parse(options.body)).toEqual(input);
  expect(options.headers.Authorization).toBe(`Platform ${current.sessionHandle}`);
  fetcher.mockResolvedValue(
    new Response(JSON.stringify({ ...application, tenantId: 'other-school' }), {
      headers: { 'Content-Type': 'application/json' },
    }),
  );
  expect(
    (await handleNuni(request('merchant-applications', input), ['merchant-applications'])).status,
  ).toBe(502);
});
it.each([
  { role: 'merchant-admin' },
  { platformAccountId: 'another' },
  { schoolId: 'another' },
  { serviceModes: [] },
  { serviceModes: ['pickup', 'pickup'] },
  { contactEmail: 'invalid' },
  { campusId: '../other' },
])('rejects self-assigned authority and invalid application data: %j', async (extra) => {
  expect(
    (
      await handleNuni(request('merchant-applications', { ...input, ...extra }), [
        'merchant-applications',
      ])
    ).status,
  ).toBe(422);
  expect(fetcher).not.toHaveBeenCalled();
});
it('retains individual school verification states without deriving roles from the selected school', async () => {
  const memberships = [
    {
      membershipId: 'mc-a',
      tenantId: 'school-a',
      campusName: 'A校',
      state: 'verified',
      assurance: 'staff-verified',
    },
    {
      membershipId: 'mc-b',
      tenantId: 'school-b',
      campusName: 'B校',
      state: 'pending',
      assurance: 'unverified',
    },
  ];
  fetcher.mockResolvedValue(
    new Response(JSON.stringify({ memberships }), {
      headers: { 'Content-Type': 'application/json' },
    }),
  );
  const result = await handleNuni(request('memberships'), ['memberships']);
  expect(await result.json()).toEqual({ memberships });
  expect(() =>
    parseNuniMemberships({ memberships: [{ ...memberships[0], state: 'admin' }] }),
  ).toThrow();
  expect(
    (await handleNuni(request('memberships', { role: 'admin' }), ['memberships'])).status,
  ).toBe(422);
});
it('never turns a failed merchant list into an empty onboarding result', async () => {
  await expect(
    loadMerchantOverview(async (path) => {
      if (path === 'merchant-workspaces') throw new Error('offline');
      return path === 'merchant-applications' ? { applications: [] } : { programs: [] };
    }),
  ).rejects.toThrow('offline');
});
it('distinguishes approval, activation, temporary closure and suspension', () => {
  const workspace = {
    tenantId: 'school-one',
    tenantName: 'School',
    merchantName: 'Shop',
    locationId: 'l1',
    locationName: 'Shop',
    campusName: 'Campus',
    merchantStatus: 'active',
    locationStatus: 'open',
    publicAccess: true,
    activated: false,
    missingRequirements: ['menu'],
  };
  expect(merchantWorkspaceStateLabel(workspace)).toContain('待完成');
  expect(merchantWorkspaceStateLabel({ ...workspace, activated: true })).toBe('營業中');
  expect(
    merchantWorkspaceStateLabel({
      ...workspace,
      activated: true,
      locationStatus: 'closed',
      publicAccess: false,
    }),
  ).toBe('暫停接單');
  expect(
    merchantWorkspaceStateLabel({ ...workspace, activated: true, locationStatus: 'suspended' }),
  ).toContain('已停權');
  expect(validateMerchantApplicationInput({ ...input, legalName: '  店家有限公司  ' })).toEqual(
    input,
  );
});

it('only requests a pending school claim and rejects self-assigned tenant or role fields', async () => {
  const receipt = {
    membershipId: 'pm_11111111-1111-4111-8111-111111111111',
    tenantId: 'school-one',
    state: 'pending',
    created: true,
  };
  fetcher.mockResolvedValue(
    new Response(JSON.stringify(receipt), { headers: { 'Content-Type': 'application/json' } }),
  );
  const result = await handleNuni(
    request('memberships', { claimedEmail: ' Student@School.Example ' }),
    ['memberships'],
  );
  expect(result.status).toBe(201);
  expect(await result.json()).toEqual(receipt);
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({
    claimedEmail: 'student@school.example',
  });
  for (const extra of [{ tenantId: 'other-school' }, { state: 'verified' }, { role: 'teacher' }]) {
    expect(
      (
        await handleNuni(
          request('memberships', { claimedEmail: 'student@school.example', ...extra }),
          ['memberships'],
        )
      ).status,
    ).toBe(422);
  }
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('preserves an existing rejected school claim and refuses a new already-verified receipt', async () => {
  const receipt = {
    membershipId: 'pm_11111111-1111-4111-8111-111111111111',
    tenantId: 'school-one',
    state: 'rejected',
    created: false,
  };
  fetcher.mockResolvedValue(
    new Response(JSON.stringify(receipt), { headers: { 'Content-Type': 'application/json' } }),
  );
  const result = await handleNuni(
    request('memberships', { claimedEmail: 'student@school.example' }),
    ['memberships'],
  );
  expect(result.status).toBe(200);
  expect(await result.json()).toEqual(receipt);
  fetcher.mockResolvedValue(
    new Response(JSON.stringify({ ...receipt, state: 'verified', created: true }), {
      headers: { 'Content-Type': 'application/json' },
    }),
  );
  expect(
    (
      await handleNuni(request('memberships', { claimedEmail: 'student@school.example' }), [
        'memberships',
      ])
    ).status,
  ).toBe(502);
});

import { NuniError } from '@campus/shared/src/nuni';
import type { PlatformAssistantPermissionState } from '@campus/shared/src/platformAssistantPermissions';
import {
  loadPlatformAssistantPermissions,
  savePlatformAssistantPermissions,
  type PlatformAssistantPermissionScope,
} from '../services/platformAssistantPermissions';

const accountId = 'pa_11111111-1111-4111-8111-111111111111';
const otherAccountId = 'pa_22222222-2222-4222-8222-222222222222';
const snapshot: PlatformAssistantPermissionState = {
  scope: 'platform-account',
  accountId,
  revision: 0,
  permissions: { createPersonalEvent: false, prepareFoodOrder: false },
};
const enabled = { createPersonalEvent: true, prepareFoodOrder: false };

function scope(request = jest.fn()): PlatformAssistantPermissionScope {
  return { accountId, context: 'session-a', isCurrent: () => true, request };
}

test('loads and saves the verified account through its BFF session context', async () => {
  const receipt = { ...snapshot, revision: 1, permissions: enabled };
  const request = jest.fn().mockResolvedValueOnce(snapshot).mockResolvedValueOnce(receipt);
  const active = scope(request);
  await expect(loadPlatformAssistantPermissions(active)).resolves.toEqual(snapshot);
  await expect(savePlatformAssistantPermissions(active, snapshot, enabled)).resolves.toEqual(
    receipt,
  );
  expect(request.mock.calls).toEqual([
    ['assistant-permissions', 'session-a'],
    ['assistant-permissions', 'session-a', { expectedRevision: 0, permissions: enabled }],
  ]);
});

test.each([
  ['another account', { ...snapshot, accountId: otherAccountId }],
  ['invalid revision', { ...snapshot, revision: -1 }],
  ['missing permission', { ...snapshot, permissions: { createPersonalEvent: false } }],
  [
    'nonboolean grant',
    { ...snapshot, revision: 1, permissions: { ...enabled, createPersonalEvent: 'true' } },
  ],
  [
    'extra permission',
    { ...snapshot, permissions: { ...snapshot.permissions, submitLeaveRequest: true } },
  ],
])('rejects a read response with %s', async (_label, response) => {
  await expect(
    loadPlatformAssistantPermissions(scope(jest.fn().mockResolvedValue(response))),
  ).rejects.toMatchObject({ status: 502, code: 'INVALID_RESPONSE' });
});

test('accepts a read response with grant at default revision', async () => {
  const response = { ...snapshot, permissions: enabled };
  await expect(
    loadPlatformAssistantPermissions(scope(jest.fn().mockResolvedValue(response))),
  ).resolves.toEqual(response);
});

test.each([
  [
    'another account',
    { ...snapshot, accountId: otherAccountId, revision: 1, permissions: enabled },
  ],
  ['stale revision', { ...snapshot }],
  ['skipped revision', { ...snapshot, revision: 2, permissions: enabled }],
  ['different stored values', { ...snapshot, revision: 1 }],
  [
    'malformed permissions',
    { ...snapshot, revision: 1, permissions: { createPersonalEvent: true } },
  ],
])('does not confirm a save receipt with %s', async (_label, response) => {
  const request = jest.fn().mockResolvedValue(response);
  await expect(
    savePlatformAssistantPermissions(scope(request), snapshot, enabled),
  ).rejects.toMatchObject({ status: 502, code: 'INVALID_RESPONSE' });
  expect(request).toHaveBeenCalledTimes(1);
});

test('rejects obsolete scope before requesting or after a late response', async () => {
  let active = false;
  const request = jest.fn(async () => {
    active = false;
    return snapshot;
  });
  const context = { ...scope(request), isCurrent: () => active };
  await expect(loadPlatformAssistantPermissions(context)).rejects.toMatchObject({
    code: 'SESSION_CHANGED',
  });
  await expect(savePlatformAssistantPermissions(context, snapshot, enabled)).rejects.toMatchObject({
    code: 'SESSION_CHANGED',
  });
  expect(request).not.toHaveBeenCalled();
  active = true;
  await expect(loadPlatformAssistantPermissions(context)).rejects.toMatchObject({
    code: 'SESSION_CHANGED',
  });
  expect(request).toHaveBeenCalledTimes(1);
});

test('cannot apply an account A snapshot to account B or turn failures into grants', async () => {
  const request = jest
    .fn()
    .mockRejectedValue(new NuniError(503, 'ASSISTANT_PERMISSION_STORE_UNAVAILABLE'));
  await expect(
    savePlatformAssistantPermissions(
      { ...scope(request), accountId: otherAccountId },
      snapshot,
      enabled,
    ),
  ).rejects.toMatchObject({ code: 'SESSION_CHANGED' });
  expect(request).not.toHaveBeenCalled();
  await expect(loadPlatformAssistantPermissions(scope(request))).rejects.toMatchObject({
    status: 503,
  });
  expect(request).toHaveBeenCalledTimes(1);
});

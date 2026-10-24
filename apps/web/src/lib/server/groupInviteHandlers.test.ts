// @vitest-environment node
import { expect, it } from 'vitest';
import { createGroupInviteHandlers } from './groupInviteHandlers';
import { createMemoryGroupStore } from './memoryGroupStore';

it('creates a group, owner membership, and user mirror in one transaction', async () => {
  const store = createMemoryGroupStore([['schools/pu/members/alice', { status: 'active' }]]);
  const handlers = createGroupInviteHandlers({ db: store.db });
  const result = await handlers.createGroup({
    auth: { uid: 'alice' },
    data: { name: '讀書會', type: 'study', schoolId: 'pu' },
  });
  expect(result.success).toBe(true);
  const groupId = result.groupId as string;
  expect(store.docs.get(`groups/${groupId}`)).toMatchObject({
    name: '讀書會',
    type: 'study',
    schoolId: 'pu',
    memberCount: 1,
    createdBy: 'alice',
    verification: { status: 'unverified' },
  });
  expect(store.docs.get(`groups/${groupId}/members/alice`)).toMatchObject({
    uid: 'alice',
    role: 'owner',
    status: 'active',
  });
  expect(store.docs.get(`users/alice/groups/${groupId}`)).toMatchObject({
    groupId,
    role: 'owner',
    status: 'active',
  });
});

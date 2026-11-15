// @vitest-environment node
import { expect, test, vi } from 'vitest';
import { dispatchFnRequest } from './fnDispatch';
import { isHostedWebCallable } from '../hostedCallables';

test.each([
  'join',
  'leave',
  'review',
  'confirmOfficer',
  'official',
  'profile',
  'announcement',
  'dues',
  'createEvent',
  'register',
  'cancel',
  'checkIn',
])('未經獨立審核的社團 %s 操作不進入正式 API 或資料庫', async (action) => {
  const accessDatabase = vi.fn(() => {
    throw new Error('隔離中的操作不得讀寫資料庫');
  });
  const verifyIdToken = vi.fn();
  expect(isHostedWebCallable('clubPortal')).toBe(false);
  const response = await dispatchFnRequest(
    'clubPortal',
    new Request('https://nuni.tw/api/fn/clubPortal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' },
      body: JSON.stringify({ data: { action, schoolId: 'school', groupId: 'club' } }),
    }),
    {
      get db() {
        return accessDatabase();
      },
      verifyIdToken,
    },
  );
  expect(response.status).toBe(404);
  expect((await response.json()).error.status).toBe('NOT_FOUND');
  expect(accessDatabase).not.toHaveBeenCalled();
  expect(verifyIdToken).not.toHaveBeenCalled();
});

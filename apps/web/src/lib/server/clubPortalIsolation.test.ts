// @vitest-environment node
import { expect, test } from 'vitest';
import { dispatchFnRequest } from './fnDispatch';
import { isHostedWebCallable } from '../hostedCallables';

test('未經獨立審核的社團權限與寫入不註冊正式 API', async () => {
  expect(isHostedWebCallable('clubPortal')).toBe(false);
  const response = await dispatchFnRequest(
    'clubPortal',
    new Request('https://nuni.tw/api/fn/clubPortal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: { action: 'join', schoolId: 'school', groupId: 'club' } }),
    }),
  );
  expect(response.status).toBe(404);
  expect((await response.json()).error.status).toBe('NOT_FOUND');
});

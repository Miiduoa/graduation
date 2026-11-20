// @vitest-environment node
import { expect, it, vi } from 'vitest';

const after = vi.hoisted(() => vi.fn());

vi.mock('next/server', () => ({
  after,
}));

import { scheduleAfterResponse } from './scheduleAfterResponse';

it('schedules work with Next.js after() instead of a void promise', async () => {
  const task = vi.fn(async () => undefined);
  scheduleAfterResponse(task);
  expect(after).toHaveBeenCalledOnce();
  expect(task).not.toHaveBeenCalled();
  const queued = after.mock.calls[0]?.[0] as () => Promise<void>;
  await queued();
  expect(task).toHaveBeenCalledOnce();
});

it('swallows background failures so they cannot reject the finished response', async () => {
  scheduleAfterResponse(async () => {
    throw new Error('sso failed');
  });
  const queued = after.mock.calls.at(-1)?.[0] as () => Promise<void>;
  await expect(queued()).resolves.toBeUndefined();
});

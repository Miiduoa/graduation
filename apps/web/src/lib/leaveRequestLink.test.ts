import { expect, it } from 'vitest';
import { leaveRequestHref, parseLeaveRequestId } from './leaveRequestLink';

it('uses the same request ID format as the leave submission endpoint', () => {
  expect(parseLeaveRequestId('leave-2026-good-id')).toBe('leave-2026-good-id');
  expect(parseLeaveRequestId('11111111-1111-4111-8111-111111111111')).toBe('11111111-1111-4111-8111-111111111111');
  expect(parseLeaveRequestId('a'.repeat(64))).toBe('a'.repeat(64));
});

it.each([null, undefined, 123, '', 'too-short', '../leave-2026-good-id', 'leave-2026/id', 'leave 2026 id', 'leave-2026-good-id\n', 'a'.repeat(65)])(
  'rejects malformed request IDs without constructing a path for %s',
  (value) => {
    expect(parseLeaveRequestId(value)).toBeNull();
    expect(leaveRequestHref(value, 'pu')).toBeNull();
  },
);

it('keeps the school and request in a local read-only destination', () => {
  expect(leaveRequestHref('leave-2026-good-id', 'pu')).toBe('/leave?schoolId=pu&requestId=leave-2026-good-id');
  expect(leaveRequestHref('leave-2026-good-id')).toBe('/leave?requestId=leave-2026-good-id');
  expect(leaveRequestHref('leave-2026-good-id', '../pu')).toBeNull();
  expect(leaveRequestHref('leave-2026-good-id', 'pu\n')).toBeNull();
  expect(leaveRequestHref('leave-2026-good-id', 'all')).toBeNull();
});

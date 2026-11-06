// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import {
  getStudentCardService,
  isStudentCardToken,
  maskStudentId,
} from '@campus/shared/src/studentCard';
import { cardIdentity, redeemStudentCard, studentCardRequest } from './studentCard';

const now = Date.now();
const account = {
  uid: 'alice',
  role: 'student',
  schoolId: 'pu',
  campusCardStudentId: 'S1234567',
  firebase: { sign_in_provider: 'custom' },
  auth_time: Math.floor(now / 1000),
};

describe('student card identity', () => {
  it('takes the number from the authenticated school login', () => {
    expect(cardIdentity(account, 'tw-pu', now)).toEqual({ schoolId: 'pu', studentId: 'S1234567' });
  });
  it.each([
    [{ ...account, studentId: 'S1234567', campusCardStudentId: undefined }, 'pu'],
    [{ ...account, role: 'teacher' }, 'pu'],
    [{ ...account, firebase: { sign_in_provider: 'password' } }, 'pu'],
    [account, 'thu'],
    [account, null],
    [account, '__proto__'],
    [{ ...account, schoolId: 'unknown' }, 'unknown'],
    [{ ...account, auth_time: account.auth_time - 86400 }, 'pu'],
  ] as const)('refuses unsupported evidence %#', (claims, school) => {
    expect(() => cardIdentity(claims, school, now)).toThrow('SCHOOL_SIGN_IN_REQUIRED');
  });
  it('provides verified school destinations and masks short IDs completely', () => {
    expect(maskStudentId('S1234567')).toBe('•••• 4567');
    expect(maskStudentId('1234')).toBe('••••');
    expect(getStudentCardService('tw-pu', 'ios')).toEqual(getStudentCardService('pu', 'ios'));
    expect(getStudentCardService('fcu', 'android')?.url).toContain('com.fcuapp.app');
    expect(getStudentCardService('thu')?.url).toContain('page.line.me');
    expect(getStudentCardService('__proto__')).toBeNull();
    expect(isStudentCardToken('a'.repeat(31))).toBe(false);
    expect(isStudentCardToken('a'.repeat(32))).toBe(true);
    expect(isStudentCardToken('a'.repeat(32) + '\n')).toBe(false);
  });
});

it.each([
  ['present', '{"schoolId":"pu"}', 401],
  ['verify', '{"token":"x"}', 400],
  ['verify', JSON.stringify({ token: 'x'.repeat(32) + '\n' }), 400],
  ['verify', '[]', 400],
  ['verify', 'x'.repeat(1025), 413],
] as const)('rejects invalid %s requests without caching (%#)', async (action, body, expected) => {
  const req = new Request('https://example.test/api/student-card/' + action, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
  const response = await studentCardRequest(req, action);
  expect(response.status).toBe(expected);
  expect(response.headers.get('Cache-Control')).toContain('no-store');
});

it('rechecks expiration after reading the current membership', async () => {
  const token = 'a'.repeat(32);
  const fields: Record<string, unknown> = {
    digest: createHash('sha256').update(token).digest('hex'),
    schoolId: 'pu',
    expiresAt: now + 60_000,
    maskedId: '•••• 4567',
  };
  const ref = { path: '_studentCardPresentations/alice' };
  const record = { id: 'alice', ref, get: (field: string) => fields[field] };
  const user: Record<string, unknown> = { schoolId: 'pu', primarySchoolId: 'pu', role: 'student' };
  const transaction = {
    get: async () => record,
    getAll: async () => [
      { exists: true, get: (field: string) => user[field] },
      { get: (field: string) => (field === 'status' ? 'active' : undefined) },
    ],
    delete: vi.fn(),
  };
  const query = { where: () => query, limit: () => query, get: async () => ({ docs: [record] }) };
  const db = {
    doc: (path: string) => ({ path }),
    collection: () => query,
    runTransaction: (work: (tx: typeof transaction) => unknown) => work(transaction),
  } as unknown as Firestore;
  const clock = vi
    .spyOn(Date, 'now')
    .mockReturnValueOnce(now)
    .mockReturnValue(now + 60_000);
  try {
    await expect(redeemStudentCard(db, token)).rejects.toThrow('CARD_UNAVAILABLE');
    expect(transaction.delete).not.toHaveBeenCalled();
  } finally {
    clock.mockRestore();
  }
});

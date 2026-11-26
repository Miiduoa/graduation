import { expect, it } from 'vitest';
import { parseTronClassStudentIdentityEvidence as parse } from './tronClassIdentityEvidence';

const valid = { id: 44, login_name: 's1234567', role: 'teacher', email: 'fixture@example.test' };

it('projects only a tenant-scoped numeric profile subject, never roles or input identifiers', () => {
  expect(parse(valid, '1234567@pu.edu.tw')).toEqual({
    schoolId: 'pu', source: 'authenticated-profile',
    issuer: 'https://tronclass.pu.edu.tw', subject: '44',
  });
});
it.each([
  { ...valid, id: '44' },
  { ...valid, id: 0 },
  { ...valid, id: -1 },
  { ...valid, id: 1.5 },
  { ...valid, id: Number.MAX_SAFE_INTEGER + 1 },
  { ...valid, id: undefined, user_id: 44 },
  { ...valid, user_id: 45 },
  { ...valid, user: { id: 45 } },
  { ...valid, login_name: 's1234568' },
  { ...valid, user_name: 's1234568' },
  { ...valid, user: { login_name: 's1234568' } },
  { id: 44, email: 's1234567@pu.edu.tw' },
  { id: 44, user: { login_name: 's1234567' } },
  { id: 44, login_name: ['s1234567'] },
  { id: 44, login_name: 's1234567@other.example' },
  null, [], 'profile',
])('rejects insufficient or conflicting profile evidence (%o)', (profile) => {
  expect(parse(profile, 's1234567')).toBeNull();
});
it('never treats the submitted account as the subject', () => {
  expect(parse({ ...valid, id: 45 }, 's1234567')?.subject).toBe('45');
  expect(parse(valid, 'teacher')).toBeNull();
  expect(parse(valid, 's1234568')).toBeNull();
});

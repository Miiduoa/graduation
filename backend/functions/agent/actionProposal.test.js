'use strict';

const { matchAgentProposal } = require('./actionProposal');

const now = Date.parse('2026-10-26T12:00:00.000Z');
const proposal = { toolName: 'submitLeaveRequest', input: { courseId: 'class-1', date: '2026-10-27', type: '事假' } };
const run = {
  status: 'completed',
  userId: 'alice',
  schoolId: 'pu',
  createdAt: { toMillis: () => now - 1000 },
  actionProposals: [proposal],
};
const input = { uid: 'alice', schoolId: 'pu', toolName: proposal.toolName, input: proposal.input, now };

test('accepts an unchanged, fresh action prepared for the current account and campus', () => {
  expect(matchAgentProposal(run, input)).toBe(0);
});

test.each([
  { name: 'another account', change: { uid: 'bob' } },
  { name: 'another campus', change: { schoolId: 'nthu' } },
  { name: 'another tool', change: { toolName: 'borrowBook' } },
  { name: 'changed date', change: { input: { ...proposal.input, date: '2026-10-28' } } },
  { name: 'expired run', change: { now: now + 60 * 60_000 } },
])('blocks $name', ({ change }) => {
  expect(matchAgentProposal(run, { ...input, ...change })).toBe(-1);
});

test('does not accept pending, empty or unrecorded runs', () => {
  expect(matchAgentProposal({ ...run, status: 'running' }, input)).toBe(-1);
  expect(matchAgentProposal({ ...run, actionProposals: [] }, input)).toBe(-1);
  expect(matchAgentProposal(null, input)).toBe(-1);
});

test('matches the same proposal when Firestore returns object keys in a different order', () => {
  expect(matchAgentProposal(run, {
    ...input,
    input: { type: '事假', courseId: 'class-1', date: '2026-10-27' },
  })).toBe(0);
});

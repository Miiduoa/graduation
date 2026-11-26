'use strict';

const { Timestamp } = require('firebase-admin/firestore');
const {
  projectWashingReservation, washingReservationVersion, assertWashingReservationVersion,
} = require('./washingReservationSource');

const row = {
  machineId: 'A2', dormitory: 'A棟', startTime: '20:00', status: 'reserved',
  reservedUntil: Timestamp.fromMillis(1893456600000),
};
const projected = {
  reservationId: 'r1', machineId: 'A2', dormitory: 'A棟', startTime: '20:00',
  reservedUntil: '2030-01-01T00:10:00.000Z', status: 'reserved',
};

test('projects only reviewed source fields and uses the actual document identity', () => {
  expect(projectWashingReservation('r1', { ...row, reservationId: 'forged', id: 'forged', note: 'private' }))
    .toEqual(projected);
});

test.each([
  ['reservation ID', 'r2', row],
  ['machine', 'r1', { ...row, machineId: 'A3' }],
  ['dormitory', 'r1', { ...row, dormitory: 'B棟' }],
  ['start', 'r1', { ...row, startTime: '21:00' }],
  ['expiry', 'r1', { ...row, reservedUntil: null }],
  ['status', 'r1', { ...row, status: 'cancelled' }],
])('the version changes when the reviewed %s changes', (_label, id, changed) => {
  expect(washingReservationVersion('r1', row)).toMatch(/^[a-f0-9]{64}$/);
  expect(washingReservationVersion(id, changed)).not.toBe(washingReservationVersion('r1', row));
});

test('equivalent timestamp representations have one stable version without mutating the source', () => {
  const frozen = Object.freeze({ ...row });
  const version = washingReservationVersion('r1', frozen);
  expect(washingReservationVersion('r1', { ...row, reservedUntil: new Date(projected.reservedUntil) })).toBe(version);
  expect(washingReservationVersion('r1', { ...row, reservedUntil: projected.reservedUntil })).toBe(version);
  expect(washingReservationVersion('r1', { ...row, unrelated: 'not displayed' })).toBe(version);
  expect(frozen.reservedUntil).toBe(row.reservedUntil);
});

test.each([
  { ...row, machineId: '../other' }, { ...row, machineId: ' ' },
  { ...row, dormitory: null }, { ...row, dormitory: ' ' }, { ...row, startTime: '' },
  { ...row, status: '' }, { ...row, reservedUntil: 'bad-date' },
  { ...row, reservedUntil: { toDate: () => { throw new Error('bad source'); } } },
])('malformed reviewed data %j is unavailable, never a guessed source', (source) => {
  expect(() => projectWashingReservation('r1', source)).toThrow(expect.objectContaining({ code: 'failed-precondition' }));
});

test('a missing expiry remains explicitly unknown', () => {
  expect(projectWashingReservation('r1', { ...row, reservedUntil: undefined }).reservedUntil).toBeNull();
});

test('ordinary ID-only cancellation is compatible while Agent cancellation requires a version', () => {
  expect(assertWashingReservationVersion({}, { reservationId: 'r1' }, 'r1', {})).toBeNull();
  expect(() => assertWashingReservationVersion({ agentActionKey: 'run:0' }, { reservationId: 'r1' }, 'r1', row))
    .toThrow(expect.objectContaining({ code: 'failed-precondition' }));
  expect(assertWashingReservationVersion(
    { agentActionKey: 'run:0' },
    { expectedReservationVersion: washingReservationVersion('r1', row), ...projected },
    'r1', row,
  )).toEqual(projected);
});

test.each(['pending', 'processing', 'cancellled', 'unknown'])(
  'an unrecognized source status %s is unavailable rather than a terminal claim', (status) => {
    expect(() => projectWashingReservation('r1', { ...row, status }))
      .toThrow(expect.objectContaining({ code: 'failed-precondition' }));
  },
);

test.each(['reserved', 'active', 'cancelled', 'inUse', 'completed', 'noshow'])(
  'a documented source status %s is retained exactly', (status) => {
    expect(projectWashingReservation('r1', { ...row, status }).status).toBe(status);
  },
);

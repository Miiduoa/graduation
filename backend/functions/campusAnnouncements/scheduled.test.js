'use strict';

jest.mock('firebase-admin/firestore', () => ({
  getFirestore: jest.fn(() => {
    throw new Error('must not open Firestore while disabled');
  }),
}));

jest.mock('./sync', () => ({
  syncConfiguredSchools: jest.fn(async (deps) => [{ schoolId: 'pu', dryRun: deps.dryRun === true }]),
}));

const { getFirestore } = require('firebase-admin/firestore');
const { syncConfiguredSchools } = require('./sync');
const {
  isCampusAnnouncementSyncEnabled,
  runCampusAnnouncementSync,
} = require('./scheduled');

test('schedule stays off unless CAMPUS_ANNOUNCEMENT_SYNC_ENABLED is true', async () => {
  expect(isCampusAnnouncementSyncEnabled({})).toBe(false);
  expect(isCampusAnnouncementSyncEnabled({ CAMPUS_ANNOUNCEMENT_SYNC_ENABLED: 'true' })).toBe(true);
  await expect(runCampusAnnouncementSync({ env: {} })).resolves.toEqual({
    skipped: true,
    reason: 'disabled',
  });
  expect(getFirestore).not.toHaveBeenCalled();
  expect(syncConfiguredSchools).not.toHaveBeenCalled();
});

test('enabled dry-run does not open Firestore', async () => {
  await expect(
    runCampusAnnouncementSync({
      env: { CAMPUS_ANNOUNCEMENT_SYNC_ENABLED: 'true', CAMPUS_ANNOUNCEMENT_SYNC_DRY_RUN: 'true' },
    }),
  ).resolves.toEqual([{ schoolId: 'pu', dryRun: true }]);
  expect(getFirestore).not.toHaveBeenCalled();
  expect(syncConfiguredSchools).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true }));
});

'use strict';

jest.mock('./sync', () => ({
  syncSchool: jest.fn(),
}));

const { syncSchool } = require('./sync');
const { parseProbe, sourceSeverity, runProbe } = require('./probe');

test('probe never writes and treats SPA empty parse as a warning', () => {
  expect(parseProbe(['--schools', 'ncku,ntpu']).schoolIds).toEqual(['ncku', 'ntpu']);
  expect(parseProbe(['--', '--schools', 'ncku,ntpu']).schoolIds).toEqual(['ncku', 'ntpu']);
  expect(
    sourceSeverity({ fragile: 'spa' }, { status: 'unavailable', reason: 'parse_empty' }),
  ).toBe('warn');
  expect(
    sourceSeverity({ fragile: '' }, { status: 'unavailable', reason: 'parse_empty' }),
  ).toBe('error');
  expect(
    sourceSeverity({ fragile: '' }, { status: 'unavailable', reason: 'http_403' }),
  ).toBe('error');
  expect(sourceSeverity({ fragile: '' }, { status: 'healthy' })).toBe('ok');
});

test('probe dry-runs requested schools without opening Firestore', async () => {
  syncSchool.mockImplementation(async (schoolId) => ({
    schoolId,
    status: 'healthy',
    sources: [
      {
        sourceId: `${schoolId}-campus`,
        office: '全校最新消息',
        status: 'healthy',
        reason: '',
        itemCount: 4,
      },
    ],
  }));
  const summary = await runProbe(['--schools', 'ncku,ntpu']);
  expect(summary.wrote).toBe(false);
  expect(summary.dryRun).toBe(true);
  expect(syncSchool).toHaveBeenCalledWith(
    'ncku',
    expect.objectContaining({ dryRun: true, db: undefined }),
  );
  expect(summary.schools.map((item) => item.schoolId)).toEqual(['ncku', 'ntpu']);
  expect(summary.failed).toBe(false);
});

test('probe fails the job when a non-SPA source returns HTTP or empty parse', async () => {
  syncSchool.mockImplementation(async (schoolId) => ({
    schoolId,
    status: 'unavailable',
    sources: [
      {
        sourceId: `${schoolId}-campus`,
        office: '全校最新消息',
        status: 'unavailable',
        reason: schoolId === 'ncku' ? 'http_403' : 'parse_empty',
        itemCount: 0,
      },
    ],
  }));
  const summary = await runProbe(['--schools', 'ncku,ntpu']);
  expect(summary.wrote).toBe(false);
  expect(summary.failed).toBe(true);
  expect(summary.schools.find((item) => item.schoolId === 'ncku').severity).toBe('error');
  expect(summary.schools.find((item) => item.schoolId === 'ntpu').severity).toBe('error');
});

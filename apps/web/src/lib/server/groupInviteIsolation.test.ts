// @vitest-environment node
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');

it('does not import the Functions index, trigger runners, or custom-claims helpers', () => {
  const files = [
    'src/app/api/fn/[name]/route.ts',
    'src/lib/server/fnDispatch.ts',
    'src/lib/server/firebaseAdmin.ts',
    'src/lib/server/groupInviteHandlers.ts',
    'src/lib/server/timetableShareHandlers.ts',
    'src/lib/server/attendanceSessionHandlers.ts',
    'src/lib/server/leaveRequestHandlers.ts',
    'src/lib/server/tronClassLmsHandler.ts',
    'src/lib/server/leaveWebApiEnabled.ts',
    'src/lib/server/signInPuStudentId.ts',
    'src/lib/server/schoolStudentIdLoginEnabled.ts',
    'src/lib/server/firebaseCustomToken.ts',
  ];
  const joined = files.map((file) => readFileSync(join(root, file), 'utf8')).join('\n');
  expect(joined).not.toMatch(/backend\/functions\/index/);
  expect(joined).not.toMatch(/flyRuntime/);
  expect(joined).not.toMatch(/firestoreTriggerRunner/);
  expect(joined).not.toMatch(/onUserProfileChanged/);
  expect(joined).not.toMatch(/onInspectionWritten/);
  expect(joined).not.toMatch(/setCustomUserClaims/);
  const handlers = [
    'src/lib/server/groupInviteHandlers.ts',
    'src/lib/server/timetableShareHandlers.ts',
    'src/lib/server/attendanceSessionHandlers.ts',
    'src/lib/server/leaveRequestHandlers.ts',
  ]
    .map((file) => readFileSync(join(root, file), 'utf8'))
    .join('\n');
  expect(handlers).not.toMatch(/createCustomToken/);
});

it('keeps createGroup off the HTTP allowlist', () => {
  const hosted = readFileSync(join(root, 'src/lib/hostedCallables.ts'), 'utf8');
  expect(hosted).not.toMatch(/createGroup/);
  expect(hosted).toMatch(/joinGroupByCode/);
  expect(hosted).toMatch(/leaveGroup/);
  expect(hosted).toMatch(/createTimetableShare/);
  expect(hosted).toMatch(/revokeTimetableShare/);
  expect(hosted).toMatch(/startLiveSession/);
  expect(hosted).toMatch(/endLiveSession/);
  expect(hosted).toMatch(/joinLiveSession/);
  expect(hosted).toMatch(/submitLeaveRequest/);
  expect(hosted).toMatch(/withdrawLeaveRequest/);
  expect(hosted).toMatch(/reviewLeaveRequest/);
  expect(hosted).toMatch(/listLeaveReviewQueue/);
  expect(hosted).toMatch(/signInPuStudentId/);
});

it('stubs firebase-admin on the webpack browser bundle', () => {
  const config = readFileSync(join(root, 'next.config.ts'), 'utf8');
  expect(config).toMatch(/isServer/);
  expect(config).toMatch(/firebase-admin\$/);
  expect(config).toMatch(/nodeNativeStub/);
  expect(config).toMatch(/firebase-admin': \{ browser: '\.\/src\/lib\/nodeNativeStub\.ts' \}/);
});

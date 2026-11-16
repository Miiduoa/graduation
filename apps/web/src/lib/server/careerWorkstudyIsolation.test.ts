// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
it('keeps rules and deployed Functions isolated from hosted entries', () => {
  const root = resolve(process.cwd(), '../..');
  for (const file of [
    'backend/functions/index.js',
    'apps/web/src/app/career/data/route.ts',
    'apps/mobile/App.tsx',
    'apps/mobile/src/screens/RoleAwareTodayScreen.tsx',
    'packages/shared/src/index.ts',
    'firebase.json',
  ]) {
    const code = readFileSync(resolve(root, file), 'utf8');
    expect(code, file).not.toMatch(
      /careerInternship|CareerInternship|careerWorkstudy|CareerWorkstudy|careerSourceFeed|firestore\.rules\.fragment/,
    );
  }
  const rules = readFileSync(resolve(root, 'backend/firestore/firestore.rules'), 'utf8');
  expect(rules).not.toContain('internshipRecords');
  expect(rules).not.toContain('internshipRules');
  expect(rules).not.toContain('careerApplications');
  expect(rules).not.toContain('careerOpportunities');
});

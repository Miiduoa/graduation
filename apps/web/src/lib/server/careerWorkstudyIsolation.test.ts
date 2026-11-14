// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
it('keeps new permissions, SDK listeners and write handlers out of all production entry points', () => {
  const root = resolve(process.cwd(), '../..');
  for (const file of [
    'apps/web/src/lib/server/fnDispatch.ts',
    'backend/functions/index.js',
    'apps/web/src/app/career/page.tsx',
    'apps/web/src/app/career/data/route.ts',
    'apps/mobile/App.tsx',
    'apps/mobile/src/screens/CareerScreen.tsx',
    'apps/mobile/src/screens/RoleAwareTodayScreen.tsx',
    'packages/shared/src/index.ts',
    'firebase.json',
  ]) {
    const code = readFileSync(resolve(root, file), 'utf8');
    expect(code, file).not.toMatch(
      /careerWorkstudy|CareerWorkstudy|careerSourceFeed|firestore\.rules\.fragment/,
    );
  }
  const rules = readFileSync(resolve(root, 'backend/firestore/firestore.rules'), 'utf8');
  expect(rules).not.toContain('careerApplications');
  expect(rules).not.toContain('careerOpportunities');
});

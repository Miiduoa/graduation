// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from 'vitest';

test('rules and Functions exports remain isolated', () => {
  const root = resolve(process.cwd(), '../..');
  const rules = readFileSync(resolve(root, 'backend/firestore/firestore.rules'), 'utf8');
  expect(rules).not.toMatch(
    /careerOpportunities|careerApplications|internshipRecords|internshipRules/,
  );
  const functions = readFileSync(resolve(root, 'backend/functions/index.js'), 'utf8');
  expect(functions).not.toMatch(
    /careerWorkstudy|careerInternship|clubPortal|firestore\.rules\.fragment/,
  );
});

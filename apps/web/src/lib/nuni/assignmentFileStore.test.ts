// @vitest-environment node
import { afterEach, expect, it } from 'vitest';
import {
  cachedAssignmentFilePoolCount,
  resetAssignmentFileStores,
  resolveAssignmentFileStores,
  setAssignmentFilePoolFactory,
} from './assignmentFileStore';

afterEach(() => {
  resetAssignmentFileStores();
});

it('reuses one process-level postgres pool across resolveAssignmentFileStores calls', async () => {
  const created: string[] = [];
  setAssignmentFilePoolFactory((connectionString) => {
    created.push(connectionString);
    return {
      query: async () => ({ rows: [] }),
    };
  });
  const env = {
    NODE_ENV: 'production',
    ASSIGNMENT_FILE_DATABASE_URL: 'postgresql://nuni-api.example/campus',
  };
  const first = resolveAssignmentFileStores(env);
  const second = resolveAssignmentFileStores({ ...env });
  await first.index.getFile('cwf_11111111-1111-4111-8111-111111111111');
  await second.index.getFile('cwf_22222222-2222-4222-8222-222222222222');
  expect(created).toEqual(['postgresql://nuni-api.example/campus']);
  expect(cachedAssignmentFilePoolCount()).toBe(1);
  expect(second.index).toBe(first.index);
});

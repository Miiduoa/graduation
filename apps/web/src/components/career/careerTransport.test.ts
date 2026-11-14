import { expect, it, vi } from 'vitest';
import {
  createCareerCallableTransport,
  createWorkstudyService,
} from '@campus/shared/src/careerWorkstudy';
import { snapshot } from '@campus/shared/testFixtures/careerWorkstudy';
it('uses existing callable envelopes and supplied auth headers without storing credentials', async () => {
  const fetcher = vi.fn(async () => ({
    ok: true,
    json: async () => ({ result: { snapshot: snapshot() } }),
  })) as unknown as typeof fetch;
  const transport = createCareerCallableTransport({
    endpoint: '/_fn/careerWorkstudy',
    authHeaders: async () => ({}),
    fetcher,
  });
  const service = createWorkstudyService('pu', transport);
  expect((await service.load('student')).opportunities).toHaveLength(1);
  expect(fetcher).toHaveBeenCalledWith('/_fn/careerWorkstudy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: { action: 'list', audience: 'student', schoolId: 'pu' } }),
  });
});
it('shows server rejections and refuses malformed success responses', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: { message: '請重新閱讀權益說明。' } }),
    })
    .mockResolvedValueOnce({ ok: true, json: async () => ({}) }) as unknown as typeof fetch;
  const transport = createCareerCallableTransport({
    endpoint: '/_fn/careerWorkstudy',
    authHeaders: async () => ({}),
    fetcher,
  });
  await expect(transport('pu', { action: 'list', audience: 'student' })).rejects.toThrow(
    '請重新閱讀權益說明。',
  );
  await expect(transport('pu', { action: 'list', audience: 'student' })).rejects.toThrow(
    '職涯服務回覆不完整',
  );
});

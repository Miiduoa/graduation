import { beforeEach, expect, it, vi } from 'vitest';
import { interpretCampusRequest } from './campusIntentClient';

const state = vi.hoisted(() => ({
  uid: 'alice' as string | null,
  configured: true,
  callable: vi.fn(),
}));
vi.mock('./firebase', () => ({
  getAuth: () => ({ currentUser: state.uid ? { uid: state.uid } : null }),
  getFunctionsInstance: () => ({}),
  isFirebaseConfigured: () => state.configured,
}));
vi.mock('./functionsUrl', () => ({ areFunctionsConfigured: () => state.configured }));
vi.mock('firebase/functions', () => ({ httpsCallable: () => state.callable }));

const consent = {
  version: 1,
  purpose: 'campus-service-entry',
  provider: 'groq',
  model: 'openai/gpt-oss-120b',
  schoolId: 'pu',
  utterance: '想找地方讀書',
} as const;
const input = {
  uid: 'alice',
  schoolId: 'pu',
  utterance: consent.utterance,
  requestId: 'request-123',
  consent,
};
const answer = {
  status: 'understood',
  source: 'model',
  summary: '找讀書空間',
  destinations: ['/library'],
  clarifyingQuestion: null,
  previews: [],
  provider: 'groq',
  model: consent.model,
  requestId: input.requestId,
  schoolId: 'pu',
  utterance: input.utterance,
  checkedAt: '2026-11-01T16:30:00.000Z',
};
beforeEach(() => {
  state.uid = 'alice';
  state.configured = true;
  state.callable.mockReset().mockResolvedValue({ data: answer });
});

it('sends only the exact reviewed fields and returns validated entry suggestions', async () => {
  const result = await interpretCampusRequest(input);
  expect(result).toMatchObject({
    status: 'understood',
    destinations: ['/library'],
    previews: [],
    checkedAt: answer.checkedAt,
  });
  expect(state.callable).toHaveBeenCalledWith({
    schoolId: 'pu',
    utterance: input.utterance,
    requestId: input.requestId,
    consent,
  });
});
it.each([
  { ...input, consent: undefined },
  { ...input, consent: { ...consent, provider: 'gemini' } },
  { ...input, consent: { ...consent, model: 'paid-model' } },
  { ...input, consent: { ...consent, purpose: 'execute-actions' } },
  { ...input, consent: { ...consent, version: 2 } },
  { ...input, consent: { ...consent, schoolId: 'other' } },
  { ...input, consent: { ...consent, utterance: '舊文字' } },
  { ...input, consent: { ...consent, profile: 'private' } },
  { ...input, utterance: ' leading', consent: { ...consent, utterance: ' leading' } },
  { ...input, utterance: 'a\nb', consent: { ...consent, utterance: 'a\nb' } },
  { ...input, utterance: 'a'.repeat(401), consent: { ...consent, utterance: 'a'.repeat(401) } },
  { ...input, schoolId: '', consent: { ...consent, schoolId: '' } },
  { ...input, requestId: 'short' },
])('rejects missing or changed consent before any callable %#', async (request) => {
  await expect(interpretCampusRequest(request as typeof input)).rejects.toMatchObject({
    code: 'invalid-request',
  });
  expect(state.callable).not.toHaveBeenCalled();
});
it.each([
  { ...answer, provider: 'ollama' },
  { ...answer, model: 'paid' },
  { ...answer, requestId: 'other-request' },
  { ...answer, schoolId: 'other' },
  { ...answer, utterance: 'other' },
  { ...answer, checkedAt: 'today' },
  { ...answer, checkedAt: undefined },
  { ...answer, previews: undefined },
  {
    ...answer,
    previews: [
      {
        destination: '/library',
        status: 'available',
        source: 'campus-platform',
        message: 'private',
        items: [],
      },
    ],
  },
  { ...answer, destinations: ['https://evil.invalid'] },
  { ...answer, tools: ['pay'] },
  { ...answer, reason: 'rate_limited' },
  { ...answer, retryAfterSeconds: 30 },
  { ...answer, status: 'unavailable', source: 'fallback', destinations: [], reason: 'unknown' },
])('rejects mismatched or expanded receipts %#', async (data) => {
  state.callable.mockResolvedValue({ data });
  await expect(interpretCampusRequest(input)).rejects.toMatchObject({ code: 'invalid-response' });
});
it('preserves a bounded quota failure without inventing a successful result', async () => {
  state.callable.mockResolvedValue({
    data: {
      ...answer,
      status: 'unavailable',
      source: 'fallback',
      summary: '稍後再試',
      destinations: [],
      reason: 'rate_limited',
      retryAfterSeconds: 60,
    },
  });
  await expect(interpretCampusRequest(input)).resolves.toMatchObject({
    status: 'unavailable',
    reason: 'rate_limited',
    retryAfterSeconds: 60,
  });
});
it.each([-1, 0, 61, 1.5, '20'])('rejects invalid retry delay %s', async (retryAfterSeconds) => {
  state.callable.mockResolvedValue({
    data: {
      ...answer,
      status: 'unavailable',
      source: 'fallback',
      summary: '稍後再試',
      destinations: [],
      reason: 'rate_limited',
      retryAfterSeconds,
    },
  });
  await expect(interpretCampusRequest(input)).rejects.toMatchObject({ code: 'invalid-response' });
});
it('rejects an account change before sending', async () => {
  state.uid = 'bob';
  await expect(interpretCampusRequest(input)).rejects.toMatchObject({ code: 'session-changed' });
  expect(state.callable).not.toHaveBeenCalled();
});
it('rejects a late receipt after an account change', async () => {
  let resolve!: (value: unknown) => void;
  state.callable.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const pending = interpretCampusRequest(input);
  state.uid = 'bob';
  resolve({ data: answer });
  await expect(pending).rejects.toMatchObject({ code: 'session-changed' });
});
it('stops waiting on abort and ignores a late fulfilled callable', async () => {
  let resolve!: (value: unknown) => void;
  state.callable.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const controller = new AbortController();
  const pending = interpretCampusRequest({ ...input, signal: controller.signal });
  controller.abort();
  await expect(pending).rejects.toMatchObject({ code: 'canceled' });
  resolve({ data: answer });
  await Promise.resolve();
  expect(state.callable).toHaveBeenCalledTimes(1);
});
it('does not send an already aborted request', async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    interpretCampusRequest({ ...input, signal: controller.signal }),
  ).rejects.toMatchObject({ code: 'canceled' });
  expect(state.callable).not.toHaveBeenCalled();
});

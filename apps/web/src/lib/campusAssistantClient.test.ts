import { beforeEach, expect, it, vi } from 'vitest';
import { callCampusAssistant, type CampusAssistantEnvelope } from './campusAssistantClient';

const state = vi.hoisted(() => ({ uid: 'alice' as string | null, configured: true, callable: vi.fn() }));
vi.mock('./firebase', () => ({ getAuth: () => ({ currentUser: state.uid ? { uid: state.uid } : null }), getFunctionsInstance: () => ({}), isFirebaseConfigured: () => state.configured }));
vi.mock('firebase/functions', () => ({ httpsCallable: () => state.callable }));
const input = { userId: 'alice', schoolId: 'pu', groupId: 'course-one', sessionId: 'conversation-one', messages: [{ role: 'user' as const, content: '我的作業？' }] };
beforeEach(() => { state.uid = 'alice'; state.configured = true; state.callable.mockReset(); });

it('rejects unavailable configuration without inventing an answer', async () => {
  state.configured = false;
  await expect(callCampusAssistant(input)).rejects.toMatchObject({ code: 'unavailable' });
  expect(state.callable).not.toHaveBeenCalled();
});

it('propagates a backend failure instead of returning a local success', async () => {
  state.callable.mockRejectedValue({ code: 'functions/unavailable' });
  await expect(callCampusAssistant(input)).rejects.toMatchObject({ code: 'functions/unavailable' });
});

it.each([
  { content: '暫用答案', error: 'provider_unavailable' },
  { content: '看似成功', run: { status: 'failed' } },
  { content: '   ' },
  null,
])('rejects a failed or malformed response %#', async data => {
  state.callable.mockResolvedValue({ data });
  await expect(callCampusAssistant(input)).rejects.toMatchObject({ code: 'invalid-response' });
});

it('uses the selected course and accepts only the server response for the current account', async () => {
  state.callable.mockResolvedValue({ data: { content: '目前有兩項作業。', run: { status: 'completed' } } });
  await expect(callCampusAssistant(input)).resolves.toMatchObject({ content: '目前有兩項作業。' });
  expect(state.callable).toHaveBeenCalledWith({ messages: input.messages, context: expect.objectContaining({ schoolId: 'pu', groupId: 'course-one', sessionId: 'conversation-one' }) });
});

it('rejects an account mismatch before sending any private history', async () => {
  state.uid = 'bob';
  await expect(callCampusAssistant(input)).rejects.toMatchObject({ code: 'session-changed' });
  expect(state.callable).not.toHaveBeenCalled();
});

it('discards a response when Firebase changes accounts while the request is pending', async () => {
  let finish!: (value: { data: CampusAssistantEnvelope }) => void;
  state.callable.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const response = callCampusAssistant(input);
  state.uid = 'bob';
  finish({ data: { content: 'Alice 的私人資料' } });
  await expect(response).rejects.toMatchObject({ code: 'session-changed' });
});

it('discards an aborted request even if the callable completes successfully', async () => {
  let finish!: (value: { data: CampusAssistantEnvelope }) => void;
  state.callable.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const controller = new AbortController();
  const response = callCampusAssistant(input, controller.signal);
  controller.abort();
  finish({ data: { content: '舊課程資料' } });
  await expect(response).rejects.toMatchObject({ name: 'AbortError' });
});

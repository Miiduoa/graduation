import { beforeEach, expect, it, vi } from 'vitest';
import {
  callCampusAssistant,
  confirmCreateOrder,
  getCampusAssistantSnapshot,
  executeCampusAgentWrite,
  type CampusAssistantEnvelope,
} from './campusAssistantClient';

const state = vi.hoisted(() => ({
  uid: 'alice' as string | null,
  configured: true,
  functionsConfigured: true,
  callable: vi.fn(),
}));
vi.mock('./firebase', () => ({
  getAuth: () => ({ currentUser: state.uid ? { uid: state.uid } : null }),
  getFunctionsInstance: () => ({}),
  isFirebaseConfigured: () => state.configured,
}));
vi.mock('./functionsUrl', async (original) => ({
  ...(await original<typeof import('./functionsUrl')>()),
  areFunctionsConfigured: () => state.functionsConfigured,
}));
vi.mock('firebase/functions', () => ({ httpsCallable: () => state.callable }));
const input = {
  userId: 'alice',
  schoolId: 'pu',
  groupId: 'course-one',
  sessionId: 'conversation-one',
  messages: [{ role: 'user' as const, content: '我的作業？' }],
};
beforeEach(() => {
  state.uid = 'alice';
  state.configured = true;
  state.functionsConfigured = true;
  state.callable.mockReset();
});

it('rejects unavailable configuration without inventing an answer', async () => {
  state.configured = false;
  await expect(callCampusAssistant(input)).rejects.toMatchObject({ code: 'unavailable' });
  expect(state.callable).not.toHaveBeenCalled();
});

it('does not call Cloud Functions when the functions base URL is unset', async () => {
  state.functionsConfigured = false;
  await expect(callCampusAssistant(input)).rejects.toMatchObject({ code: 'unconfigured' });
  expect(state.callable).not.toHaveBeenCalled();
  await expect(
    confirmCreateOrder({
      schoolId: 'pu',
      requestId: 'req-1',
      cafeteriaId: 'cafe',
      items: [{ menuItemId: 'rice', name: '雞腿飯', price: 100, quantity: 1 }],
    }),
  ).resolves.toMatchObject({ success: false, errorCode: 'functions_unconfigured' });
  expect(state.callable).not.toHaveBeenCalled();
});

it('calls Cloud Functions when the functions base URL is set', async () => {
  state.callable.mockResolvedValue({ data: { content: '目前有兩項作業。', run: { status: 'completed' } } });
  await expect(callCampusAssistant(input)).resolves.toMatchObject({ content: '目前有兩項作業。' });
  expect(state.callable).toHaveBeenCalledTimes(1);
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

it('requests the signed-in account snapshot for the selected school only', async () => {
  state.callable.mockResolvedValue({
    data: {
      schoolId: 'pu',
      checkedAt: '2026-10-26T12:00:00Z',
      schedule: { status: 'unavailable', count: null },
      assignments: { status: 'available', count: 0, items: [] },
      announcements: { status: 'unavailable', items: [] },
    },
  });
  await expect(getCampusAssistantSnapshot('alice', 'pu')).resolves.toMatchObject({ schoolId: 'pu' });
  expect(state.callable).toHaveBeenCalledWith({ schoolId: 'pu' });
  await expect(getCampusAssistantSnapshot('alice', 'nthu')).rejects.toMatchObject({ code: 'invalid-response' });
});

it('submits a confirmed write with its run id and no fabricated receipt', async () => {
  state.callable.mockResolvedValue({ data: { success: true, toolName: 'submitLeaveRequest', requestId: 'req-9' } });
  await expect(executeCampusAgentWrite({
    userId: 'alice', schoolId: 'pu', toolName: 'submitLeaveRequest',
    payload: { courseId: 'class-1', date: '2026-10-27', type: '事假' },
    agentRunId: '01234567-89ab-4cde-8012-3456789abcde',
  })).resolves.toMatchObject({ success: true, requestId: 'req-9' });
  expect(state.callable).toHaveBeenCalledWith(expect.objectContaining({
    toolName: 'submitLeaveRequest',
    agentRunId: '01234567-89ab-4cde-8012-3456789abcde',
    context: expect.objectContaining({ schoolId: 'pu' }),
  }));
  state.callable.mockResolvedValue({ data: { status: 'ok' } });
  await expect(executeCampusAgentWrite({
    userId: 'alice', schoolId: 'pu', toolName: 'submitLeaveRequest',
    payload: { courseId: 'class-1' }, agentRunId: '01234567-89ab-4cde-8012-3456789abcde',
  })).rejects.toMatchObject({ code: 'invalid-response' });
});

const cancelPayload = { reservationId: 'wash-1', expectedReservationVersion: 'a'.repeat(64), machineId: 'A2',
  dormitory: '女生宿舍', startTime: '2030-01-02T09:00:00+08:00', reservedUntil: '2030-01-02T02:00:00.000Z' };
const cancelInput = { userId: 'alice', schoolId: 'pu', toolName: 'cancelWashingReservation',
  payload: cancelPayload, agentRunId: '01234567-89ab-4cde-8012-3456789abcde' };
const cancelReceipt = { success: true, toolName: 'cancelWashingReservation', reservationId: 'wash-1', machineId: 'A2',
  dormitory: '女生宿舍', startTime: cancelPayload.startTime, reservedUntil: cancelPayload.reservedUntil,
  status: 'cancelled', schoolId: 'pu', userId: 'alice' };
it.each([cancelPayload.reservedUntil, null])('accepts only the complete matching cancellation receipt with end %s', async reservedUntil => {
  state.callable.mockResolvedValue({ data: { ...cancelReceipt, reservedUntil } });
  await expect(executeCampusAgentWrite({ ...cancelInput, payload: { ...cancelPayload, reservedUntil } }))
    .resolves.toMatchObject({ success: true, reservationId: 'wash-1', status: 'cancelled' });
  expect(state.callable).toHaveBeenCalledWith(expect.objectContaining({ agentRunId: cancelInput.agentRunId,
    input: { ...cancelPayload, reservedUntil } }));
});
it.each([
  { success: true, toolName: 'cancelWashingReservation' },
  ...['reservationId', 'machineId', 'dormitory', 'startTime', 'reservedUntil', 'status', 'schoolId', 'userId']
    .flatMap(key => [{ ...cancelReceipt, [key]: undefined }, { ...cancelReceipt, [key]: 'different' }]),
])('rejects incomplete or mismatched cancellation receipt %#', async data => {
  state.callable.mockResolvedValue({ data });
  await expect(executeCampusAgentWrite(cancelInput)).rejects.toMatchObject({ code: 'invalid-response' });
});
it.each(['reservationId', 'expectedReservationVersion', 'machineId', 'dormitory', 'startTime', 'reservedUntil'])
  ('does not dispatch incomplete cancellation missing %s', async key => {
    const payload = { ...cancelPayload } as Record<string, unknown>;
    delete payload[key];
    state.callable.mockResolvedValue({ data: cancelReceipt });
    await expect(executeCampusAgentWrite({ ...cancelInput, payload })).rejects.toThrow();
    expect(state.callable).not.toHaveBeenCalled();
  });
it('does not accept cancellation success after abort or account change', async () => {
  let finish!: (result: unknown) => void;
  state.callable.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const controller = new AbortController();
  const pending = executeCampusAgentWrite(cancelInput, controller.signal);
  controller.abort();
  finish({ data: cancelReceipt });
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  const changed = executeCampusAgentWrite(cancelInput);
  state.uid = 'bob';
  finish({ data: cancelReceipt });
  await expect(changed).rejects.toMatchObject({ code: 'session-changed' });
});

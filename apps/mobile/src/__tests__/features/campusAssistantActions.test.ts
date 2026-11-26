import { httpsCallable } from 'firebase/functions';
import {
  campusAgentWriteProposals,
  confirmCampusAgentWrite,
} from '../../features/campusAssistantActions';

let mockCurrentUid: string | null = 'alice';
let mockFakeMode = false;
const mockCallable = jest.fn();

jest.mock('firebase/functions', () => ({ httpsCallable: jest.fn(() => mockCallable) }));
jest.mock('../../firebase', () => ({
  getAuthInstance: () => ({ currentUser: mockCurrentUid ? { uid: mockCurrentUid } : null }),
  getFunctionsInstance: () => ({}),
  isFirebaseMockMode: () => mockFakeMode,
}));

const runId = '01234567-89ab-4cde-8012-3456789abcde';
const input = { dormitory: 'A棟', room: '301', category: '冷氣', description: '沒有冷風' };

function envelope(overrides: Record<string, unknown> = {}) {
  return {
    run: { runId, status: 'completed' },
    actions: [{
      action: 'queue_action',
      status: 'pending_confirmation',
      requiresConfirmation: true,
      label: '確認存成報修備忘',
      params: { toolName: 'createDormRepairRequest', input, agentRunId: runId },
    }],
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCallable.mockReset();
  mockCurrentUid = 'alice';
  mockFakeMode = false;
  mockCallable.mockResolvedValue({ data: { success: true, toolName: 'createDormRepairRequest', repairId: 'repair-1' } });
});

test('only trusted completed run actions become executable proposals', () => {
  expect(campusAgentWriteProposals(envelope())).toEqual([{
    label: '確認存成報修備忘',
    agentRunId: runId,
    toolName: 'createDormRepairRequest',
    input,
  }]);
  expect(campusAgentWriteProposals(envelope({ run: { runId, status: 'blocked' } }))).toEqual([]);
  expect(campusAgentWriteProposals(envelope({ run: { runId: 'invalid', status: 'completed' } }))).toEqual([]);
  expect(campusAgentWriteProposals(envelope({
    actions: [{ action: 'queue_action', status: 'pending_confirmation', requiresConfirmation: true,
      label: '無效', params: { toolName: 'deleteAccount', input, agentRunId: runId } }],
  }))).toEqual([]);
  expect(campusAgentWriteProposals(envelope({
    actions: [{ action: 'queue_action', status: 'pending_confirmation', requiresConfirmation: true,
      label: '不同執行紀錄', params: {
        toolName: 'createDormRepairRequest', input,
        agentRunId: '11111111-1111-1111-1111-111111111111',
      } }],
  }))).toEqual([]);
});

test('invalid or incomplete write payload is not made executable', () => {
  expect(campusAgentWriteProposals(envelope({
    actions: [{ action: 'queue_action', status: 'pending_confirmation', requiresConfirmation: true,
      params: { toolName: 'createDormRepairRequest', input: { room: '301' }, agentRunId: runId } }],
  }))).toEqual([]);
  expect(campusAgentWriteProposals(envelope({
    actions: [{ action: 'queue_action', status: 'pending_confirmation', requiresConfirmation: false,
      params: { toolName: 'createDormRepairRequest', input, agentRunId: runId } }],
  }))).toEqual([]);
});

test('explicitly confirmed action calls the existing authenticated function and uses only server receipt', async () => {
  const proposal = campusAgentWriteProposals(envelope())[0];
  const result = await confirmCampusAgentWrite({
    userId: 'alice', schoolId: 'pu', isCurrent: () => true, proposal,
  });
  expect(result).toMatchObject({ success: true, repairId: 'repair-1' });
  expect(httpsCallable).toHaveBeenCalledWith({}, 'executeAgentWrite');
  expect(mockCallable).toHaveBeenCalledWith({
    toolName: 'createDormRepairRequest',
    input,
    agentRunId: runId,
    context: { schoolId: 'pu', timezone: 'Asia/Taipei' },
  });
});

test('rechecks account and school scope before writing or admitting a late receipt', async () => {
  const proposal = campusAgentWriteProposals(envelope())[0];
  mockCurrentUid = 'bob';
  await expect(confirmCampusAgentWrite({
    userId: 'alice', schoolId: 'pu', isCurrent: () => true, proposal,
  })).rejects.toThrow('session-changed');
  expect(mockCallable).not.toHaveBeenCalled();

  mockCurrentUid = 'alice';
  let settle!: (data: unknown) => void;
  mockCallable.mockImplementationOnce(() => new Promise(resolve => { settle = resolve; }));
  const pending = confirmCampusAgentWrite({
    userId: 'alice', schoolId: 'pu', isCurrent: () => true, proposal,
  });
  mockCurrentUid = 'bob';
  settle({ data: { success: true, toolName: 'createDormRepairRequest', repairId: 'old-user' } });
  await expect(pending).rejects.toThrow('session-changed');
});

test('a model-looking success without a typed server receipt is rejected', async () => {
  mockCallable.mockResolvedValueOnce({ data: { success: 'yes', toolName: 'createDormRepairRequest' } });
  await expect(confirmCampusAgentWrite({
    userId: 'alice', schoolId: 'pu', isCurrent: () => true,
    proposal: campusAgentWriteProposals(envelope())[0],
  })).rejects.toThrow('invalid-receipt');
});

const washingInput = {
  reservationId: 'washing-2',
  machineId: 'A2',
  dormitory: 'A棟',
  startTime: '18:30',
  reservedUntil: '2030-01-02T10:40:00.000Z',
  expectedReservationVersion: 'a'.repeat(64),
};
const washingProposal = {
  toolName: 'cancelWashingReservation' as const,
  label: '確認取消洗衣預約',
  input: washingInput,
  agentRunId: runId,
};
const washingReceipt = {
  success: true, toolName: 'cancelWashingReservation',
  reservationId: 'washing-2', machineId: 'A2', dormitory: 'A棟',
  startTime: '18:30', reservedUntil: '2030-01-02T10:40:00.000Z',
  status: 'cancelled', schoolId: 'pu', userId: 'alice',
};

function washingEnvelope(payload: Record<string, unknown> = washingInput) {
  return envelope({ actions: [{
    action: 'queue_action', status: 'pending_confirmation', requiresConfirmation: true,
    label: washingProposal.label,
    params: { toolName: washingProposal.toolName, input: payload, agentRunId: runId },
  }] });
}

test.each([washingInput.reservedUntil, null])('admits the complete washing cancellation snapshot with reservation expiry %s', reservedUntil => {
  const payload = { ...washingInput, reservedUntil };
  expect(campusAgentWriteProposals(washingEnvelope(payload))).toEqual([{ ...washingProposal, input: payload }]);
});

test.each([
  { reservationId: undefined }, { reservationId: 'other/path' },
  { reservationId: 'x'.repeat(129) }, { machineId: 'other/path' },
  { machineId: '' }, { dormitory: '' }, { startTime: '' },
  { dormitory: 'x'.repeat(101) }, { startTime: 'x'.repeat(41) },
  { reservedUntil: undefined }, { reservedUntil: 'not-a-time' },
  { reservedUntil: '2030-02-30T10:40:00.000Z' }, { reservedUntil: '2030-01-02T18:40:00+08:00' },
  { expectedReservationVersion: undefined }, { expectedReservationVersion: 'not-a-version' },
  { unexpectedField: 'unreviewed' },
])('does not expose cancellation without a complete source snapshot %#', override => {
  expect(campusAgentWriteProposals(washingEnvelope({ ...washingInput, ...override }))).toEqual([]);
});

test('requires a completed matching run and pending confirmation for washing cancellation', () => {
  const complete = washingEnvelope();
  expect(campusAgentWriteProposals({ ...complete, run: { runId, status: 'failed' } })).toEqual([]);
  const action = complete.actions[0] as Record<string, unknown>;
  expect(campusAgentWriteProposals({ ...complete, actions: [{ ...action, status: 'completed' }] })).toEqual([]);
  expect(campusAgentWriteProposals({ ...complete, actions: [{ ...action, requiresConfirmation: false }] })).toEqual([]);
  expect(campusAgentWriteProposals({ ...complete, run: { runId: 'ffffffff-ffff-ffff-ffff-ffffffffffff', status: 'completed' } })).toEqual([]);
});

test.each([washingInput.reservedUntil, null])('sends the reviewed washing reservation unchanged and accepts a matching receipt with expiry %s', async reservedUntil => {
  const proposal = { ...washingProposal, input: { ...washingInput, reservedUntil } };
  mockCallable.mockResolvedValue({ data: { ...washingReceipt, reservedUntil } });
  await expect(confirmCampusAgentWrite({
    userId: 'alice', schoolId: 'pu', isCurrent: () => true, proposal,
  })).resolves.toEqual({ ...washingReceipt, reservedUntil });
  expect(mockCallable).toHaveBeenCalledTimes(1);
  expect(mockCallable).toHaveBeenCalledWith({
    toolName: 'cancelWashingReservation', input: proposal.input, agentRunId: runId,
    context: { schoolId: 'pu', timezone: 'Asia/Taipei' },
  });
});

test.each([
  { success: true, toolName: 'cancelWashingReservation' },
  ...[
    { reservationId: 'washing-other' }, { machineId: 'A1' }, { dormitory: 'B棟' },
    { startTime: '19:30' }, { reservedUntil: null }, { reservedUntil: undefined },
    { status: 'reserved' }, { schoolId: 'other-school' }, { userId: 'bob' },
  ].map(change => ({ ...washingReceipt, ...change })),
])('rejects bare or mismatched washing cancellation success %#', async data => {
  mockCallable.mockResolvedValue({ data });
  await expect(confirmCampusAgentWrite({
    userId: 'alice', schoolId: 'pu', isCurrent: () => true, proposal: washingProposal,
  })).rejects.toThrow('invalid-receipt');
});

test('washing cancellation refuses mock mode or a stale scope and ignores a late receipt', async () => {
  mockFakeMode = true;
  await expect(confirmCampusAgentWrite({
    userId: 'alice', schoolId: 'pu', isCurrent: () => true, proposal: washingProposal,
  })).rejects.toThrow('session-changed');
  mockFakeMode = false;
  await expect(confirmCampusAgentWrite({
    userId: 'alice', schoolId: 'pu', isCurrent: () => false, proposal: washingProposal,
  })).rejects.toThrow('session-changed');
  expect(mockCallable).not.toHaveBeenCalled();

  let current = true;
  let settle!: (value: unknown) => void;
  mockCallable.mockImplementationOnce(() => new Promise(resolve => { settle = resolve; }));
  const response = confirmCampusAgentWrite({
    userId: 'alice', schoolId: 'pu', isCurrent: () => current, proposal: washingProposal,
  });
  const rejected = expect(response).rejects.toThrow('session-changed');
  current = false;
  settle?.({ data: washingReceipt });
  await rejected;
  expect(mockCallable).toHaveBeenCalledTimes(1);
});

test('washing cancellation keeps a failed receipt failed without retrying', async () => {
  const failure = { success: false, toolName: 'cancelWashingReservation', errorCode: 'failed-precondition' };
  mockCallable.mockResolvedValueOnce({ data: failure });
  await expect(confirmCampusAgentWrite({
    userId: 'alice', schoolId: 'pu', isCurrent: () => true, proposal: washingProposal,
  })).resolves.toEqual(failure);
  expect(mockCallable).toHaveBeenCalledTimes(1);
});

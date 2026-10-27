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
      label: '確認送出報修',
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
    label: '確認送出報修',
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

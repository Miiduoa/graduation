import { httpsCallable } from 'firebase/functions';
import { getAuthInstance, getFunctionsInstance, isFirebaseMockMode } from '../firebase';

export type CampusAgentWriteTool =
  | 'submitLeaveRequest'
  | 'createDormRepairRequest'
  | 'reserveSeat'
  | 'borrowBook'
  | 'renewBook'
  | 'returnBook'
  | 'reserveWashingMachine';

export interface CampusAgentWriteProposal {
  label: string;
  toolName: CampusAgentWriteTool;
  input: Record<string, unknown>;
  agentRunId: string;
}

export interface CampusAgentWriteReceipt {
  success: boolean;
  toolName: CampusAgentWriteTool;
  requestId?: string;
  repairId?: string;
  reservationId?: string;
  loanId?: string;
  status?: string;
  errorCode?: string;
  errorMessage?: string;
}

const requiredFields: Record<CampusAgentWriteTool, readonly string[]> = {
  submitLeaveRequest: ['courseId', 'date', 'type'],
  createDormRepairRequest: ['dormitory', 'room', 'category', 'description'],
  reserveSeat: ['seatId', 'date', 'startTime', 'endTime'],
  borrowBook: ['bookId'],
  renewBook: ['loanId'],
  returnBook: ['loanId'],
  reserveWashingMachine: ['dormitory', 'machineId', 'startTime'],
};

function object(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function isWriteTool(value: unknown): value is CampusAgentWriteTool {
  return typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(requiredFields, value);
}

export function campusAgentWriteProposals(
  envelope: { run?: { runId?: string; status?: string }; actions?: unknown[] },
): CampusAgentWriteProposal[] {
  const run = envelope.run;
  if (run?.status !== 'completed' || !/^[0-9a-f-]{32,36}$/i.test(run.runId || '')) {
    return [];
  }
  if (!Array.isArray(envelope.actions)) return [];
  return envelope.actions.slice(0, 12).flatMap((item): CampusAgentWriteProposal[] => {
    const action = object(item);
    const params = object(action?.params);
    const input = object(params?.input);
    if (!action || !params || !input || action.action !== 'queue_action' ||
        action.requiresConfirmation !== true || action.status !== 'pending_confirmation' ||
        !isWriteTool(params.toolName) || params.agentRunId !== run.runId ||
        !requiredFields[params.toolName].every((key) =>
          typeof input[key] === 'string' && !!(input[key] as string).trim())) {
      return [];
    }
    try {
      const serialized = JSON.stringify(input);
      if (serialized.length > 4000) return [];
    } catch {
      return [];
    }
    return [{
      toolName: params.toolName,
      label: typeof action.label === 'string' ? action.label.slice(0, 70) : '確認執行',
      input,
      agentRunId: run.runId!,
    }];
  }).slice(0, 3);
}

/** A model suggestion is never an execution credential: the server validates
 * the proposal against the current user's completed, single-use agent run. */
export async function confirmCampusAgentWrite(params: {
  userId: string;
  schoolId: string;
  isCurrent: () => boolean;
  proposal: CampusAgentWriteProposal;
}): Promise<CampusAgentWriteReceipt> {
  const checkScope = () => {
    if (!params.isCurrent() || isFirebaseMockMode() || !params.userId || !params.schoolId ||
        getAuthInstance().currentUser?.uid !== params.userId) {
      throw new Error('session-changed');
    }
  };
  checkScope();

  const prepared = campusAgentWriteProposals({
    run: { status: 'completed', runId: params.proposal.agentRunId },
    actions: [{
      action: 'queue_action',
      status: 'pending_confirmation',
      requiresConfirmation: true,
      label: params.proposal.label,
      params: {
        toolName: params.proposal.toolName,
        input: params.proposal.input,
        agentRunId: params.proposal.agentRunId,
      },
    }],
  })[0];
  if (!prepared) throw new Error('invalid-proposal');

  const callable = httpsCallable<
    {
      toolName: CampusAgentWriteTool;
      input: Record<string, unknown>;
      agentRunId: string;
      context: { schoolId: string; timezone: string };
    },
    CampusAgentWriteReceipt
  >(getFunctionsInstance(), 'executeAgentWrite');
  const result = await callable({
    toolName: prepared.toolName,
    input: prepared.input,
    agentRunId: prepared.agentRunId,
    context: { schoolId: params.schoolId, timezone: 'Asia/Taipei' },
  });
  checkScope();
  const receipt = result.data;
  if (!receipt || typeof receipt.success !== 'boolean' ||
      receipt.toolName !== prepared.toolName) {
    throw new Error('invalid-receipt');
  }
  return receipt;
}

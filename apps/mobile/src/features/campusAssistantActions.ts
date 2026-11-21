import { httpsCallable } from 'firebase/functions';
import { getAuthInstance, getFunctionsInstance, isFirebaseMockMode } from '../firebase';

export type CampusAgentWriteTool =
  | 'submitLeaveRequest'
  | 'createDormRepairRequest'
  | 'reserveSeat'
  | 'borrowBook'
  | 'renewBook'
  | 'returnBook'
  | 'reserveWashingMachine'
  | 'cancelWashingReservation';

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
  machineId?: string;
  dormitory?: string;
  startTime?: string;
  reservedUntil?: string | null;
  schoolId?: string;
  userId?: string;
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
  cancelWashingReservation: ['reservationId', 'expectedReservationVersion', 'machineId', 'dormitory', 'startTime'],
};

function object(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function isWriteTool(value: unknown): value is CampusAgentWriteTool {
  return typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(requiredFields, value);
}

const cancellationFields = ['reservationId', 'expectedReservationVersion', 'machineId', 'dormitory', 'startTime', 'reservedUntil'];

function cancellationText(value: unknown, limit: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= limit &&
    !/[\p{Cc}\p{Cf}]/u.test(value);
}

function isWashingCancellationInput(input: Record<string, unknown>): boolean {
  const expiry = input.reservedUntil;
  return Object.keys(input).length === cancellationFields.length &&
    cancellationFields.every(key => Object.prototype.hasOwnProperty.call(input, key)) &&
    ['reservationId', 'machineId'].every(key => cancellationText(input[key], 128) && !(input[key] as string).includes('/')) &&
    cancellationText(input.dormitory, 100) && cancellationText(input.startTime, 40) &&
    typeof input.expectedReservationVersion === 'string' && /^[a-f0-9]{64}$/i.test(input.expectedReservationVersion) &&
    (expiry === null || (typeof expiry === 'string' && Number.isFinite(Date.parse(expiry)) &&
      new Date(expiry).toISOString() === expiry));
}

/** A cancellation receipt must confirm the same source snapshot and actor that were reviewed. */
export function isWashingCancellationReceipt(value: unknown, input: Record<string, unknown>,
  scope: { userId: string; schoolId: string }): boolean {
  const receipt = object(value);
  return !!receipt && isWashingCancellationInput(input) && receipt.success === true &&
    receipt.toolName === 'cancelWashingReservation' && receipt.status === 'cancelled' &&
    receipt.userId === scope.userId && receipt.schoolId === scope.schoolId &&
    ['reservationId', 'machineId', 'dormitory', 'startTime', 'reservedUntil']
      .every(key => Object.prototype.hasOwnProperty.call(receipt, key) && receipt[key] === input[key]);
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
    if (params.toolName === 'cancelWashingReservation' && !isWashingCancellationInput(input)) return [];
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
      receipt.toolName !== prepared.toolName ||
      (prepared.toolName === 'cancelWashingReservation' && receipt.success &&
        !isWashingCancellationReceipt(receipt, prepared.input, params))) {
    throw new Error('invalid-receipt');
  }
  return receipt;
}

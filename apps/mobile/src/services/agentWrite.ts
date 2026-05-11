import { getFunctions, httpsCallable, type HttpsCallableResult } from 'firebase/functions';
import { getFirebaseApp, getCloudFunctionRegion } from '../firebase';

export type ExecuteAgentWriteParams = {
  toolName: string;
  input: Record<string, unknown>;
  context?: { groupId?: string; timezone?: string };
  /** 對應 users/{uid}/agentRuns/{id}，成功／失敗會追加一步 toolCalls */
  agentRunId?: string;
};

export type ExecuteAgentWriteResult = {
  success?: boolean;
  toolName?: string;
  requestId?: string;
  repairId?: string;
  orderId?: string;
  status?: string;
  errorCode?: string;
  errorMessage?: string;
  [key: string]: unknown;
};

export async function executeAgentWrite(
  params: ExecuteAgentWriteParams,
): Promise<ExecuteAgentWriteResult> {
  const fn = httpsCallable<ExecuteAgentWriteParams, ExecuteAgentWriteResult>(
    getFunctions(getFirebaseApp(), getCloudFunctionRegion()),
    'executeAgentWrite',
  );
  const result: HttpsCallableResult<ExecuteAgentWriteResult> = await fn(params);
  return (result.data ?? {}) as ExecuteAgentWriteResult;
}

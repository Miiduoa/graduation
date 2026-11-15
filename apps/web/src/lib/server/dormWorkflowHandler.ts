import {
  createDormWorkflowHandler,
  HttpsError as FunctionsHttpsError,
} from '../../../../../backend/functions/dormWorkflow.js';
import { HttpsError, type FunctionsErrorCode } from './httpsError';
import type { CallableRequest } from './groupInviteHandlers';

/** Use the original handler and authz; no hosted permission model. */
export async function invokeDormWorkflow(db: unknown, request: CallableRequest): Promise<unknown> {
  const handler = createDormWorkflowHandler({
    db,
    // Web has no push sender. Records remain authoritative when push is unavailable.
    sendPushToUser: async () => undefined,
    getBucket: () => {
      throw new HttpsError('unavailable', '照片服務暫時無法使用，請先以文字送出。');
    },
  });
  try {
    return await handler(request);
  } catch (error) {
    // Firebase Functions uses its own HttpsError class. Translate only that class.
    if (error instanceof FunctionsHttpsError)
      throw new HttpsError(error.code as FunctionsErrorCode, error.message, error.details);
    throw error;
  }
}

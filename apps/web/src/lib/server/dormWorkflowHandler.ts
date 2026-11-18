import { getStorage } from 'firebase-admin/storage';
import {
  createDormWorkflowHandler,
  HttpsError as FunctionsHttpsError,
} from '../../../../../backend/functions/dormWorkflow.js';
import { HttpsError, type FunctionsErrorCode } from './httpsError';
import type { CallableRequest } from './groupInviteHandlers';

// Web and Functions install different Admin SDK versions; share the runtime bucket contract.
type WorkflowBucket = ReturnType<
  NonNullable<Parameters<typeof createDormWorkflowHandler>[0]['getBucket']>
>;

/** Use the original handler and authz; no hosted permission model. */
export async function invokeDormWorkflow(db: unknown, request: CallableRequest): Promise<unknown> {
  const handler = createDormWorkflowHandler({
    db,
    // Web has no push sender. Records remain authoritative when push is unavailable.
    sendPushToUser: async () => {
      throw new HttpsError('unavailable', '推播服務暫不可用');
    },
    getBucket: () => {
      try {
        return getStorage().bucket(
          process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || undefined,
        ) as unknown as WorkflowBucket;
      } catch {
        throw new HttpsError('unavailable', '照片服務暫不可用，請稍後再試。');
      }
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

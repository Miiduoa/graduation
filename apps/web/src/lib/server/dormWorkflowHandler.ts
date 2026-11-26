import { getStorage } from 'firebase-admin/storage';
import { createNotificationService } from '../../../../../backend/functions/lib/notificationService.js';
import type { FnRuntime } from './fnDispatch';
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
export async function invokeDormWorkflow(db: import('firebase-admin/firestore').Firestore, request: CallableRequest, messaging?: FnRuntime['messaging']): Promise<unknown> {
  // Only the production Admin runtime has a push transport. Emulators stay local.
  const sendPushToUser = messaging
    ? createNotificationService({ db, messaging }).sendPushToUser
    : async () => ({ status: 'skipped', accepted: 0 });
  const handler = createDormWorkflowHandler({
    db,
    sendPushToUser,
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

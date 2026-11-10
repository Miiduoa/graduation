import { randomUUID } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { createEnsureCampusStoryBindingHandler } from '../../../../../backend/functions/campusStoryAccessBinding.js';
import { HttpsError } from './httpsError';
import type { CallableRequest } from './groupInviteHandlers';

type BindingHandler = (request: CallableRequest) => Promise<{ success: true; stamped: string[] }>;
type BindingFactory = (options: {
  db: unknown;
  FieldValue: typeof FieldValue;
  randomUUID: () => string;
  HttpsError: typeof HttpsError;
}) => BindingHandler;

/** Same stamp / cooldown / eligibility logic as Cloud Functions. Do not fork it. */
export function createCampusStoryBindingHandler(db: unknown): BindingHandler {
  return (createEnsureCampusStoryBindingHandler as BindingFactory)({
    db,
    FieldValue,
    randomUUID: () => randomUUID(),
    HttpsError,
  });
}

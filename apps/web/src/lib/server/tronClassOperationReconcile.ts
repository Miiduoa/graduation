import { createHash } from 'node:crypto';
import { NuniError } from '@campus/shared/src/nuni';
import type { TronClassAcknowledgedReadbackResult } from '@campus/shared/src/tronClassSubmissionConfirmation';
import {
  TRONCLASS_SUBMISSION_COLLECTION,
  type TronClassSubmissionBindings,
  type TronClassSubmissionFirestore,
  type TronClassSubmissionResult,
} from './tronClassSubmission';
import type { TronClassSubmissionBinding } from './tronClassSubmissionSource';
import { createTronClassControlledJournal } from './tronClassControlledJournal';
import { createTronClassRawSubmissionHistoryReader } from './tronClassRawSubmissionHistory';
import { verifyTronClassSubmissionReadback } from './tronClassSubmissionReadback';
import { mapTronClassSubmissionConfirmation } from './tronClassSubmissionConfirmation';

type Input = { operationId: string; revision: string };
type Result = TronClassSubmissionResult | TronClassAcknowledgedReadbackResult;
type Dependencies = {
  db: TronClassSubmissionFirestore;
  bindings: TronClassSubmissionBindings;
  legacyReconcile(ownerKey: string, input: Input, snapshot?: TronClassSubmissionBinding): Promise<TronClassSubmissionResult>;
  readHistory?: ReturnType<typeof createTronClassRawSubmissionHistoryReader>;
  now?: () => number;
};

function fail(status: number, code: string): never { throw new NuniError(status, code); }
const operationIdPattern = /^[A-Za-z0-9_-]{16,80}$/;
const revisionPattern = /^[a-f0-9]{32}$/;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

/**
 * The public reconciliation path has no upload or POST dependency. A v2 result
 * is derived from the durable acknowledged attempt and a fresh, owned school
 * read. Legacy v1 records retain their original receipt/freshness semantics.
 * Unknown locks, operation versions and immutable attempts are never rewritten.
 */
export function createTronClassOperationReconciler({
  db, bindings, legacyReconcile, now = Date.now, readHistory = createTronClassRawSubmissionHistoryReader({ bindings, now }),
}: Dependencies) {
  const journal = createTronClassControlledJournal({ db, bindings, now });
  return async function reconcile(ownerKey: string, input: Input): Promise<Result> {
    if (typeof ownerKey !== 'string' || !ownerKey || ownerKey.length > 200 ||
      !input || typeof input.operationId !== 'string' || !operationIdPattern.test(input.operationId) ||
      typeof input.revision !== 'string' || !revisionPattern.test(input.revision)) fail(400, 'TRONCLASS_INVALID_INPUT');
    const expected = Object.freeze({ operationId: input.operationId, revision: input.revision });
    const unknown = (): TronClassSubmissionResult => ({ status: 'unknown', operationId: expected.operationId, receipt: null });
    const session = await bindings.requireBinding(ownerKey, expected.revision);
    const binding = { ...session, cookies: { ...session.cookies } };
    const current = async () => {
      const at = now();
      if (binding.schoolId !== 'pu' || !Number.isSafeInteger(binding.userId) || binding.userId < 1 ||
        binding.revision !== expected.revision) {
        fail(409, 'TRONCLASS_BINDING_CHANGED');
      }
      if (!Number.isFinite(at) || !Number.isFinite(Date.parse(binding.expiresAt)) || Date.parse(binding.expiresAt) <= at) {
        fail(401, 'TRONCLASS_RECONNECT_REQUIRED');
      }
      await bindings.assertCurrent(ownerKey, binding.revision);
    };
    await current();
    const snapshot = await db.doc(`${TRONCLASS_SUBMISSION_COLLECTION}/${hash(JSON.stringify([ownerKey, expected.operationId]))}`).get();
    await current();
    // Select by the persisted format only. A v2 record cannot fall through to a
    // v1 parser, even when malformed or when a writer is currently disabled.
    if (!snapshot.exists || snapshot.data()?.version === 1) return legacyReconcile(ownerKey, expected, binding);
    if (snapshot.data()?.version !== 2) fail(409, 'TRONCLASS_OPERATION_CONFLICT');
    const attempt = await journal.readAttempt(ownerKey, expected.operationId, expected.revision);
    await current();
    // A preparing operation can still be claimed by another in-flight actor.
    // Only an atomic cancellation could establish that it will never dispatch;
    // this read-only path deliberately cannot make that claim.
    if (!attempt) return unknown();
    if (attempt.ownerKey !== ownerKey || attempt.operationId !== expected.operationId || attempt.studentId !== binding.userId) {
      fail(409, 'TRONCLASS_OPERATION_CONFLICT');
    }
    // A lost final response cannot be repaired by guessing a school version
    // from identical content. No acknowledgment means no school read is needed.
    if (!attempt.acknowledgment) return unknown();
    let raw: unknown;
    try {
      raw = await readHistory(ownerKey, binding, { courseId: attempt.courseId, homeworkId: attempt.homeworkId });
    } catch (error) {
      await current();
      if (error instanceof NuniError && [
        'TRONCLASS_BINDING_CHANGED', 'TRONCLASS_RECONNECT_REQUIRED', 'TRONCLASS_NOT_CONNECTED',
        'TRONCLASS_COURSE_ACCESS_DENIED', 'TRONCLASS_HOMEWORK_NOT_FOUND', 'SESSION_CHANGED', 'SIGN_IN_REQUIRED',
      ].includes(error.code)) throw new NuniError(error.status, error.code);
      // A timeout or incomplete history cannot undo an already attempted POST.
      return unknown();
    }
    await current();
    const at = now();
    const readback = verifyTronClassSubmissionReadback(raw, {
      acknowledgment: attempt.acknowledgment,
      priorHistoryComplete: attempt.priorHistoryComplete,
      priorSubmissionIds: attempt.priorSubmissionIds,
      comment: attempt.comment,
      uploads: attempt.uploads,
    }, at);
    if (readback.state !== 'verified-new-version') return unknown();
    const result = mapTronClassSubmissionConfirmation(ownerKey, attempt, {
      ...readback, operationId: expected.operationId, confirmedAt: new Date(at).toISOString(),
    });
    // Account closure, revocation or a student switch during verification must
    // prevent even a previously matched result from reaching the public API.
    await current();
    return result;
  };
}

import {
  createTronClassAttachmentUploadCandidate, type TronClassAttachmentCandidateDependencies,
  type TronClassAttachmentCandidateInput,
} from './tronClassAttachmentCandidate';
import { createTronClassFinalSubmissionCandidate, type TronClassFinalCandidateInput } from './tronClassFinalSubmissionCandidate';
import { createTronClassControlledJournal } from './tronClassControlledJournal';
import type { TronClassCandidateAuthorization } from './tronClassSubmissionCandidate';
import type { TronClassSubmissionBindings, TronClassSubmissionFirestore } from './tronClassSubmission';
import type { TronClassHomeworkScope, TronClassSubmissionBinding } from './tronClassSubmissionSource';
import type { FetchLike } from './puEdgeRelay';

export type TronClassControlledSubmissionDependencies = {
  db: TronClassSubmissionFirestore;
  bindings: TronClassSubmissionBindings;
  /** Source-confirmed authorization, never browser-supplied permissions. */
  authorize(ownerKey: string, scope: TronClassHomeworkScope): Promise<TronClassCandidateAuthorization>;
  readHistory(binding: TronClassSubmissionBinding, scope: TronClassHomeworkScope, signal: AbortSignal): Promise<unknown>;
  resolveStorageTarget: TronClassAttachmentCandidateDependencies['resolveStorageTarget'];
  enabled?: () => boolean;
  fetchSchool?: FetchLike;
  fetchStorage?: FetchLike;
  now?: () => number;
};

/**
 * Server-only wiring for a controlled verification session. There is no default
 * source permission reader, storage allowlist, public HTTP route or environment
 * toggle that can enable production writes. The journal uses the existing
 * server-only Firestore collections and account-closure barrier.
 */
export function createTronClassControlledSubmission(dependencies: TronClassControlledSubmissionDependencies) {
  const journal = createTronClassControlledJournal({ db: dependencies.db, bindings: dependencies.bindings, now: dependencies.now });
  const assertCurrent = (ownerKey: string, revision: string) => dependencies.bindings.assertCurrent(ownerKey, revision);
  const attachments = createTronClassAttachmentUploadCandidate({
    enabled: dependencies.enabled,
    authorize: dependencies.authorize,
    assertCurrent,
    claim: journal.claimAttachment,
    resolveStorageTarget: dependencies.resolveStorageTarget,
    fetchSchool: dependencies.fetchSchool,
    fetchStorage: dependencies.fetchStorage,
    now: dependencies.now,
  });
  const final = createTronClassFinalSubmissionCandidate({
    enabled: dependencies.enabled,
    authorize: dependencies.authorize,
    assertCurrent,
    requireBinding: ownerKey => dependencies.bindings.requireBinding(ownerKey),
    readUploadedFiles: journal.readUploadedFiles,
    claim: journal.claimFinal,
    rememberAcknowledgment: journal.rememberAcknowledgment,
    readAttempt: journal.readAttempt,
    readHistory: dependencies.readHistory,
    fetch: dependencies.fetchSchool,
    now: dependencies.now,
  });
  return Object.freeze({
    contractVerified: false as const,
    async upload(ownerKey: string, input: TronClassAttachmentCandidateInput, signal?: AbortSignal) {
      const transferred = await attachments.dispatch(ownerKey, input, signal);
      // A response is usable by final only after its exact claim has been
      // updated durably. A failed save leaves the original non-repeatable claim.
      await journal.storeTransferredFile(transferred);
      await assertCurrent(ownerKey, transferred.revision);
      return transferred;
    },
    dispatch(ownerKey: string, input: TronClassFinalCandidateInput, signal?: AbortSignal) {
      return final.dispatch(ownerKey, input, signal);
    },
    reconcile(ownerKey: string, operationId: string, signal?: AbortSignal) {
      return final.reconcile(ownerKey, operationId, signal);
    },
  });
}

import 'server-only';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { NuniError } from '@campus/shared/src/nuni';
import type { TronClassAcknowledgedReadbackResult } from '@campus/shared/src/tronClassSubmissionConfirmation';
import {
  createTronClassControlledSubmission,
  type TronClassControlledSubmissionDependencies,
} from './tronClassControlledSubmission';
import { createTronClassControlledJournal } from './tronClassControlledJournal';
import {
  tronClassFinalCandidateDigest,
  type TronClassFinalCandidateAttempt,
} from './tronClassFinalSubmissionCandidate';
import {
  assertTronClassCandidateAuthorization,
  tronClassCandidateHeaders,
} from './tronClassSubmissionCandidate';
import { buildTronClassNewSubmission } from './tronClassSubmissionProtocol';
import { mapTronClassSubmissionConfirmation } from './tronClassSubmissionConfirmation';
import type {
  TronClassSubmissionBindings,
  TronClassSubmissionFirestore,
} from './tronClassSubmission';
import type { TronClassSubmissionBinding } from './tronClassSubmissionSource';

const TOKEN = /^[A-Za-z0-9_-]{16,80}$/;
const REVISION = /^[a-f0-9]{32}$/;
const HASH = /^[a-f0-9]{64}$/;
const OWNER = /^(?:platform:pa_[A-Za-z0-9_-]+|firebase:[^\s/\x00-\x1f\x7f]{1,128})$/;
const PLAN_TTL_MS = 5 * 60_000;
const PURPOSE = 'nuni-tronclass-controlled-first-text-plan-v1';
const hash = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');
const id = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const only = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).length === keys.length &&
  keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
function fail(status: number, code: string): never {
  throw new NuniError(status, code);
}
function invalid(): never {
  return fail(400, 'TRONCLASS_ACCEPTANCE_INVALID_INPUT');
}
function conflict(): never {
  return fail(409, 'TRONCLASS_OPERATION_CONFLICT');
}
function instant(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

type Identity = {
  ownerKey: string;
  studentId: number;
  courseId: number;
  homeworkId: number;
  revision: string;
  operationId: string;
};
export type TronClassAcceptanceInput = Identity & { version: 1; schoolId: 'pu'; content: string };
type PlanBody = Identity & {
  version: 1;
  kind: 'controlled-first-text';
  schoolId: 'pu';
  contractVerified: false;
  contentSha256: string;
  commentSha256: string;
  contentBytes: number;
  title: string;
  issuedAt: string;
  expiresAt: string;
};
export type TronClassAcceptancePlan = PlanBody & { signature: string };
export type TronClassAcceptanceConfirmation = {
  operationId: string;
  contentSha256: string;
  confirmed: true;
};
export type TronClassAcceptanceResult =
  | TronClassAcknowledgedReadbackResult
  | { status: 'unknown'; operationId: string; receipt: null };
type Dependencies = {
  db: TronClassSubmissionFirestore;
  bindings: TronClassSubmissionBindings;
  authorize: TronClassControlledSubmissionDependencies['authorize'];
  readHistory: (
    ownerKey: string,
    binding: TronClassSubmissionBinding,
    scope: { courseId: number; homeworkId: number },
    signal: AbortSignal,
  ) => Promise<unknown>;
  /** Existing server binding secret, never an HTTP/CLI operation parameter. */
  planSecret: string;
  /** CLI-only atomic private-file marker; never a substitute for the durable school claim. */
  reserveDispatch?: (plan: Readonly<TronClassAcceptancePlan>) => Promise<boolean>;
  fetchSchool?: TronClassControlledSubmissionDependencies['fetchSchool'];
  now?: () => number;
};
const INPUT_KEYS = [
  'version',
  'schoolId',
  'ownerKey',
  'studentId',
  'courseId',
  'homeworkId',
  'revision',
  'operationId',
  'content',
];
const PLAN_KEYS = [
  'version',
  'kind',
  'schoolId',
  'contractVerified',
  'ownerKey',
  'studentId',
  'courseId',
  'homeworkId',
  'revision',
  'operationId',
  'contentSha256',
  'commentSha256',
  'contentBytes',
  'title',
  'issuedAt',
  'expiresAt',
  'signature',
];
const SAFE_ERRORS = new Set([
  'TRONCLASS_ACCEPTANCE_INVALID_INPUT',
  'TRONCLASS_ACCEPTANCE_PLAN_CHANGED',
  'TRONCLASS_ACCEPTANCE_PLAN_EXPIRED',
  'TRONCLASS_ACCEPTANCE_CONFIRMATION_REQUIRED',
  'TRONCLASS_ACCEPTANCE_INPUT_CHANGED',
  'TRONCLASS_ACCEPTANCE_RECONCILE_ONLY',
  'TRONCLASS_ACCEPTANCE_UNAVAILABLE',
  'TRONCLASS_CONFIGURATION_REQUIRED',
  'TRONCLASS_OPERATION_CONFLICT',
  'TRONCLASS_RECONNECT_REQUIRED',
  'TRONCLASS_BINDING_CHANGED',
  'TRONCLASS_SUBMISSION_BLOCKED',
  'TRONCLASS_CANDIDATE_CSRF_UNVERIFIED',
  'TRONCLASS_PROTOCOL_INVALID_INPUT',
  'TRONCLASS_SUBMISSION_UNAVAILABLE',
  'TRONCLASS_COURSE_ACCESS_DENIED',
  'TRONCLASS_HOMEWORK_NOT_FOUND',
  'TRONCLASS_READ_TIMEOUT',
  'TRONCLASS_JOURNAL_UNAVAILABLE',
  'TRONCLASS_HISTORY_UNAVAILABLE',
]);
async function safe<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof NuniError && SAFE_ERRORS.has(error.code))
      throw new NuniError(error.status, error.code);
    return fail(503, 'TRONCLASS_ACCEPTANCE_UNAVAILABLE');
  }
}

function identity(value: Record<string, unknown>): Identity {
  if (
    typeof value.ownerKey !== 'string' ||
    value.ownerKey.length > 200 ||
    !OWNER.test(value.ownerKey) ||
    !id(value.studentId) ||
    !id(value.courseId) ||
    !id(value.homeworkId) ||
    typeof value.revision !== 'string' ||
    !REVISION.test(value.revision) ||
    typeof value.operationId !== 'string' ||
    !TOKEN.test(value.operationId)
  )
    return invalid();
  return {
    ownerKey: value.ownerKey,
    studentId: value.studentId,
    courseId: value.courseId,
    homeworkId: value.homeworkId,
    revision: value.revision,
    operationId: value.operationId,
  };
}
export function parseTronClassAcceptanceInput(value: unknown): TronClassAcceptanceInput {
  if (
    !object(value) ||
    !only(value, INPUT_KEYS) ||
    value.version !== 1 ||
    value.schoolId !== 'pu' ||
    typeof value.content !== 'string'
  )
    return invalid();
  const scope = identity(value);
  // The existing builder rejects empty, oversized, malformed Unicode and control
  // text. No uploads, rich-text resources, draft update or resubmission inputs.
  buildTronClassNewSubmission({
    activityId: scope.homeworkId,
    content: value.content,
    uploadIds: [],
  });
  return { version: 1, schoolId: 'pu', ...scope, content: value.content };
}

/** A local operator tool; never imported by an HTTP route or production factory. */
export function createTronClassAcceptanceService(dependencies: Dependencies) {
  const { db, bindings, authorize, readHistory, now = Date.now } = dependencies;
  if (typeof dependencies.planSecret !== 'string' || dependencies.planSecret.trim().length < 32) {
    fail(503, 'TRONCLASS_CONFIGURATION_REQUIRED');
  }
  const key = createHash('sha256')
    .update(`${PURPOSE}\0${dependencies.planSecret}`, 'utf8')
    .digest();
  const journal = createTronClassControlledJournal({ db, bindings, now });
  const dispatchedPlans = new Set<string>();
  const at = () => {
    const value = now();
    if (!Number.isSafeInteger(value) || value < 0 || !Number.isFinite(new Date(value).getTime())) {
      fail(503, 'TRONCLASS_ACCEPTANCE_UNAVAILABLE');
    }
    return value;
  };
  const sign = (body: PlanBody) =>
    createHmac('sha256', key).update(JSON.stringify(body), 'utf8').digest('hex');
  const unknown = (operationId: string): TronClassAcceptanceResult => ({
    status: 'unknown',
    operationId,
    receipt: null,
  });
  const checkSignal = (signal?: AbortSignal) => {
    if (signal?.aborted) fail(504, 'TRONCLASS_READ_TIMEOUT');
  };
  const checkedPlan = (value: unknown, expiredAllowed = false): TronClassAcceptancePlan => {
    if (
      !object(value) ||
      !only(value, PLAN_KEYS) ||
      value.version !== 1 ||
      value.kind !== 'controlled-first-text' ||
      value.schoolId !== 'pu' ||
      value.contractVerified !== false ||
      typeof value.signature !== 'string' ||
      !HASH.test(value.signature) ||
      typeof value.contentSha256 !== 'string' ||
      !HASH.test(value.contentSha256) ||
      typeof value.commentSha256 !== 'string' ||
      !HASH.test(value.commentSha256) ||
      !id(value.contentBytes) ||
      value.contentBytes > 80_000 ||
      typeof value.title !== 'string' ||
      !value.title.trim() ||
      value.title.length > 300 ||
      /[\x00-\x1f\x7f]/.test(value.title) ||
      !instant(value.issuedAt) ||
      !instant(value.expiresAt)
    )
      return invalid();
    const body: PlanBody = {
      version: 1,
      kind: 'controlled-first-text',
      schoolId: 'pu',
      contractVerified: false,
      ...identity(value),
      contentSha256: value.contentSha256,
      commentSha256: value.commentSha256,
      contentBytes: value.contentBytes,
      title: value.title,
      issuedAt: value.issuedAt,
      expiresAt: value.expiresAt,
    };
    if (!timingSafeEqual(Buffer.from(sign(body), 'hex'), Buffer.from(value.signature, 'hex'))) {
      fail(409, 'TRONCLASS_ACCEPTANCE_PLAN_CHANGED');
    }
    const issued = Date.parse(body.issuedAt),
      expires = Date.parse(body.expiresAt),
      current = at();
    if (issued > current || expires <= issued || expires - issued > PLAN_TTL_MS) return invalid();
    if (!expiredAllowed && expires <= current) fail(409, 'TRONCLASS_ACCEPTANCE_PLAN_EXPIRED');
    return { ...body, signature: value.signature };
  };
  const current = async (scope: Identity, allowReconnect = false, signal?: AbortSignal, snapshot?: TronClassSubmissionBinding) => {
    checkSignal(signal);
    const binding = snapshot ?? await bindings.requireBinding(scope.ownerKey, allowReconnect ? undefined : scope.revision);
    checkSignal(signal);
    if (
      !binding ||
      binding.schoolId !== 'pu' ||
      binding.userId !== scope.studentId ||
      !instant(binding.expiresAt) ||
      Date.parse(binding.expiresAt) <= at()
    )
      fail(401, 'TRONCLASS_RECONNECT_REQUIRED');
    if (
      typeof binding.revision !== 'string' ||
      !REVISION.test(binding.revision) ||
      (!allowReconnect && binding.revision !== scope.revision)
    )
      fail(409, 'TRONCLASS_BINDING_CHANGED');
    await bindings.assertCurrent(scope.ownerKey, binding.revision);
    checkSignal(signal);
    return binding;
  };
  const authorizeText = async (scope: Identity, signal: AbortSignal | undefined, binding: TronClassSubmissionBinding) => {
    await current(scope, false, signal, binding);
    const granted = structuredClone(
      await authorize(
        scope.ownerKey,
        Object.freeze({ courseId: scope.courseId, homeworkId: scope.homeworkId }),
        signal,
        binding,
      ),
    );
    checkSignal(signal);
    assertTronClassCandidateAuthorization(granted, scope, at(), true);
    if (granted.binding.userId !== scope.studentId || granted.binding.revision !== scope.revision)
      conflict();
    const assignment = granted.assignment;
    if (
      assignment.allowLate !== false ||
      assignment.allowsAttachments !== false ||
      assignment.maxFiles !== 0 ||
      assignment.maxFileBytes !== 0 ||
      assignment.maxTotalBytes !== 0 ||
      !Array.isArray(assignment.allowedContentTypes) ||
      assignment.allowedContentTypes.length !== 0 ||
      !instant(assignment.deadline) ||
      Date.parse(assignment.deadline) <= at() ||
      typeof assignment.title !== 'string' ||
      !assignment.title.trim() ||
      assignment.title.length > 300 ||
      /[\x00-\x1f\x7f]/.test(assignment.title)
    )
      fail(409, 'TRONCLASS_SUBMISSION_BLOCKED');
    tronClassCandidateHeaders(granted.binding);
    await current(scope, false, signal, binding);
    return granted;
  };
  const scopeMatchesAttempt = (
    plan: TronClassAcceptancePlan,
    attempt: TronClassFinalCandidateAttempt,
  ) => {
    if (
      attempt.ownerKey !== plan.ownerKey ||
      attempt.studentId !== plan.studentId ||
      attempt.courseId !== plan.courseId ||
      attempt.homeworkId !== plan.homeworkId ||
      attempt.revision !== plan.revision ||
      attempt.operationId !== plan.operationId ||
      attempt.uploads.length !== 0 ||
      hash(attempt.comment) !== plan.commentSha256 ||
      attempt.payloadDigest !== tronClassFinalCandidateDigest(attempt)
    )
      conflict();
  };
  const controlled = (scope: Identity, enabled: () => boolean, binding: TronClassSubmissionBinding) =>
    createTronClassControlledSubmission({
      db,
      bindings,
      now,
      enabled,
      fetchSchool: dependencies.fetchSchool,
      authorize: (ownerKey, target, signal) => {
        if (
          ownerKey !== scope.ownerKey ||
          target.courseId !== scope.courseId ||
          target.homeworkId !== scope.homeworkId
        )
          conflict();
        return authorizeText(scope, signal, binding);
      },
      readHistory: (binding, target, signal) =>
        readHistory(scope.ownerKey, binding, target, signal),
      // No storage policy: this tool cannot create metadata or transmit attachments.
    });
  const runReconcile = async (
    plan: TronClassAcceptancePlan,
    signal?: AbortSignal,
  ): Promise<TronClassAcceptanceResult> => {
    const binding = await current(plan, true, signal);
    const attempt = await journal.readAttempt(plan.ownerKey, plan.operationId);
    checkSignal(signal);
    if (!attempt) return unknown(plan.operationId);
    scopeMatchesAttempt(plan, attempt);
    try {
      const result = await controlled(plan, () => false, binding).reconcile(
        plan.ownerKey,
        plan.operationId,
        signal,
        binding,
      );
      await current(plan, true, signal, binding);
      if (result.state !== 'verified-new-version') return unknown(plan.operationId);
      const latest = await journal.readAttempt(plan.ownerKey, plan.operationId);
      if (!latest) return unknown(plan.operationId);
      scopeMatchesAttempt(plan, latest);
      await current(plan, true, signal, binding);
      return mapTronClassSubmissionConfirmation(plan.ownerKey, latest, result);
    } catch (error) {
      // The original operation/lock remain authoritative. Neither failure nor a
      // missing ack grants a fresh dispatch, and reconcile never calls authorize.
      await current(plan, true, signal, binding);
      if (
        error instanceof NuniError &&
        [
          'TRONCLASS_OPERATION_CONFLICT',
          'TRONCLASS_BINDING_CHANGED',
          'TRONCLASS_RECONNECT_REQUIRED',
        ].includes(error.code)
      )
        throw error;
      return unknown(plan.operationId);
    }
  };

  return Object.freeze({
    contractVerified: false as const,
    async preflight(value: unknown, signal?: AbortSignal): Promise<TronClassAcceptancePlan> {
      return safe(async () => {
        const input = parseTronClassAcceptanceInput(value);
        const binding = await current(input, false, signal);
        // Existence is only a conservative refusal. Absence is NOT a reservation;
        // concurrent processes still compete for the core's durable final claim.
        const operation = await db
          .doc(
            `_tronClassSubmissionOperations/${hash(JSON.stringify([input.ownerKey, input.operationId]))}`,
          )
          .get();
        checkSignal(signal);
        const lock = await db
          .doc(
            `_tronClassSubmissionLocks/${hash(JSON.stringify(['pu', input.studentId, input.courseId, input.homeworkId]))}`,
          )
          .get();
        checkSignal(signal);
        if (operation.exists || lock.exists) fail(409, 'TRONCLASS_ACCEPTANCE_RECONCILE_ONLY');
        const granted = await authorizeText(input, signal, binding);
        const issued = at();
        const expires = Math.min(
          issued + PLAN_TTL_MS,
          Date.parse(granted.binding.expiresAt),
          Date.parse(granted.assignment.deadline!),
        );
        if (expires <= issued) fail(409, 'TRONCLASS_ACCEPTANCE_PLAN_EXPIRED');
        const body: PlanBody = {
          version: 1,
          kind: 'controlled-first-text',
          schoolId: 'pu',
          contractVerified: false,
          ...identity(input),
          contentSha256: hash(input.content),
          commentSha256: hash(
            String(
              buildTronClassNewSubmission({
                activityId: input.homeworkId,
                content: input.content,
                uploadIds: [],
              }).body.comment,
            ),
          ),
          contentBytes: Buffer.byteLength(input.content, 'utf8'),
          title: granted.assignment.title,
          issuedAt: new Date(issued).toISOString(),
          expiresAt: new Date(expires).toISOString(),
        };
        return { ...body, signature: sign(body) };
      });
    },
    async dispatch(
      value: unknown,
      rawPlan: unknown,
      confirmation: unknown,
      signal?: AbortSignal,
    ): Promise<TronClassAcceptanceResult> {
      return safe(async () => {
        const input = parseTronClassAcceptanceInput(value);
        const plan = checkedPlan(rawPlan);
        if (
          !object(confirmation) ||
          !only(confirmation, ['operationId', 'contentSha256', 'confirmed']) ||
          confirmation.confirmed !== true ||
          confirmation.operationId !== plan.operationId ||
          confirmation.contentSha256 !== plan.contentSha256
        ) {
          fail(400, 'TRONCLASS_ACCEPTANCE_CONFIRMATION_REQUIRED');
        }
        if (
          Object.entries(identity(input)).some(
            ([field, expected]) => plan[field as keyof Identity] !== expected,
          ) ||
          hash(input.content) !== plan.contentSha256 ||
          Buffer.byteLength(input.content, 'utf8') !== plan.contentBytes ||
          hash(
            String(
              buildTronClassNewSubmission({
                activityId: input.homeworkId,
                content: input.content,
                uploadIds: [],
              }).body.comment,
            ),
          ) !== plan.commentSha256
        ) {
          fail(409, 'TRONCLASS_ACCEPTANCE_INPUT_CHANGED');
        }
        const binding = await current(plan, false, signal);
        const existing = await journal.readAttempt(plan.ownerKey, plan.operationId);
        checkSignal(signal);
        if (existing) {
          scopeMatchesAttempt(plan, existing);
          return unknown(plan.operationId); // The only follow-up is explicit reconcile.
        }
        if (dispatchedPlans.has(plan.signature)) return unknown(plan.operationId);
        dispatchedPlans.add(plan.signature);
        if (
          dependencies.reserveDispatch &&
          !(await dependencies.reserveDispatch(Object.freeze({ ...plan })))
        ) {
          return unknown(plan.operationId);
        }
        try {
          const result = await controlled(plan, () => at() < Date.parse(plan.expiresAt), binding).dispatch(
            plan.ownerKey,
            {
              courseId: plan.courseId,
              homeworkId: plan.homeworkId,
              revision: plan.revision,
              operationId: plan.operationId,
              content: input.content,
              fileIds: [],
            },
            signal,
          );
          await current(plan, false, signal, binding);
          if (result.state !== 'verified-new-version') return unknown(plan.operationId);
          const attempt = await journal.readAttempt(plan.ownerKey, plan.operationId);
          if (!attempt) return unknown(plan.operationId);
          scopeMatchesAttempt(plan, attempt);
          await current(plan, false, signal, binding);
          return mapTronClassSubmissionConfirmation(plan.ownerKey, attempt, result);
        } catch {
          // Once the candidate has started, a thrown/late response or unavailable
          // journal cannot prove that the durable claim/POST did not happen. Never
          // generate another operation ID, release a lock, or retry this dispatch.
          // Another process may have won this same operation with a separately
          // reviewed body. Preserve that conflict instead of attributing its
          // unknown result to the losing plan. A journal failure is not a match.
          const attempt = await journal.readAttempt(plan.ownerKey, plan.operationId);
          if (attempt) scopeMatchesAttempt(plan, attempt);
          return unknown(plan.operationId);
        }
      });
    },
    async reconcile(rawPlan: unknown, signal?: AbortSignal): Promise<TronClassAcceptanceResult> {
      return safe(() => runReconcile(checkedPlan(rawPlan, true), signal));
    },
  });
}

/** Uses the existing server credentials and binding; it does not perform login. */
export async function createDefaultTronClassAcceptanceService(
  options: Pick<Dependencies, 'reserveDispatch'> = {},
) {
  const [
    { getFirebaseAdmin },
    { createTronClassBindingService },
    { createTronClassPuAuthorizationReader },
    { createTronClassRawSubmissionHistoryReader },
  ] = await Promise.all([
    import('./firebaseAdmin'),
    import('./tronClassBinding'),
    import('./tronClassPuAuthorization'),
    import('./tronClassRawSubmissionHistory'),
  ]);
  const planSecret = process.env.TRONCLASS_SESSION_SECRET ?? process.env.BFF_SESSION_SECRET;
  if (!planSecret || planSecret.trim().length < 32) fail(503, 'TRONCLASS_CONFIGURATION_REQUIRED');
  const admin = await getFirebaseAdmin();
  if (!admin?.db) fail(503, 'TRONCLASS_ACCEPTANCE_UNAVAILABLE');
  const bindings = createTronClassBindingService();
  const service = createTronClassAcceptanceService({
    db: admin.db as unknown as TronClassSubmissionFirestore,
    bindings,
    planSecret,
    reserveDispatch: options.reserveDispatch,
    authorize: createTronClassPuAuthorizationReader({ bindings }),
    readHistory: createTronClassRawSubmissionHistoryReader({ bindings }),
  });
  // This factory belongs to the single-command local process, not a shared Web
  // runtime. Finish its Admin Firestore channels before the CLI exits.
  return Object.freeze({ ...service, dispose: () => admin.db.terminate() });
}

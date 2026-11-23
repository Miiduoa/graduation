import { createHmac, timingSafeEqual } from 'node:crypto';
import { parseAssistantTaskPlan, type AssistantTaskPlan } from '@campus/shared/src/assistantTaskPlan';
import { parseAssistantTaskRetry, type AssistantTaskRetry } from '@campus/shared/src/assistantTaskRetry';
import { ASSISTANT_ROLE_PROFILES, assistantRoleToolAllowed, getAssistantRoleProfile, type AssistantRoleProfileId } from '@campus/shared/src/assistantRoleProfiles';
import { canonical, hash, V2Error, type Adapter, type Binding, type Obj } from './contracts';
import { crossServiceRequest, type CrossServiceOperation, type CrossServiceRequest } from './crossServiceRequest';
import { runCrossService, type EventMapSelections, type MerchantSelections } from './crossService';
import { createTools } from './tools';
import { parsePublicEventTarget, type PublicEventTarget } from './publicEvent';
import { parseMerchantArguments, type MerchantTarget } from './merchantWorkspace';

const RETRY_TTL_MS = 15 * 60 * 1000;
const READ_TOOLS = new Set([
  'get_schedule', 'get_calendar', 'get_due_work', 'get_imported_academics', 'get_dining',
  'list_food_orders', 'get_campus_announcements', 'get_campus_events', 'get_lost_found', 'get_campus_map',
  'get_public_social', 'get_school_info', 'get_teaching_overview', 'get_merchant_overview',
]);
const READ_KINDS = new Set(['free-time', 'materials', 'clubs', 'transit', 'public-course', 'map-location']);
const invalid = (): never => { throw new V2Error(409, 'TASK_RETRY_INVALID'); };

function isRead(operation: CrossServiceOperation): boolean {
  return operation.kind === 'read' ? READ_TOOLS.has(operation.tool || '')
    : READ_KINDS.has(operation.kind) &&
      (operation.kind !== 'public-course' || operation.publicCourseIntent?.kind === 'search');
}

/** A retry keeps the original task context as well as the API's authorization.
 * It cannot repair a context mismatch by falling back to the student tool set. */
function contextAllowsRead(operation: CrossServiceOperation, taskProfile: AssistantRoleProfileId): boolean {
  if (operation.workSession && taskProfile !== 'student' && operation.workSession.profileId !== taskProfile) return false;
  const names = operation.kind === 'read' ? [operation.tool || '']
    : operation.kind === 'free-time' ? ['find_free_time']
      : operation.kind === 'materials' ? ['get_materials', 'list_courses']
        : operation.kind === 'clubs' ? ['list_clubs', ...(operation.args.feed ? ['get_club_feed'] : [])]
          : operation.kind === 'transit' ? ['get_transit']
            : operation.kind === 'public-course' ? ['get_public_courses']
              : operation.kind === 'map-location' ? ['get_campus_map'] : [];
  return names.length > 0 && names.every(name => assistantRoleToolAllowed(taskProfile, name));
}

/** Include only the selected reads and their exact, read-only source dependencies. */
function readClosure(request: CrossServiceRequest, stepIds: string[], eventMapSelections: EventMapSelections = {},
  merchantSelections: MerchantSelections = {}, taskProfile: AssistantRoleProfileId = 'student'): CrossServiceRequest | null {
  const byId = new Map(request.operations.map(operation => [operation.id, operation]));
  const selected = new Set<string>(), visiting = new Set<string>();
  const visit = (id: string): boolean => {
    if (selected.has(id)) return true;
    const operation = byId.get(id);
    if (!operation || !isRead(operation) || !contextAllowsRead(operation, taskProfile) || visiting.has(id)) return false;
    // Replaying an ordinal against a fresh event list can silently select a
    // different event. An event-map continuation always needs its original ID.
    if (operation.kind === 'map-location' && operation.mapSource?.kind === 'event' &&
        !Object.hasOwn(eventMapSelections, id)) return false;
    // A former sole store may no longer be the sole/current store. Retry only
    // when the original verified selection can be carried into a fresh auth check.
    if (operation.tool === 'get_merchant_overview' && !Object.hasOwn(merchantSelections, id)) return false;
    visiting.add(id);
    if (!operation.dependsOn.every(visit)) return false;
    visiting.delete(id);
    selected.add(id);
    return true;
  };
  if (!stepIds.length || !stepIds.every(visit)) return null;
  return { operations: request.operations.filter(operation => selected.has(operation.id)) };
}

function verifiedEventMapSelections(raw: unknown, request: CrossServiceRequest, schoolId: string): Record<string, PublicEventTarget> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(raw))) return invalid();
  const entries = Object.getOwnPropertyDescriptors(raw);
  if (Reflect.ownKeys(entries).length > 16) return invalid();
  const selections: Record<string, PublicEventTarget> = {};
  for (const stepId of Reflect.ownKeys(entries)) {
    if (typeof stepId !== 'string') return invalid();
    const operation = request.operations.find(item => item.id === stepId);
    const descriptor = entries[stepId];
    if (operation?.kind !== 'map-location' || operation.mapSource?.kind !== 'event' ||
        !descriptor.enumerable || !('value' in descriptor)) return invalid();
    let target: PublicEventTarget;
    try { target = parsePublicEventTarget(descriptor.value); } catch { return invalid(); }
    if (target.schoolId !== schoolId) return invalid();
    selections[stepId] = target;
  }
  return selections;
}

function verifiedMerchantSelections(raw: unknown, request: CrossServiceRequest): Record<string, MerchantTarget> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(raw))) return invalid();
  const entries = Object.getOwnPropertyDescriptors(raw);
  if (Reflect.ownKeys(entries).length > 16) return invalid();
  const selections: Record<string, MerchantTarget> = {};
  for (const stepId of Reflect.ownKeys(entries)) {
    if (typeof stepId !== 'string') return invalid();
    const operation = request.operations.find(item => item.id === stepId);
    const descriptor = entries[stepId];
    if (operation?.kind !== 'read' || operation.tool !== 'get_merchant_overview' ||
        !descriptor.enumerable || !('value' in descriptor)) return invalid();
    try {
      const target = parseMerchantArguments(descriptor.value);
      if (!target.tenantId || !target.locationId) return invalid();
      selections[stepId] = { tenantId: target.tenantId, locationId: target.locationId };
    } catch { return invalid(); }
  }
  // The current bounded grammar has one default merchant scope per question.
  if (new Set(Object.values(selections).map(canonical)).size > 1) return invalid();
  return selections;
}

function mac(body: string, secret: string): string {
  if (secret.length < 32) throw new V2Error(503, 'CONFIGURATION_REQUIRED');
  return createHmac('sha256', secret).update('nuni-assistant-task-read-retry\0' + body).digest('base64url');
}

export function issueTaskRetry(input: {
  question: string;
  request: CrossServiceRequest;
  plan: AssistantTaskPlan;
  binding: Binding;
  secret: string;
  now: number;
  parsedAt?: number;
  /** Fixed task vocabulary, signed with the retry; never an account-role grant. */
  taskProfile?: AssistantRoleProfileId;
  /** Produced by the server's verified event selection, never a client hint. */
  eventMapSelections?: EventMapSelections;
  merchantSelections?: MerchantSelections;
}): AssistantTaskRetry | undefined {
  const plan = parseAssistantTaskPlan(input.plan);
  if (!plan) return undefined;
  const profile = getAssistantRoleProfile(input.taskProfile ?? 'student');
  if (!profile) return undefined;
  let eventMapSelections: Record<string, PublicEventTarget>;
  let merchantSelections: Record<string, MerchantTarget>;
  try { eventMapSelections = verifiedEventMapSelections(input.eventMapSelections ?? {}, input.request, input.binding.schoolId); }
  catch { return undefined; }
  try { merchantSelections = verifiedMerchantSelections(input.merchantSelections ?? {}, input.request); }
  catch { return undefined; }
  const stepIds = plan.steps.filter(step => ['blocked', 'partial'].includes(step.status) && !step.cardIds?.length &&
    readClosure(input.request, [step.id], eventMapSelections, merchantSelections, profile.id)).map(step => step.id);
  if (!stepIds.length) return undefined;
  const closure = readClosure(input.request, stepIds, eventMapSelections, merchantSelections, profile.id)!;
  const selectedEvents = Object.fromEntries(closure.operations.flatMap(operation =>
    Object.hasOwn(eventMapSelections, operation.id) ? [[operation.id, eventMapSelections[operation.id]]] : []));
  const selectedMerchants = Object.fromEntries(closure.operations.flatMap(operation =>
    Object.hasOwn(merchantSelections, operation.id) ? [[operation.id, merchantSelections[operation.id]]] : []));
  const parsedAt = input.parsedAt ?? input.now;
  const expiresAt = parsedAt + RETRY_TTL_MS;
  if (!Number.isSafeInteger(parsedAt) || !Number.isSafeInteger(expiresAt) || input.now < parsedAt || input.now >= expiresAt)
    return undefined;
  const payload = { version: 4, binding: hash(input.binding), question: input.question, taskProfile: profile.id,
    parsedAt, expiresAt, requestHash: hash(input.request), stepIds,
    eventMapSelections: selectedEvents, merchantSelections: selectedMerchants };
  const body = Buffer.from(canonical(payload)).toString('base64url');
  return parseAssistantTaskRetry({ version: 1, token: body + '.' + mac(body, input.secret), stepIds, expiresAt }, plan) ?? undefined;
}

function retryProof(input: { token: unknown; stepIds: unknown; binding: Binding; secret: string; now: number }) {
  if (typeof input.token !== 'string' || input.token.length > 8192 ||
      !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(input.token)) return invalid();
  const [body, signature] = input.token.split('.');
  const expected = mac(body, input.secret);
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return invalid();
  let proof: Obj;
  try {
    proof = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Obj;
    if (!proof || Array.isArray(proof) || typeof proof !== 'object' ||
        Buffer.from(canonical(proof)).toString('base64url') !== body) return invalid();
  } catch { return invalid(); }
  const keys = Object.keys(proof).sort().join(',');
  const versioned = proof.version === 1 ? keys === 'binding,expiresAt,parsedAt,question,requestHash,stepIds,version'
    : proof.version === 2 ? keys === 'binding,eventMapSelections,expiresAt,parsedAt,question,requestHash,stepIds,version'
      : proof.version === 3 ? keys === 'binding,eventMapSelections,expiresAt,merchantSelections,parsedAt,question,requestHash,stepIds,version'
        : proof.version === 4 && keys === 'binding,eventMapSelections,expiresAt,merchantSelections,parsedAt,question,requestHash,stepIds,taskProfile,version';
  if (!versioned || proof.binding !== hash(input.binding) ||
      typeof proof.question !== 'string' || proof.question.length > 1000 ||
      !Number.isSafeInteger(proof.parsedAt) || !Number.isSafeInteger(proof.expiresAt) ||
      (proof.expiresAt as number) - (proof.parsedAt as number) !== RETRY_TTL_MS ||
      !Number.isSafeInteger(input.now) || input.now < (proof.parsedAt as number)) return invalid();
  if (input.now >= (proof.expiresAt as number)) throw new V2Error(409, 'TASK_RETRY_EXPIRED');
  // Older proofs did not bind a context, even when issued in a professional
  // profile. Their closure is restricted below to reads shared by all profiles.
  const profile = getAssistantRoleProfile(proof.version === 4 ? proof.taskProfile : 'student');
  if (!profile) return invalid();
  const issued = parseAssistantTaskRetry({ version: 1, token: input.token, stepIds: proof.stepIds, expiresAt: proof.expiresAt });
  const selected = parseAssistantTaskRetry({ version: 1, token: input.token, stepIds: input.stepIds, expiresAt: proof.expiresAt });
  if (!issued || !selected || selected.stepIds.some(id => !issued.stepIds.includes(id))) return invalid();
  // Reparse with the original clock: "today" must not silently become tomorrow.
  // The graph fingerprint also rejects a changed grammar after a deployment.
  const request = crossServiceRequest(proof.question, proof.parsedAt as number, input.binding.schoolId);
  if (!request || hash(request) !== proof.requestHash) return invalid();
  const eventMapSelections = verifiedEventMapSelections(proof.version !== 1 ? proof.eventMapSelections : {}, request, input.binding.schoolId);
  const merchantSelections = verifiedMerchantSelections(proof.version === 3 || proof.version === 4 ? proof.merchantSelections : {}, request);
  if (proof.version === 2 && !Object.keys(eventMapSelections).length) return invalid();
  if (proof.version === 3 && !Object.keys(merchantSelections).length) return invalid();
  const subset = readClosure(request, selected.stepIds, eventMapSelections, merchantSelections, profile.id);
  if (!subset) return invalid();
  if (proof.version !== 4 && ASSISTANT_ROLE_PROFILES.some(candidate =>
    !readClosure(request, selected.stepIds, eventMapSelections, merchantSelections, candidate.id))) return invalid();
  return { request, subset, question: proof.question, parsedAt: proof.parsedAt as number,
    taskProfile: profile.id, eventMapSelections, merchantSelections };
}

/** No model, proposals, writes, or proposal-generation reset. Replays are fresh reads only. */
export async function retryTaskReads(input: {
  token: unknown;
  stepIds: unknown;
  binding: Binding;
  secret: string;
  now: number;
  adapter: Adapter;
  signal: AbortSignal;
}) {
  const started = Date.now();
  input.signal.throwIfAborted();
  const proof = retryProof(input);
  // Empty question prevents a completed study/reorder clause from influencing
  // any tools used in this read-only continuation.
  const tools = createTools(input.adapter, input.binding, input.secret, input.now, false, false, '', false, proof.question,
    Object.values(proof.merchantSelections)[0], proof.taskProfile);
  const result = await runCrossService({ request: proof.subset, tools, binding: input.binding,
    now: input.now, signal: input.signal, availableAfter: input.now, eventMapSelections: proof.eventMapSelections,
    merchantSelections: proof.merchantSelections });
  input.signal.throwIfAborted();
  if (result.cards.length) throw new V2Error(503, 'TASK_RETRY_UNSAFE');
  const taskRetry = issueTaskRetry({ question: proof.question, request: proof.request, plan: result.taskPlan,
    binding: input.binding, secret: input.secret, now: input.now + Math.max(0, Date.now() - started), parsedAt: proof.parsedAt,
    taskProfile: proof.taskProfile, eventMapSelections: proof.eventMapSelections, merchantSelections: proof.merchantSelections });
  return { version: 2, ...result, ...(taskRetry ? { taskRetry } : {}),
    answer: result.answer.replace('已依這次需求逐項處理：', '已重新核對選取的項目與必要來源；其他結果及待確認內容保留在原處：'),
    modelCalls: 0, usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }, simulation: input.adapter.simulation };
}

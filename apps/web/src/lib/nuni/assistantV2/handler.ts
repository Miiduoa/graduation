import { withOperationSignal } from './operation';
import { randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { parseAssistantFoodPickupIntent } from '@campus/shared/src/assistantFoodPickupIntent';
import { getAssistantRoleProfile } from '@campus/shared/src/assistantRoleProfiles';
import { assistantRoleTaskGuide } from '@campus/shared/src/assistantRoleTasks';
import { createPlanProtection, validatePlanProtection, type PlanProtection } from '@/lib/assistantPlanProtection';
import {
  boundedJson,
  jsonResponse,
  nuniEnabled,
  requireSameOrigin,
  requireSession,
  sessionContext,
} from '../server';
import { beginProposal, cardIssuer, machineId, confirm, reconcile, revoke, issueRoute, routeOwner, routeTarget } from './actions';
import { createAdapter } from './adapter';
import { directReads } from './directRead';
import { directPlanRevision, selectPlanRevision, shiftPlanRevision } from './directPlanRevision';
import { bounded, hash, history, id, object, text, V2Error, type Obj } from './contracts';
import { createProviderModel, fallbackReady, PROVIDER_USER_MESSAGES, providerUserMessage } from './groq';
import { run, safeCode } from './runner';
import { courseworkStudyTarget } from './courseworkStudy';
import { COURSEWORK_STUDY_MESSAGES, prepareCourseworkStudyRequest } from './courseworkStudyRequest';
import { readCourseworkFollowup } from './courseworkFollowup';
import { courseworkRecoveryProof, prepareCourseworkRecoveryRequest } from './courseworkRecovery';
import { retryTaskReads } from './taskRetry';
import { parsePublicEventTarget } from './publicEvent';
import { CAMPUS_EVENT_MESSAGES, prepareCampusEventRequest } from './campusEventRequest';
import { parseCampusEventDiscovery, prepareCampusEventDiscovery } from './campusEventDiscovery';
import { parseCampusMapReadTask, readCampusMapRequest } from './campusMapReadRequest';
import { FOOD_PICKUP_MESSAGES, prepareSelectedFoodPickupRequest, selectedFoodPickupTarget } from './foodPickupRequest';
const ACTIONS = ['capability', 'ask', 'plan', 'pickup-plan', 'event-preview', 'map-read', 'followup', 'retry', 'revise', 'confirm', 'cancel', 'reconcile'];
const active = new Set<string>();
const hits = new Map<string, number[]>();
const followupHits = new Map<string, number[]>();
const planHits = new Map<string, number[]>();
const followupActive = new Map<string, number>();
const retryHits = new Map<string, number[]>();
const retryActive = new Set<string>();
function claimTaskRetry(account: string, now: number) {
  const key = hash(account);
  for (const [owner, times] of retryHits)
    if (!times.some(time => time > now - 3600000)) retryHits.delete(owner);
  const recent = (retryHits.get(key) || []).filter(time => time > now - 3600000);
  if (recent.length >= 10 || recent.filter(time => time > now - 60000).length >= 3)
    throw new V2Error(429, 'TASK_RETRY_LIMIT', 60);
  if (retryActive.has(key)) throw new V2Error(429, 'TASK_RETRY_BUSY', 5);
  retryHits.set(key, [...recent, now]);
  retryActive.add(key);
  return () => { retryActive.delete(key); };
}
/** Read-only followups never consume a chat/model or planning allowance. */
function claimFollowupRead(account: string, now: number) {
  const key = hash(account);
  for (const [owner, times] of followupHits)
    if (!times.some(time => time > now - 3600000)) followupHits.delete(owner);
  const recent = (followupHits.get(key) || []).filter(time => time > now - 3600000);
  if (recent.length >= 600 || recent.filter(time => time > now - 60000).length >= 60)
    throw new V2Error(429, 'FOLLOWUP_READ_LIMIT', 60);
  if ((followupActive.get(key) || 0) >= 3) throw new V2Error(429, 'FOLLOWUP_BUSY', 5);
  followupHits.set(key, [...recent, now]);
  followupActive.set(key, (followupActive.get(key) || 0) + 1);
  return () => {
    const remaining = (followupActive.get(key) || 1) - 1;
    if (remaining) followupActive.set(key, remaining);
    else followupActive.delete(key);
  };
}
let minute = 0,
  requests = 0,
  tokens = 0,
  day = 0,
  dailyRequests = 0,
  dailyTokens = 0;
const provider = createProviderModel();
const PLAN_PROTECTION_MESSAGES: Record<string, string> = {
  INVALID_PLAN_SHIFT: '平移設定無效，請核對分鐘數、所選行程與保留項目後再試。',
  INVALID_PLAN_SELECTION: '保留項目設定無效，請只選擇原提議中的部分行程後再試。',
  INVALID_PLAN_REVISION: '原提議或修改欄位不完整，請重新開啟完整行程提議後再試。',
  PLAN_REVISION_UNCHANGED: '日期與時間沒有變更，這次沒有產生新提議。',
  PLAN_REVISION_UNRESOLVED: '原提議尚未全部核對為未執行並撤銷，不能產生新的行程提議。',
  EVENT_CONFLICT: '修改後的時段與其他行程重疊，請調整日期或時間後再試。',
  SCHEDULE_INCOMPLETE: '目前課表資料不完整，無法可靠核對時段，這次沒有產生新提議。',
  INVALID_PLAN_PROTECTION: '保留項目設定無效，請重新選擇要保留的原提議內容。',
  PLAN_ALREADY_PRESERVED: '已選擇保留全部項目，不需要重新預覽；原提議沒有變更。',
  PLAN_PROTECTION_MISMATCH: '新提議未完整保留指定項目，這次預覽已停止。請調整修改條件後重新預覽。',
  PLAN_REVISION_TIME_CONFLICT: '修改後的時段有重疊，這次沒有提供可確認的安排。請調整修改條件後重新預覽；不會自動移動時間或省略行程。',
  PLAN_REVISION_INCOMPLETE: '有行程無法完成預覽，這次沒有提供可確認的安排。請核對日期、時間與修改條件後重新預覽。',
};
function quota(now: number, amount: number) {
  if (Math.floor(now / 60000) !== minute) {
    minute = Math.floor(now / 60000);
    requests = 0;
    tokens = 0;
  }
  if (Math.floor(now / 86400000) !== day) {
    day = Math.floor(now / 86400000);
    dailyRequests = 0;
    dailyTokens = 0;
  }
  if (
    requests >= 24 ||
    tokens + amount > 7000 ||
    dailyRequests >= 800 ||
    dailyTokens + amount > 160000
  )
    throw new V2Error(429, 'LOCAL_QUOTA_EXCEEDED', 60);
  requests++;
  dailyRequests++;
  tokens += amount;
  dailyTokens += amount;
}
export async function handleV2(request: NextRequest, action: string) {
  const requestId = randomUUID();
  const stage = ACTIONS.includes(action) ? action : 'unknown';
  const started = Date.now();
  let logged = false;
  const log = (r: Obj) => {
    logged = true;
    console.info(JSON.stringify(r));
  };
  try {
    if (
      !nuniEnabled() ||
      process.env.CAMPUS_ASSISTANT_ENABLED !== 'true' ||
      process.env.CAMPUS_ASSISTANT_V2_ENABLED !== 'true'
    )
      throw new V2Error(404, 'NOT_FOUND');
    if (!ACTIONS.includes(action))
      throw new V2Error(404, 'NOT_FOUND');
    if (request.method !== (action === 'capability' ? 'GET' : 'POST'))
      throw new V2Error(405, 'METHOD_NOT_ALLOWED');
    if (request.nextUrl.search) throw new V2Error(400, 'INVALID_INPUT');
    if (request.method !== 'GET') requireSameOrigin(request);
    const session = requireSession(request);
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(55000)]);
    if (action === 'capability') {
      await createAdapter(session, 'pu', signal).principal();
      return jsonResponse({
        enabled: true,
        version: 2,
        ready: Boolean(process.env.GROQ_API_KEY || fallbackReady()),
        planning: true,
        eventPreview: true,
        writesEnabled: process.env.CAMPUS_ASSISTANT_V2_WRITES_ENABLED === 'true',
        fallback: fallbackReady(),
        simulation: false,
      });
    }
    const raw = object(
      await boundedJson(request, 16384),
      action === 'ask'
        ? ['schoolId', 'conversationId', 'question', 'history', 'consent', 'preferredInstance', 'routeToken', 'planProtection', 'studyTarget', 'taskProfile']
        : action === 'plan'
          ? ['schoolId', 'conversationId', 'routeToken', 'task', 'recovery']
          : action === 'event-preview'
            ? ['schoolId', 'conversationId', 'routeToken', 'event', 'discovery']
          : action === 'map-read'
            ? ['schoolId', 'conversationId', 'task']
          : action === 'pickup-plan'
            ? ['schoolId', 'conversationId', 'routeToken', 'target']
          : action === 'followup'
            ? ['schoolId', 'conversationId', 'issuedContext', 'token', 'args']
            : action === 'retry'
              ? ['schoolId', 'conversationId', 'token', 'stepIds']
            : action === 'revise'
              ? ['schoolId', 'conversationId', 'routeToken', 'originalCards', 'change', 'keepMutationIds', 'shift']
              : ['schoolId', 'conversationId', 'token', 'args'],
    );
    const profile = action === 'ask' ? getAssistantRoleProfile(raw.taskProfile ?? 'student') : null;
    if (action === 'ask' && (!profile || (raw.taskProfile !== undefined && raw.taskProfile === null)))
      throw new V2Error(422, 'INVALID_INPUT');
    const direct = action === 'ask' && typeof raw.question === 'string' ? directReads(raw.question, Date.now()) : [];
    const personalTimetable = direct.length === 1 && direct[0].tool === 'get_schedule';
    const roleGuide = !personalTimetable && action === 'ask' && raw.planProtection === undefined && raw.studyTarget === undefined &&
      typeof raw.question === 'string' ? assistantRoleTaskGuide(profile!.id, raw.question) : null;
    const studyTarget = action === 'plan'
      ? courseworkStudyTarget(raw.task)
      : action === 'ask' && raw.studyTarget !== undefined
        ? courseworkStudyTarget(raw.studyTarget) : undefined;
    const recovery = action === 'plan' && raw.recovery !== undefined ? courseworkRecoveryProof(raw.recovery) : undefined;
    const pickupTarget = action === 'pickup-plan' ? selectedFoodPickupTarget(raw.target) : undefined;
    // This whole-question parser also returns bounded, local guidance for an
    // unsupported pickup request. Both paths are intercepted before the model.
    const pickupRequest = action === 'ask' && profile?.id === 'student' && raw.planProtection === undefined &&
      typeof raw.question === 'string' && parseAssistantFoodPickupIntent(raw.question) !== null;
    const schoolId = id(raw.schoolId),
      conversationId = id(raw.conversationId);
    if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(schoolId) || schoolId === 'personal')
      throw new V2Error(422, 'INVALID_INPUT');
    if (action === 'event-preview' && Number(Object.hasOwn(raw, 'event')) + Number(Object.hasOwn(raw, 'discovery')) !== 1)
      throw new V2Error(422, 'INVALID_INPUT');
    const selectedEvent = action === 'event-preview' && Object.hasOwn(raw, 'event') ? parsePublicEventTarget(raw.event) : undefined;
    const eventDiscovery = action === 'event-preview' && Object.hasOwn(raw, 'discovery')
      ? parseCampusEventDiscovery(raw.discovery) : undefined;
    const mapTask = action === 'map-read' ? parseCampusMapReadTask(raw.task) : undefined;
    if (selectedEvent && selectedEvent.schoolId !== schoolId) throw new V2Error(403, 'FORBIDDEN_SCOPE');
    if (action === 'followup' && (typeof raw.issuedContext !== 'string' ||
        !/^[A-Za-z0-9_-]{43}$/.test(raw.issuedContext))) throw new V2Error(422, 'INVALID_INPUT');
    const secret = process.env.BFF_SESSION_SECRET?.trim() || '';
    const preparing = action === 'ask' || action === 'plan' || action === 'event-preview' || action === 'pickup-plan';
    const routePurpose = action === 'event-preview' ? 'event-preview' : 'chat';
    const target = action === 'reconcile' || action === 'followup' || action === 'retry' || action === 'map-read' ? undefined : preparing || action === 'revise'
      ? raw.routeToken === undefined && preparing ? undefined : routeTarget(raw.routeToken, { session: sessionContext(session), conversationId, schoolId }, secret, routePurpose)
      : cardIssuer({ token: raw.token, args: raw.args }, secret);
    if (process.env.FLY_MACHINE_ID && target && target !== process.env.FLY_MACHINE_ID) {
      if (request.headers.has('fly-replay-failed')) throw new V2Error(409, 'CONFIRMATION_REVOKED');
      const response = jsonResponse({ error: 'INSTANCE_REPLAY_REQUIRED' }, 409);
      response.headers.set('fly-replay', `instance=${target}`);
      return response;
    }
    const source = createAdapter(session, schoolId, signal),
      principal = await source.principal();
    const binding = {
      account: principal.platformAccountId,
      session: sessionContext(session),
      conversationId,
      schoolId,
    };
    if (action === 'map-read') {
      const release = claimFollowupRead(principal.platformAccountId, Date.now());
      try {
        return jsonResponse(await readCampusMapRequest({ task: mapTask, binding, secret,
          now: Date.now(), adapter: source.adapter, signal }));
      } catch (error) {
        if (request.signal.aborted) throw new V2Error(499, 'ABORTED');
        if (signal.aborted) throw new V2Error(504, 'DEADLINE_EXCEEDED');
        throw error;
      } finally { release(); }
    }
    if (action === 'followup') {
      const release = claimFollowupRead(principal.platformAccountId, Date.now());
      try {
        return jsonResponse(await bounded(child => withOperationSignal(child, () => readCourseworkFollowup({
          binding: { ...binding, session: raw.issuedContext as string },
          proof: { token: raw.token, args: raw.args }, secret, now: Date.now(), adapter: source.adapter,
        })), signal, 12000));
      } finally { release(); }
    }
    if (action === 'retry') {
      const release = claimTaskRetry(principal.platformAccountId, Date.now());
      try {
        return jsonResponse(await retryTaskReads({ token: raw.token, stepIds: raw.stepIds,
          binding, secret, now: Date.now(), adapter: source.adapter, signal }));
      } catch (error) {
        if (request.signal.aborted) throw new V2Error(499, 'ABORTED');
        if (signal.aborted) throw new V2Error(504, 'DEADLINE_EXCEEDED');
        throw error;
      } finally { release(); }
    }
    if (action === 'revise') routeOwner(raw.routeToken, binding, secret);
    let protection: PlanProtection | undefined;
    if (preparing) {
      if (raw.routeToken !== undefined) routeOwner(raw.routeToken, binding, secret, routePurpose);
      if (raw.planProtection !== undefined) {
        try {
          const input = object(raw.planProtection, ['originalEvents', 'protectedIndices']);
          protection = createPlanProtection(input.originalEvents, input.protectedIndices);
        } catch {
          throw new V2Error(422, 'INVALID_PLAN_PROTECTION');
        }
        if (protection.protectedIndices.length === protection.originalEvents.length)
          throw new V2Error(422, 'PLAN_ALREADY_PRESERVED');
      }
      // Missing credentials can only bootstrap a fresh server-generated binding.
      // They can never issue a replacement for a client-selected old binding.
      if (raw.routeToken === undefined) {
        if (action === 'ask') {
          if (raw.consent !== true && !studyTarget && !pickupRequest && !roleGuide) throw new V2Error(422, 'CONSENT_REQUIRED');
          text(raw.question, 1000);
          history(raw.history);
        }
        const fresh = { ...binding, conversationId: randomUUID() };
        return jsonResponse({ bootstrap: true, conversationId: fresh.conversationId, routeToken: issueRoute(fresh, secret, routePurpose) });
      }
    }
    const writes = process.env.CAMPUS_ASSISTANT_V2_WRITES_ENABLED === 'true';
    if (action === 'cancel')
      return jsonResponse(
        await bounded(
          (child) => withOperationSignal(child, () =>
            revoke(binding, { token: raw.token, args: raw.args }, secret, Date.now(), source.adapter),
          ), signal, 12000,
        ),
      );
    if (action === 'reconcile')
      return jsonResponse(
        await bounded(
          (child) => withOperationSignal(child, () =>
            reconcile(binding, { token: raw.token, args: raw.args }, secret, Date.now(), source.adapter, writes),
          ), signal, 12000,
        ),
      );
    if (action === 'confirm')
      return jsonResponse(
        await bounded(
          (child) =>
            withOperationSignal(child, () =>
              confirm(
                binding,
                { token: raw.token, args: raw.args },
                secret,
                Date.now(),
                source.adapter,
                writes,
              ),
            ),
          signal,
          12000,
        ),
      );
    if (action === 'revise' && !writes) throw new V2Error(403, 'ASSISTANT_WRITE_UNAVAILABLE');
    if (action === 'ask' && raw.consent !== true && !studyTarget && !pickupRequest && !roleGuide) throw new V2Error(422, 'CONSENT_REQUIRED');
    const question = action === 'ask' ? text(raw.question, 1000) : '',
      memory = action === 'ask' ? history(raw.history) : [];
    const key = hash(principal.platformAccountId),
      sessionKey = hash(session.sessionHandle);
    const now = Date.now();
    // Structured previews have their own allowance; chat quota belongs to chat.
    const allowance = action === 'plan' || action === 'event-preview' || action === 'pickup-plan' || pickupRequest ? planHits : hits;
    for (const [k, times] of allowance) {
      if (!times.some((t) => t > now - 3600000)) allowance.delete(k);
    }
    const recent = (allowance.get(key) || []).filter((t) => t > now - 3600000);
    if (active.has(sessionKey)) throw new V2Error(429, 'ASSISTANT_BUSY', 5);
    if (recent.length >= 10 || recent.filter((t) => t > now - 60000).length >= 3)
      throw new V2Error(429, 'LOCAL_ACCOUNT_LIMIT', 60);
    allowance.set(key, [...recent, now]);
    active.add(sessionKey);
    try {
      if (action === 'event-preview' || action === 'pickup-plan') {
        const options = { adapter: source.adapter, binding, secret, writes, now, signal };
        const result = action === 'pickup-plan'
          ? await prepareSelectedFoodPickupRequest({ target: pickupTarget!, adapter: source.adapter, binding, secret, writes, now, signal })
          : eventDiscovery
          ? await prepareCampusEventDiscovery({ ...options, discovery: eventDiscovery })
          : { ...await prepareCampusEventRequest({ ...options, target: selectedEvent! }), campusEventPreview: true };
        signal.throwIfAborted();
        return jsonResponse({
          version: 2, ...result, modelCalls: 0, simulation: source.adapter.simulation,
          ...(result.cards.length ? { expiresAt: now + 300000 } : {}),
          ...(process.env.FLY_MACHINE_ID ? { issuer: machineId(process.env.FLY_MACHINE_ID) } : {}),
        });
      }
      if (action === 'plan') {
        // An in-app task selection is a source hint, never a chat prompt or
        // execution authority. Re-read it through the existing guarded planner.
        const options = { target: studyTarget!, adapter: source.adapter, binding, secret, writes, now, signal };
        const result = recovery
          ? await prepareCourseworkRecoveryRequest({ ...options, recovery })
          : await prepareCourseworkStudyRequest(options);
        signal.throwIfAborted();
        return jsonResponse({
          version: 2, ...result, modelCalls: 0, simulation: source.adapter.simulation,
          ...(result.cards.length ? { expiresAt: now + 300000 } : {}),
          ...(process.env.FLY_MACHINE_ID ? { issuer: machineId(process.env.FLY_MACHINE_ID) } : {}),
        });
      }
      if (action === 'revise') {
        const selecting = Object.hasOwn(raw, 'keepMutationIds'), shifting = Object.hasOwn(raw, 'shift');
        if (['keepMutationIds', 'change', 'shift'].filter(key => Object.hasOwn(raw, key)).length !== 1)
          throw new V2Error(422, shifting ? 'INVALID_PLAN_SHIFT' : 'INVALID_PLAN_SELECTION');
        const result = await bounded(child => withOperationSignal(child, () =>
          shifting
            ? shiftPlanRevision(binding, raw.originalCards, raw.shift, secret, source.adapter)
            : selecting
              ? selectPlanRevision(binding, raw.originalCards, raw.keepMutationIds, secret, source.adapter)
              : directPlanRevision(binding, raw.originalCards, raw.change, secret, source.adapter),
        ), signal, 12000);
        return jsonResponse({
          ...result,
          ...(process.env.FLY_MACHINE_ID ? { issuer: machineId(process.env.FLY_MACHINE_ID) } : {}),
        });
      }
      const result = await run({
        question,
        ...(profile ? { taskProfile: profile.id } : {}),
        ...(studyTarget ? { studyTarget } : {}),
        history: studyTarget || pickupRequest ? [] : memory,
        binding,
        adapter: source.adapter,
        secret,
        writes,
        signal,
        planRevision: protection !== undefined,
        log,
        model: async (input) => {
          // Model-free task exceptions never authorize a later model fallback.
          if (raw.consent !== true) throw new V2Error(422, 'CONSENT_REQUIRED');
          const amount =
            Buffer.byteLength(JSON.stringify({ messages: input.messages, tools: input.tools })) +
            input.max_completion_tokens +
            128;
          quota(Date.now(), amount);
          try {
            const result = await provider(input);
            tokens += result.usage.total_tokens - amount;
            dailyTokens += result.usage.total_tokens - amount;
            return result;
          } catch (error) {
            requests = Math.max(0, requests - 1);
            dailyRequests = Math.max(0, dailyRequests - 1);
            tokens = Math.max(0, tokens - amount);
            dailyTokens = Math.max(0, dailyTokens - amount);
            throw error;
          }
        },
      }).catch(error => {
        // A failed revision may already have issued internal cards.
        if (protection) beginProposal(binding, Date.now());
        throw error;
      });
      // A partial ordinary answer can be useful; a partial replacement would
      // silently drop intent. Reuse the tool's checked failure, never infer
      // conflicts from model prose or recompute a competing schedule policy.
      if (protection && (result.stopReason || result.steps.some(step => step.status === 'error'))) {
        const code = result.steps.some(step => step.status === 'error' && step.summary === 'EVENT_CONFLICT')
          ? 'PLAN_REVISION_TIME_CONFLICT' : 'PLAN_REVISION_INCOMPLETE';
        beginProposal(binding, Date.now());
        log({ event: 'assistant.failed', version: 2, stage, requestId, status: 422,
          errorClass: code, durationMs: Date.now() - started, simulation: false });
        throw new V2Error(422, code);
      }
      if (protection &&
        (!Array.isArray(result.cards) || result.cards.length === 0 || result.cards.some(card => card.tool !== 'propose_personal_event') ||
        !validatePlanProtection(protection, result.cards.map(card => card.args)).ok)) {
        // Retire the entire rejected candidate before returning any response.
        // Its signed arguments are never repaired or released to the caller.
        const code = protection.protectedIndices.length ? 'PLAN_PROTECTION_MISMATCH' : 'PLAN_REVISION_INCOMPLETE';
        beginProposal(binding, Date.now());
        log({ event: 'assistant.failed', version: 2, stage, requestId, status: 422,
          errorClass: code, durationMs: Date.now() - started, simulation: false });
        throw new V2Error(422, code);
      }
      return jsonResponse({
        ...result,
        ...(process.env.FLY_MACHINE_ID ? { issuer: machineId(process.env.FLY_MACHINE_ID) } : {}),
      });
    } finally {
      active.delete(sessionKey);
    }
  } catch (error) {
    const e = error as { status?: number; code?: string; retryAfter?: number };
    const status = e.status || 503,
      code = safeCode(error);
    if (!logged)
      log({
        event: 'assistant.failed',
        version: 2,
        stage,
        requestId,
        status,
        errorClass: code,
        durationMs: Date.now() - started,
        simulation: false,
      });
    const response = jsonResponse(
      {
        error: code,
        ...(PLAN_PROTECTION_MESSAGES[code]
          ? { message: PLAN_PROTECTION_MESSAGES[code] }
          : code === 'TASK_RETRY_EXPIRED' || code === 'TASK_RETRY_INVALID'
          ? { message: '這次重查來源已過期或與目前帳號、校園不符，請重新描述要查詢的項目。原本的行程與待確認內容沒有變更。' }
          : code === 'TASK_RETRY_LIMIT'
          ? { message: '這次重查次數已達上限，請稍後再試；已完成的結果仍保留。' }
          : code === 'TASK_RETRY_BUSY'
          ? { message: '仍有一項資料重查正在進行，請等結果回來後再試。' }
          : code === 'EVENT_START_PASSED'
          ? { message: '這個時段已經開始，請重新安排時間。' }
          : CAMPUS_EVENT_MESSAGES[code] ? { message: CAMPUS_EVENT_MESSAGES[code] }
          : FOOD_PICKUP_MESSAGES[code] ? { message: FOOD_PICKUP_MESSAGES[code] }
          : COURSEWORK_STUDY_MESSAGES[code] ? { message: COURSEWORK_STUDY_MESSAGES[code] }
          : PROVIDER_USER_MESSAGES[code] ? { message: providerUserMessage(code) } : {}),
      },
      status,
    );
    if (e.retryAfter) response.headers.set('Retry-After', String(e.retryAfter));
    return response;
  } finally {
    if (!logged)
      log({
        event: 'assistant.completed',
        version: 2,
        stage,
        requestId,
        status: 200,
        durationMs: Date.now() - started,
        simulation: false,
      });
  }
}

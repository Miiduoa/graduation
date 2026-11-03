import { isDeepStrictEqual } from 'node:util';
import { PlatformPublicAdmission, type PlatformSessionResolver } from './admission';
import {
  DETERMINISTIC_PROVIDER,
  FREE_PROVIDER,
  FREE_MODEL,
  exactRecord,
  parseConfirmedTask,
  parseRecoveryScope,
  parseRecoveryAcknowledgement,
  PublicAgentError,
  type ParsedPublicTask,
  type PlatformTaskActor,
} from './contract';
import { PlatformPublicAgentLedger } from './ledger';
import {
  exactNavigation,
  validatedPlan,
  confirmedRoute,
  navigationReceipt,
  publicSnapshot,
  type PublicCatalogReader,
  type PublicSnapshot,
} from './navigation';

type Options = {
  accounts: PlatformSessionResolver;
  ledger: PlatformPublicAgentLedger;
  readPublicCatalog: PublicCatalogReader;
  timeoutMs?: number;
  clock?: () => number;
  /** Explicitly injected, otherwise Groq stays disabled. */
  groqPlan?: (
    input: { schoolId: string; query: string; fingerprint: string },
    signal: AbortSignal,
    beforeSend: (signal: AbortSignal) => Promise<void>,
  ) => Promise<unknown>;
  /** Controlled injection for tests; no default cloud provider or fallback. */
  execute?: (
    task: ParsedPublicTask,
    snapshot: PublicSnapshot,
    signal: AbortSignal,
  ) => Promise<unknown>;
};
function sameActor(a: PlatformTaskActor, b: PlatformTaskActor) {
  if (
    a.platformAccountId !== b.platformAccountId ||
    a.credentialId !== b.credentialId ||
    a.sessionHash !== b.sessionHash
  )
    throw new PublicAgentError('PUBLIC_AGENT_SESSION_INVALID', 401);
}

/** Unregistered composition candidate. Only deterministic public navigation is enabled. */
export class PlatformPublicTaskService {
  readonly admission: PlatformPublicAdmission;
  private readonly timeoutMs: number;
  private readonly clock: () => number;
  constructor(private readonly options: Options) {
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.clock = options.clock ?? Date.now;
    this.admission = new PlatformPublicAdmission({
      accounts: options.accounts,
      ledger: options.ledger,
      timeoutMs: this.timeoutMs,
      readPublicSourceFingerprint: async (school, _query, signal) =>
        (await this.snapshot(school, signal)).fingerprint,
    });
  }
  private async snapshot(school: string, signal: AbortSignal) {
    try {
      const catalog = await this.options.readPublicCatalog(school, signal);
      if (!catalog) throw new PublicAgentError('PUBLIC_AGENT_SOURCE_UNAVAILABLE', 503);
      return publicSnapshot(catalog, school);
    } catch (error) {
      if (error instanceof PublicAgentError) throw error;
      throw new PublicAgentError('PUBLIC_AGENT_SOURCE_UNAVAILABLE', 503);
    }
  }
  /** Capability is informational; every later operation revalidates source and session. */
  async capability(auth: string | undefined, raw: unknown, signal?: AbortSignal) {
    const input = exactRecord(raw, ['schoolId']);
    if (typeof input.schoolId !== 'string' || !/^[A-Za-z0-9_-]{2,40}$/u.test(input.schoolId))
      throw new PublicAgentError('PUBLIC_AGENT_INVALID_INPUT');
    const schoolId = input.schoolId;
    return this.bounded(signal, async (step, abort) => {
      const actor = await step(() => this.admission.actor(auth));
      let catalog;
      try {
        catalog = await step(() => this.options.readPublicCatalog(schoolId, abort));
      } catch (error) {
        if (error instanceof PublicAgentError) throw error;
        throw new PublicAgentError('PUBLIC_AGENT_SOURCE_UNAVAILABLE', 503);
      }
      const snapshot = catalog === null ? null : publicSnapshot(catalog, schoolId);
      const names = new Map<string, number>();
      for (const place of snapshot?.places ?? [])
        names.set(place.name, (names.get(place.name) ?? 0) + 1);
      const canNavigate = [...names.values()].filter((count) => count === 1).length >= 2;
      sameActor(actor, await step(() => this.admission.actor(auth)));
      return {
        schoolId,
        // A configured planner or static flag alone cannot establish a no-spend guarantee.
        modes: canNavigate ? ['deterministic'] : [],
        source: snapshot ? { date: snapshot.updatedAt, label: snapshot.label } : null,
      };
    });
  }
  private parse(raw: unknown) {
    const task = parseConfirmedTask(raw);
    if (
      task.binding.task !== 'public-campus-navigation' ||
      (task.binding.provider !== DETERMINISTIC_PROVIDER &&
        (task.binding.provider !== FREE_PROVIDER || !this.options.groqPlan))
    )
      throw new PublicAgentError('PUBLIC_AGENT_EXECUTOR_UNAVAILABLE', 503);
    return task;
  }
  private async source(task: ParsedPublicTask, signal: AbortSignal) {
    const snapshot = await this.snapshot(task.binding.schoolId, signal);
    if (snapshot.fingerprint !== (task.data.consent as { fingerprint: string }).fingerprint)
      throw new PublicAgentError('PUBLIC_AGENT_SOURCE_CHANGED', 409);
    if (task.binding.provider === DETERMINISTIC_PROVIDER)
      exactNavigation(task.data.query as string, snapshot);
    return snapshot;
  }
  async preview(auth: string | undefined, raw: unknown, signal?: AbortSignal) {
    const input = exactRecord(raw, ['schoolId', 'query', 'requestId']);
    return this.bounded(signal, async (step, abort) => {
      const actor = await step(() => this.admission.actor(auth));
      if (typeof input.schoolId !== 'string' || !/^[A-Za-z0-9_-]{2,40}$/u.test(input.schoolId))
        throw new PublicAgentError('PUBLIC_AGENT_INVALID_INPUT');
      const snapshot = await step(() => this.snapshot(input.schoolId as string, abort));
      const request = {
        task: 'public-campus-navigation',
        data: {
          task: 'public-campus-navigation',
          phase: 'execute',
          ...input,
          consent: {
            version: 1,
            provider: DETERMINISTIC_PROVIDER,
            schoolId: input.schoolId,
            query: input.query,
            fingerprint: snapshot.fingerprint,
          },
        },
      };
      const task = this.parse(request);
      const receipt = navigationReceipt(
        task,
        snapshot,
        exactNavigation(task.data.query as string, snapshot),
      );
      sameActor(actor, await step(() => this.admission.actor(auth)));
      return {
        request,
        receipt,
        checkedAt: this.clock(),
        dataScope: ['所選校園', '起點與終點', '公開地點目錄'],
        execution: 'deterministic',
      };
    });
  }
  /** Disclosure before the user authorizes sending public query and names to Groq. */
  async prepareGroq(auth: string | undefined, raw: unknown, signal?: AbortSignal) {
    if (!this.options.groqPlan)
      throw new PublicAgentError('PUBLIC_AGENT_EXECUTOR_UNAVAILABLE', 503);
    const input = exactRecord(raw, ['schoolId', 'query', 'requestId']);
    return this.bounded(signal, async (step, abort) => {
      const actor = await step(() => this.admission.actor(auth));
      if (typeof input.schoolId !== 'string' || !/^[A-Za-z0-9_-]{2,40}$/u.test(input.schoolId))
        throw new PublicAgentError('PUBLIC_AGENT_INVALID_INPUT');
      const snapshot = await step(() => this.snapshot(input.schoolId as string, abort));
      const request = {
        task: 'public-campus-navigation',
        data: {
          task: 'public-campus-navigation',
          phase: 'execute',
          ...input,
          consent: {
            provider: FREE_PROVIDER,
            model: FREE_MODEL,
            version: 1,
            schoolId: input.schoolId,
            query: input.query,
            fingerprint: snapshot.fingerprint,
          },
        },
      };
      this.parse(request);
      sameActor(actor, await step(() => this.admission.actor(auth)));
      return {
        request,
        provider: FREE_PROVIDER,
        model: FREE_MODEL,
        dataScope: ['校園', '問題', '公開地點名稱與 ID'],
        sourceDate: snapshot.updatedAt,
        sourceLabel: snapshot.label,
        placeCount: snapshot.places.length,
      };
    });
  }
  /** Explicit second approval binds the delivered suggestion to this still-open operation. */
  async route(auth: string | undefined, raw: unknown, signal?: AbortSignal) {
    const input = exactRecord(raw, ['approved', 'operationId', 'request', 'fromId', 'toId']);
    if (input.approved !== true)
      throw new PublicAgentError('PUBLIC_AGENT_CONFIRMATION_REQUIRED', 409);
    const task = this.parse(input.request);
    if (task.binding.provider !== FREE_PROVIDER || typeof input.operationId !== 'string')
      throw new PublicAgentError('PUBLIC_AGENT_INVALID_INPUT');
    return this.bounded(signal, async (step, abort) => {
      const actor = await step(() => this.admission.actor(auth));
      const lookup = { task: task.binding.task, schoolId: task.binding.schoolId };
      const active = await step(() => this.options.ledger.status(actor, lookup));
      if (!active || active.status !== 'completed' || active.operationId !== input.operationId)
        throw new PublicAgentError('PUBLIC_AGENT_OPERATION_NOT_FOUND', 404);
      const operation = await step(() => this.options.ledger.readBound(actor, task.binding));
      if (
        !operation ||
        operation.status !== 'completed' ||
        operation.operationId !== active.operationId
      )
        throw new PublicAgentError('PUBLIC_AGENT_OPERATION_NOT_FOUND', 404);
      const snapshot = await step(() => this.source(task, abort));
      const plan = validatedPlan(snapshot, { fromId: input.fromId, toId: input.toId });
      if (
        operation.result.sourceFingerprint !== snapshot.fingerprint ||
        !isDeepStrictEqual(JSON.parse(JSON.stringify(operation.result.receipt)), plan)
      )
        throw new PublicAgentError('PUBLIC_AGENT_INVALID_RESULT', 502);
      sameActor(actor, await step(() => this.admission.actor(auth)));
      const current = await step(() => this.options.ledger.status(actor, lookup));
      if (!current || current.status !== 'completed' || current.operationId !== active.operationId)
        throw new PublicAgentError('PUBLIC_AGENT_OPERATION_NOT_FOUND', 404);
      return {
        operationId: active.operationId,
        receipt: confirmedRoute(task, snapshot, { fromId: plan.fromId, toId: plan.toId }),
      };
    });
  }
  async confirm(auth: string | undefined, raw: unknown, signal?: AbortSignal) {
    const input = exactRecord(raw, ['approved', 'request']);
    this.parse(input.request);
    return this.admission.confirm(auth, input, signal);
  }
  async read(auth: string | undefined, raw: unknown, signal?: AbortSignal) {
    const task = this.parse(raw);
    return this.bounded(signal, async (step, abort) => {
      const actor = await step(() => this.admission.actor(auth));
      const operation = await step(() => this.options.ledger.readBound(actor, task.binding));
      return this.deliver(auth, actor, task, operation, step, abort);
    });
  }
  async status(auth: string | undefined, raw: unknown, signal?: AbortSignal) {
    const input = parseRecoveryScope(raw);
    return this.bounded(signal, async (step) => {
      const actor = await step(() => this.admission.actor(auth));
      const result = await step(() => this.options.ledger.status(actor, input));
      sameActor(actor, await step(() => this.admission.actor(auth)));
      return result;
    });
  }
  async ack(auth: string | undefined, raw: unknown, signal?: AbortSignal) {
    const input = parseRecoveryAcknowledgement(raw);
    let started = false;
    try {
      return await this.bounded(signal, async (step) => {
        const actor = await step(() => this.admission.actor(auth));
        started = true;
        const result = await step(() => this.options.ledger.ack(actor, input));
        sameActor(actor, await step(() => this.admission.actor(auth)));
        return result;
      });
    } catch (error) {
      if (
        started &&
        (!(error instanceof PublicAgentError) ||
          [
            'PUBLIC_AGENT_TIMEOUT',
            'PUBLIC_AGENT_CANCELLED',
            'PUBLIC_AGENT_PROVIDER_TIMEOUT',
            'PUBLIC_AGENT_PROVIDER_CANCELLED',
            'PUBLIC_AGENT_PROVIDER_UNAVAILABLE',
          ].includes(error.code))
      )
        throw new PublicAgentError('PUBLIC_AGENT_OUTCOME_UNKNOWN', 503);
      throw error;
    }
  }
  async reconcileNoDispatch(auth: string | undefined, raw: unknown, signal?: AbortSignal) {
    const input = exactRecord(raw, ['task', 'schoolId', 'operationId']);
    let started = false;
    try {
      return await this.bounded(signal, async (step) => {
        const actor = await step(() => this.admission.actor(auth));
        started = true;
        const result = await step(() => this.options.ledger.reconcileNoDispatch(actor, input));
        sameActor(actor, await step(() => this.admission.actor(auth)));
        return result;
      });
    } catch (error) {
      if (
        started &&
        (!(error instanceof PublicAgentError) ||
          ['PUBLIC_AGENT_TIMEOUT', 'PUBLIC_AGENT_CANCELLED'].includes(error.code))
      )
        throw new PublicAgentError('PUBLIC_AGENT_OUTCOME_UNKNOWN', 503);
      throw error;
    }
  }
  async execute(auth: string | undefined, raw: unknown, signal?: AbortSignal) {
    const input = exactRecord(raw, ['confirmationId', 'request']);
    const task = this.parse(input.request);
    let executing:
      | { actor: PlatformTaskActor; operationId: string; executionToken: string }
      | undefined;
    let admitted = false;
    let dispatchAcknowledged = false;
    try {
      return await this.bounded(signal, async (step, abort) => {
        const actor = await step(() => this.admission.actor(auth));
        await step(() => this.source(task, abort));
        admitted = true;
        const claim = await step(() => this.admission.claim(auth, input, abort));
        if (claim.status !== 'claimed') {
          const operation = await step(() => this.options.ledger.readBound(actor, task.binding));
          return this.deliver(auth, actor, task, operation, step, abort);
        }
        executing = { actor, operationId: claim.operationId, executionToken: claim.executionToken };
        sameActor(actor, await step(() => this.admission.actor(auth)));
        const snapshot = await step(() => this.source(task, abort));
        // A successful database commit acknowledgement must precede every executor.
        // If this step times out, the bounded wrapper never invokes the executor even
        // when the database commit arrives late.
        const dispatch = await step(() =>
          this.options.ledger.beginDispatch(
            actor,
            task.binding,
            claim.operationId,
            claim.executionToken,
          ),
        );
        if (dispatch?.started !== true)
          throw new PublicAgentError('PUBLIC_AGENT_OUTCOME_UNKNOWN', 503);
        dispatchAcknowledged = true;
        const rawResult = await step(() =>
          task.binding.provider === FREE_PROVIDER
            ? this.options.groqPlan!(
                {
                  schoolId: task.binding.schoolId,
                  query: task.data.query as string,
                  fingerprint: snapshot.fingerprint,
                },
                abort,
                async () => {
                  sameActor(actor, await this.admission.actor(auth));
                },
              )
            : this.options.execute
              ? this.options.execute(task, snapshot, abort)
              : Promise.resolve(exactNavigation(task.data.query as string, snapshot)),
        );
        const fresh = await step(() => this.source(task, abort));
        const receipt =
          task.binding.provider === FREE_PROVIDER
            ? validatedPlan(fresh, rawResult)
            : navigationReceipt(task, fresh, rawResult);
        sameActor(actor, await step(() => this.admission.actor(auth)));
        await step(() =>
          this.options.ledger.complete(
            actor,
            task.binding,
            claim.operationId,
            claim.executionToken,
            {
              task: task.binding.task,
              schoolId: task.binding.schoolId,
              sourceFingerprint: fresh.fingerprint,
              checkedAt: this.clock(),
              receipt,
            },
          ),
        );
        const operation = await step(() => this.options.ledger.readBound(actor, task.binding));
        return this.deliver(auth, actor, task, operation, step, abort);
      });
    } catch (error) {
      if (executing) {
        const e = executing;
        if (!dispatchAcknowledged) {
          void this.options.ledger
            .markUnknown(e.actor, task.binding, e.operationId, e.executionToken)
            .catch(() => {});
          throw new PublicAgentError('PUBLIC_AGENT_OUTCOME_UNKNOWN', 503);
        }
        // Only definitive provider responses may finish the operation. A lost
        // database acknowledgement remains unknown and is never retried as work.
        const knownFailure =
          error instanceof PublicAgentError
            ? (
                {
                  PUBLIC_AGENT_FREE_QUOTA_UNAVAILABLE: 'FREE_QUOTA_UNAVAILABLE',
                  PUBLIC_AGENT_DESTINATION_UNCLEAR: 'DESTINATION_UNCLEAR',
                  PUBLIC_AGENT_PROVIDER_INVALID_RESPONSE: 'INVALID_PROVIDER_RESPONSE',
                } as const
              )[
                error.code as
                  | 'PUBLIC_AGENT_FREE_QUOTA_UNAVAILABLE'
                  | 'PUBLIC_AGENT_DESTINATION_UNCLEAR'
                  | 'PUBLIC_AGENT_PROVIDER_INVALID_RESPONSE'
              ]
            : undefined;
        if (knownFailure) {
          try {
            const failed = await this.bounded(undefined, (step) =>
              step(() =>
                this.options.ledger.fail(
                  e.actor,
                  task.binding,
                  e.operationId,
                  e.executionToken,
                  knownFailure,
                ),
              ),
            );
            if (failed.status !== 'failed' || failed.failureCode !== knownFailure)
              throw new Error('failure outcome unknown');
            return failed;
          } catch {
            throw new PublicAgentError('PUBLIC_AGENT_OUTCOME_UNKNOWN', 503);
          }
        }
        // This best-effort tombstone cannot make an unknown transaction safe to repeat.
        if (
          error instanceof PublicAgentError &&
          ['PUBLIC_AGENT_SOURCE_CHANGED', 'PUBLIC_AGENT_INVALID_RESULT'].includes(error.code)
        ) {
          void this.options.ledger
            .fail(
              e.actor,
              task.binding,
              e.operationId,
              e.executionToken,
              error.code === 'PUBLIC_AGENT_SOURCE_CHANGED' ? 'SOURCE_CHANGED' : 'INVALID_RESULT',
            )
            .catch(() => {});
        } else {
          void this.options.ledger
            .markUnknown(e.actor, task.binding, e.operationId, e.executionToken)
            .catch(() => {});
        }
      }
      if (
        admitted &&
        (!(error instanceof PublicAgentError) ||
          [
            'PUBLIC_AGENT_TIMEOUT',
            'PUBLIC_AGENT_CANCELLED',
            'PUBLIC_AGENT_PROVIDER_TIMEOUT',
            'PUBLIC_AGENT_PROVIDER_CANCELLED',
            'PUBLIC_AGENT_PROVIDER_UNAVAILABLE',
          ].includes(error.code))
      )
        throw new PublicAgentError('PUBLIC_AGENT_OUTCOME_UNKNOWN', 503);
      throw error;
    }
  }
  private async deliver(
    auth: string | undefined,
    actor: PlatformTaskActor,
    task: ParsedPublicTask,
    operation: Awaited<ReturnType<PlatformPublicAgentLedger['read']>>,
    step: <T>(f: () => Promise<T>) => Promise<T>,
    signal: AbortSignal,
  ) {
    sameActor(actor, await step(() => this.admission.actor(auth)));
    if (operation?.status === 'completed') {
      const scope = { task: task.binding.task, schoolId: task.binding.schoolId };
      const activeBefore = await step(() => this.options.ledger.status(actor, scope));
      if (
        !activeBefore ||
        activeBefore.status !== 'completed' ||
        activeBefore.operationId !== operation.operationId
      )
        throw new PublicAgentError('PUBLIC_AGENT_OPERATION_NOT_FOUND', 404);
      const snapshot = await step(() => this.source(task, signal));
      const stored = operation.result.receipt;
      const receipt =
        task.binding.provider === FREE_PROVIDER
          ? validatedPlan(snapshot, { fromId: stored.fromId, toId: stored.toId })
          : navigationReceipt(task, snapshot, exactNavigation(task.data.query as string, snapshot));
      if (
        operation.result.sourceFingerprint !== snapshot.fingerprint ||
        !isDeepStrictEqual(JSON.parse(JSON.stringify(operation.result.receipt)), receipt)
      )
        throw new PublicAgentError('PUBLIC_AGENT_INVALID_RESULT', 502);
      sameActor(actor, await step(() => this.admission.actor(auth)));
      const activeAfter = await step(() => this.options.ledger.status(actor, scope));
      if (
        !activeAfter ||
        activeAfter.status !== 'completed' ||
        activeAfter.operationId !== operation.operationId
      )
        throw new PublicAgentError('PUBLIC_AGENT_OPERATION_NOT_FOUND', 404);
    }
    return operation;
  }
  private async bounded<T>(
    signal: AbortSignal | undefined,
    run: (step: <R>(work: () => Promise<R>) => Promise<R>, signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const abort = new AbortController();
    let stopped: PublicAgentError | undefined, reject!: (error: PublicAgentError) => void;
    const stop = new Promise<never>((_, fail) => {
      reject = fail;
    });
    void stop.catch(() => {});
    const halt = (code: string) => {
      if (stopped) return;
      stopped = new PublicAgentError(code, 503);
      abort.abort();
      reject(stopped);
    };
    const cancel = () => halt('PUBLIC_AGENT_CANCELLED');
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    const timer = setTimeout(() => halt('PUBLIC_AGENT_TIMEOUT'), this.timeoutMs);
    const step = async <R>(work: () => Promise<R>) => {
      if (stopped) throw stopped;
      const value = await Promise.race([
        Promise.resolve().then(() => {
          if (stopped) throw stopped;
          return work();
        }),
        stop,
      ]);
      if (stopped) throw stopped;
      return value;
    };
    try {
      return await step(() => run(step, abort.signal));
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
    }
  }
}

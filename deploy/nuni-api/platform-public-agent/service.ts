import { isDeepStrictEqual } from 'node:util';
import { PlatformPublicAdmission, type PlatformSessionResolver } from './admission';
import {
  DETERMINISTIC_PROVIDER,
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
      return publicSnapshot(await this.options.readPublicCatalog(school, signal), school);
    } catch (error) {
      if (error instanceof PublicAgentError) throw error;
      throw new PublicAgentError('PUBLIC_AGENT_SOURCE_UNAVAILABLE', 503);
    }
  }
  private parse(raw: unknown) {
    const task = parseConfirmedTask(raw);
    if (
      task.binding.task !== 'public-campus-navigation' ||
      task.binding.provider !== DETERMINISTIC_PROVIDER
    )
      throw new PublicAgentError('PUBLIC_AGENT_EXECUTOR_UNAVAILABLE', 503);
    return task;
  }
  private async source(task: ParsedPublicTask, signal: AbortSignal) {
    const snapshot = await this.snapshot(task.binding.schoolId, signal);
    if (snapshot.fingerprint !== (task.data.consent as { fingerprint: string }).fingerprint)
      throw new PublicAgentError('PUBLIC_AGENT_SOURCE_CHANGED', 409);
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
        const rawResult = await step(() =>
          this.options.execute
            ? this.options.execute(task, snapshot, abort)
            : Promise.resolve(exactNavigation(task.data.query as string, snapshot)),
        );
        const fresh = await step(() => this.source(task, abort));
        const receipt = navigationReceipt(task, fresh, rawResult);
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
          ['PUBLIC_AGENT_TIMEOUT', 'PUBLIC_AGENT_CANCELLED'].includes(error.code))
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
      const snapshot = await step(() => this.source(task, signal));
      const receipt = navigationReceipt(
        task,
        snapshot,
        exactNavigation(task.data.query as string, snapshot),
      );
      if (
        operation.result.sourceFingerprint !== snapshot.fingerprint ||
        !isDeepStrictEqual(JSON.parse(JSON.stringify(operation.result.receipt)), receipt)
      )
        throw new PublicAgentError('PUBLIC_AGENT_INVALID_RESULT', 502);
      sameActor(actor, await step(() => this.admission.actor(auth)));
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

import { createHash } from 'node:crypto';
import {
  exactRecord,
  parseConfirmedTask,
  parseOperationLookup,
  PublicAgentError,
  type ParsedPublicTask,
  type PlatformTaskActor,
} from './contract';
import type { PlatformPublicAgentLedger } from './ledger';

/** Structural subset of PlatformAccountService, verified against the pinned API source. */
export interface PlatformSessionResolver {
  resolveSession(
    authorization: string | undefined,
  ): Promise<Omit<PlatformTaskActor, 'sessionHash'>>;
}
type Ledger = Pick<PlatformPublicAgentLedger, 'confirm' | 'claim' | 'read'>;
type Options = {
  accounts: PlatformSessionResolver;
  ledger: Ledger;
  /** Server-owned, public-only reader. Client rows and fingerprints are not a source. */
  readPublicSourceFingerprint: (
    schoolId: string,
    query: string,
    signal: AbortSignal,
  ) => Promise<string>;
  timeoutMs?: number;
};
type Deadline = {
  signal: AbortSignal;
  persist<T>(work: () => Promise<T>): Promise<T>;
  step<T>(work: () => Promise<T>): Promise<T>;
};

/** Admission only: a claim never means a model ran or an Agent task completed. */
export class PlatformPublicAdmission {
  private readonly timeoutMs: number;
  constructor(private readonly options: Options) {
    this.timeoutMs = options.timeoutMs ?? 10_000;
    if (
      !Number.isSafeInteger(this.timeoutMs) ||
      this.timeoutMs < 1 ||
      this.timeoutMs > 30_000 ||
      typeof options.accounts?.resolveSession !== 'function' ||
      typeof options.readPublicSourceFingerprint !== 'function' ||
      ['confirm', 'claim', 'read'].some(
        (method) => typeof options.ledger?.[method as keyof Ledger] !== 'function',
      )
    ) {
      throw new PublicAgentError('PUBLIC_AGENT_NOT_CONFIGURED', 503);
    }
  }

  async confirm(authorization: string | undefined, raw: unknown, signal?: AbortSignal) {
    const input = exactRecord(raw, ['approved', 'request']);
    if (input.approved !== true)
      throw new PublicAgentError('PUBLIC_AGENT_CONFIRMATION_REQUIRED', 409);
    const task = parseConfirmedTask(input.request);
    return this.bounded(signal, async (deadline) => {
      const actor = await deadline.step(() => this.actor(authorization));
      await this.source(task, deadline);
      // The ledger checks active account, credential and the actual session again under locks.
      return deadline.persist(() => this.options.ledger.confirm(actor, task.binding));
    });
  }

  async claim(authorization: string | undefined, raw: unknown, signal?: AbortSignal) {
    const input = exactRecord(raw, ['confirmationId', 'request']);
    if (
      typeof input.confirmationId !== 'string' ||
      !/^[A-Za-z0-9_-]{8,120}$/u.test(input.confirmationId)
    )
      throw new PublicAgentError('PUBLIC_AGENT_INVALID_INPUT');
    const confirmationId = input.confirmationId;
    const task = parseConfirmedTask(input.request);
    return this.bounded(signal, async (deadline) => {
      const actor = await deadline.step(() => this.actor(authorization));
      await this.source(task, deadline);
      return deadline.persist(() => this.options.ledger.claim(actor, task.binding, confirmationId));
    });
  }

  async read(authorization: string | undefined, raw: unknown, signal?: AbortSignal) {
    const input = parseOperationLookup(raw);
    return this.bounded(signal, async (deadline) => {
      const actor = await deadline.step(() => this.actor(authorization));
      try {
        return await deadline.step(() => this.options.ledger.read(actor, input));
      } catch (error) {
        if (error instanceof PublicAgentError) throw error;
        throw new PublicAgentError('PUBLIC_AGENT_STATE_UNAVAILABLE', 503);
      }
    });
  }

  private async actor(authorization: string | undefined): Promise<PlatformTaskActor> {
    const [scheme, handle, extra] = authorization?.trim().split(/\s+/u) ?? [];
    if (scheme !== 'Platform' || !handle || extra || !/^ps_[A-Za-z0-9_-]{43}$/u.test(handle))
      throw new PublicAgentError('PUBLIC_AGENT_SESSION_INVALID', 401);
    try {
      const actor = await this.options.accounts.resolveSession(authorization);
      return {
        platformAccountId: actor.platformAccountId,
        credentialId: actor.credentialId,
        expiresAt: actor.expiresAt,
        sessionHash: createHash('sha256').update(handle).digest('hex'),
      };
    } catch (error) {
      const invalid =
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'PLATFORM_SESSION_INVALID';
      throw new PublicAgentError(
        invalid ? 'PUBLIC_AGENT_SESSION_INVALID' : 'PUBLIC_AGENT_SESSION_CHECK_UNAVAILABLE',
        invalid ? 401 : 503,
      );
    }
  }

  private async source(task: ParsedPublicTask, deadline: Deadline) {
    if (task.binding.task !== 'public-campus-navigation') return;
    const consent = task.data.consent as Readonly<{ fingerprint: string }>;
    let fingerprint: string;
    try {
      fingerprint = await deadline.step(() =>
        this.options.readPublicSourceFingerprint(
          task.binding.schoolId,
          task.data.query as string,
          deadline.signal,
        ),
      );
    } catch (error) {
      if (error instanceof PublicAgentError) throw error;
      throw new PublicAgentError('PUBLIC_AGENT_SOURCE_UNAVAILABLE', 503);
    }
    if (!/^[a-f0-9]{64}$/u.test(fingerprint) || fingerprint !== consent.fingerprint)
      throw new PublicAgentError('PUBLIC_AGENT_SOURCE_CHANGED', 409);
  }

  private async bounded<T>(
    signal: AbortSignal | undefined,
    run: (deadline: Deadline) => Promise<T>,
  ): Promise<T> {
    const controller = new AbortController();
    let persisting = false;
    let stopped: PublicAgentError | undefined;
    let rejectStop!: (error: PublicAgentError) => void;
    const stop = new Promise<never>((_, reject) => {
      rejectStop = reject;
    });
    void stop.catch(() => {});
    const halt = (code: string) => {
      if (stopped) return;
      stopped = new PublicAgentError(persisting ? 'PUBLIC_AGENT_OUTCOME_UNKNOWN' : code, 503);
      controller.abort();
      rejectStop(stopped);
    };
    const onAbort = () => halt('PUBLIC_AGENT_CANCELLED');
    const step = async <R>(work: () => Promise<R>): Promise<R> => {
      if (stopped) throw stopped;
      const result = await Promise.race([
        Promise.resolve().then(() => {
          if (stopped) throw stopped;
          return work();
        }),
        stop,
      ]);
      if (stopped) throw stopped;
      return result;
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
    const timer = setTimeout(() => halt('PUBLIC_AGENT_TIMEOUT'), this.timeoutMs);
    try {
      return await step(() =>
        run({
          signal: controller.signal,
          step,
          persist: async <R>(work: () => Promise<R>): Promise<R> => {
            persisting = true;
            try {
              return await step(work);
            } catch (error) {
              if (error instanceof PublicAgentError) throw error;
              // A missing commit acknowledgement is not permission to spend or claim again.
              throw new PublicAgentError('PUBLIC_AGENT_OUTCOME_UNKNOWN', 503);
            }
          },
        }),
      );
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }
}

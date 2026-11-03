import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  exactRecord,
  parseOperationLookup,
  PublicAgentError,
  isExecutionPair,
  parseRecoveryScope,
  parseRecoveryAcknowledgement,
  type PlatformTaskActor,
  type TaskBinding,
  type PublicTaskName,
} from './contract';

export interface PublicAgentSql {
  query<Row = Record<string, unknown>>(
    sql: string,
    parameters?: readonly unknown[],
  ): Promise<{ rows: Row[] }>;
}
export interface PublicAgentDatabase {
  transaction<T>(
    run: (tx: PublicAgentSql) => Promise<T>,
    options?: { isolationLevel?: 'read committed' },
  ): Promise<T>;
}
export interface PublicAgentPolicy {
  providerBudgetKey: string;
  providerDailyLimit: number;
  accountDailyLimit: number;
  maxConfirmationsPerAccount?: number;
  confirmationTtlMs?: number;
  operationTtlMs?: number;
}
export type PublicJson =
  | null
  | boolean
  | number
  | string
  | PublicJson[]
  | { [key: string]: PublicJson };
export type PublicAgentResult = {
  task: PublicTaskName;
  schoolId: string;
  sourceFingerprint: string;
  checkedAt: number;
  receipt: { [key: string]: PublicJson };
};
export type PublicAgentFailureCode =
  | 'SOURCE_CHANGED'
  | 'INVALID_RESULT'
  | 'EXECUTION_FAILED'
  | 'FREE_QUOTA_UNAVAILABLE'
  | 'DESTINATION_UNCLEAR'
  | 'INVALID_PROVIDER_RESPONSE'
  | 'NOT_DISPATCHED';
type OperationIdentity = { operationId: string; expiresAt: number };
export type PublicAgentOperation = OperationIdentity &
  (
    | { status: 'pending' | 'unknown' }
    | { status: 'completed'; result: PublicAgentResult }
    | { status: 'failed'; failureCode: PublicAgentFailureCode }
  );
export type PublicAgentClaim =
  | PublicAgentOperation
  | (OperationIdentity & {
      status: 'claimed';
      executionToken: string;
    });
type BindingRow = {
  platform_account_id: string;
  credential_id: string;
  session_hash: string;
  task: PublicTaskName;
  request_id: string;
  school_id: string;
  payload_hash: string;
  provider: string;
  model: string;
};
type ConfirmationRow = BindingRow & {
  id: string;
  expires_at: Date | string;
  consumed_at: Date | string | null;
  unexpired: boolean;
};
type OperationRow = BindingRow & {
  id: string;
  confirmation_id: string;
  status: 'running' | 'unknown' | 'completed' | 'failed';
  execution_token_hash: string;
  acknowledged_at: Date | string | null;
  dispatch_started_at: Date | string | null;
  dispatch_fence_version: number;
  result_json: unknown;
  failure_code: unknown;
  expires_at: Date | string;
  unexpired: boolean;
};
const HASH = /^[a-f0-9]{64}$/u;
const ACCOUNT = /^pa_[a-f0-9-]{36}$/u;
const IDENTIFIER = /^[A-Za-z0-9_-]+$/u;
const fail = (code: string, status = 422): never => {
  throw new PublicAgentError(code, status);
};
const validId = (value: unknown, min: number, max: number) =>
  typeof value === 'string' && value.length >= min && value.length <= max && IDENTIFIER.test(value);
const positive = (value: unknown, max: number) =>
  Number.isSafeInteger(value) && (value as number) >= 1 && (value as number) <= max;
function expiry(value: Date | string): number {
  if (!(value instanceof Date) && typeof value !== 'string')
    return fail('PUBLIC_AGENT_STORE_INVALID', 503);
  const time = new Date(value).getTime();
  return Number.isSafeInteger(time) ? time : fail('PUBLIC_AGENT_STORE_INVALID', 503);
}
function bindingInput(value: TaskBinding): TaskBinding {
  const row = exactRecord(value, [
    'task',
    'requestId',
    'schoolId',
    'payloadHash',
    'provider',
    'model',
  ]);
  if (
    (row.task !== 'campus-service-entry' && row.task !== 'public-campus-navigation') ||
    !validId(row.requestId, 8, 100) ||
    !validId(row.schoolId, 2, 40) ||
    typeof row.payloadHash !== 'string' ||
    !HASH.test(row.payloadHash) ||
    !isExecutionPair(row.provider, row.model, row.task)
  )
    return fail('PUBLIC_AGENT_INVALID_INPUT');
  return Object.freeze({
    task: row.task,
    requestId: row.requestId as string,
    schoolId: row.schoolId as string,
    payloadHash: row.payloadHash,
    provider: row.provider as TaskBinding['provider'],
    model: row.model as TaskBinding['model'],
  });
}

const failureCode = (value: unknown): value is PublicAgentFailureCode =>
  value === 'SOURCE_CHANGED' ||
  value === 'INVALID_RESULT' ||
  value === 'EXECUTION_FAILED' ||
  value === 'FREE_QUOTA_UNAVAILABLE' ||
  value === 'DESTINATION_UNCLEAR' ||
  value === 'INVALID_PROVIDER_RESPONSE' ||
  value === 'NOT_DISPATCHED';
function resultInput(value: unknown, task: PublicTaskName, schoolId: string): PublicAgentResult {
  const row = exactRecord(value, ['task', 'schoolId', 'sourceFingerprint', 'checkedAt', 'receipt']);
  if (
    row.task !== task ||
    row.schoolId !== schoolId ||
    typeof row.sourceFingerprint !== 'string' ||
    !HASH.test(row.sourceFingerprint) ||
    !Number.isSafeInteger(row.checkedAt) ||
    (row.checkedAt as number) < 0
  )
    return fail('PUBLIC_AGENT_INVALID_RESULT');
  let nodes = 0;
  const clone = (input: unknown, depth: number): PublicJson => {
    if (++nodes > 256 || depth > 8) return fail('PUBLIC_AGENT_INVALID_RESULT');
    if (input === null || typeof input === 'boolean') return input;
    if (typeof input === 'number' && Number.isFinite(input)) return input;
    if (typeof input === 'string' && input.length <= 2048) return input;
    if (!input || typeof input !== 'object') return fail('PUBLIC_AGENT_INVALID_RESULT');
    if (Array.isArray(input)) {
      if (
        Object.getPrototypeOf(input) !== Array.prototype ||
        input.length > 64 ||
        Reflect.ownKeys(input).length !== input.length + 1
      )
        return fail('PUBLIC_AGENT_INVALID_RESULT');
      return Array.from({ length: input.length }, (_, index) => {
        const item = Object.getOwnPropertyDescriptor(input, String(index));
        if (!item || !('value' in item)) return fail('PUBLIC_AGENT_INVALID_RESULT');
        return clone(item.value, depth + 1);
      });
    }
    const proto = Object.getPrototypeOf(input),
      keys = Reflect.ownKeys(input);
    if ((proto !== Object.prototype && proto !== null) || keys.length > 64)
      return fail('PUBLIC_AGENT_INVALID_RESULT');
    const output: { [key: string]: PublicJson } = {};
    for (const key of keys) {
      if (
        typeof key !== 'string' ||
        key.length > 80 ||
        ['__proto__', 'prototype', 'constructor'].includes(key)
      )
        return fail('PUBLIC_AGENT_INVALID_RESULT');
      const item = Object.getOwnPropertyDescriptor(input, key);
      if (!item || !('value' in item)) return fail('PUBLIC_AGENT_INVALID_RESULT');
      output[key] = clone(item.value, depth + 1);
    }
    return output;
  };
  if (!row.receipt || typeof row.receipt !== 'object' || Array.isArray(row.receipt))
    return fail('PUBLIC_AGENT_INVALID_RESULT');
  const result = {
    task,
    schoolId,
    sourceFingerprint: row.sourceFingerprint,
    checkedAt: row.checkedAt as number,
    receipt: clone(row.receipt, 0) as { [key: string]: PublicJson },
  };
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > 16_384)
    return fail('PUBLIC_AGENT_INVALID_RESULT');
  return result;
}

/** Persistent task state; execution and task-specific receipt validation belong to the service. */
export class PlatformPublicAgentLedger {
  private readonly policy: Required<PublicAgentPolicy>;
  constructor(
    private readonly db: PublicAgentDatabase,
    policy: PublicAgentPolicy,
    private readonly clock = Date.now,
  ) {
    const maxConfirmationsPerAccount =
      policy?.maxConfirmationsPerAccount === undefined ? 1_000 : policy.maxConfirmationsPerAccount;
    if (
      !db ||
      typeof db.transaction !== 'function' ||
      !policy ||
      typeof policy.providerBudgetKey !== 'string' ||
      !/^[A-Za-z0-9:_-]{1,160}$/u.test(policy.providerBudgetKey) ||
      !positive(policy.providerDailyLimit, 10_000) ||
      !positive(policy.accountDailyLimit, 10_000) ||
      !positive(maxConfirmationsPerAccount, 10_000) ||
      !positive(policy.confirmationTtlMs ?? 60_000, 300_000) ||
      !positive(policy.operationTtlMs ?? 30_000, 30_000) ||
      typeof clock !== 'function'
    )
      fail('PUBLIC_AGENT_CONFIGURATION_REQUIRED', 503);
    this.policy = Object.freeze({
      ...policy,
      maxConfirmationsPerAccount,
      confirmationTtlMs: policy.confirmationTtlMs ?? 60_000,
      operationTtlMs: policy.operationTtlMs ?? 30_000,
    });
  }

  private actorInput(value: PlatformTaskActor): PlatformTaskActor {
    const actor = exactRecord(value, [
      'platformAccountId',
      'credentialId',
      'expiresAt',
      'sessionHash',
    ]);
    const now = this.clock();
    if (
      typeof actor.platformAccountId !== 'string' ||
      !ACCOUNT.test(actor.platformAccountId) ||
      !validId(actor.credentialId, 1, 100) ||
      typeof actor.sessionHash !== 'string' ||
      !HASH.test(actor.sessionHash) ||
      !Number.isSafeInteger(actor.expiresAt) ||
      !Number.isFinite(now) ||
      (actor.expiresAt as number) <= now
    )
      return fail('PUBLIC_AGENT_SESSION_EXPIRED', 401);
    return Object.freeze({
      platformAccountId: actor.platformAccountId,
      credentialId: actor.credentialId as string,
      sessionHash: actor.sessionHash,
      expiresAt: actor.expiresAt as number,
    });
  }

  private async transaction<T>(run: (tx: PublicAgentSql) => Promise<T>): Promise<T> {
    try {
      return await this.db.transaction(run, { isolationLevel: 'read committed' });
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
      if (['23505', '40001', '40P01'].includes(code)) return fail('PUBLIC_AGENT_CONFLICT', 409);
      throw error;
    }
  }

  private async verifyActor(tx: PublicAgentSql, actor: PlatformTaskActor): Promise<Date | string> {
    // Same lock order as the existing account closure and personal-import service.
    const account = await tx.query(
      `SELECT id FROM platform_accounts WHERE id=$1 AND state='active' FOR SHARE`,
      [actor.platformAccountId],
    );
    if (!account.rows.length) return fail('PUBLIC_AGENT_SESSION_EXPIRED', 401);
    const credential = await tx.query<{ id: string; method: string }>(
      `SELECT id,method FROM platform_account_credentials
      WHERE id=$1 AND platform_account_id=$2 AND state='active' FOR SHARE`,
      [actor.credentialId, actor.platformAccountId],
    );
    if (!credential.rows.length) return fail('PUBLIC_AGENT_SESSION_EXPIRED', 401);
    if (typeof credential.rows[0]?.method !== 'string' || !credential.rows[0].method)
      return fail('PUBLIC_AGENT_STORE_INVALID', 503);
    if (credential.rows[0]?.method === 'password') {
      const assignment = await tx.query(
        `SELECT platform_account_id FROM platform_operator_assignments
        WHERE platform_account_id=$1 AND role_key='platform-operator' AND state='active' FOR SHARE`,
        [actor.platformAccountId],
      );
      if (!assignment.rows.length) return fail('PUBLIC_AGENT_SESSION_EXPIRED', 401);
    }
    return this.verifySession(tx, actor);
  }
  private async verifySession(
    tx: PublicAgentSql,
    actor: PlatformTaskActor,
  ): Promise<Date | string> {
    const session = (
      await tx.query<{ expires_at: Date | string }>(
        `SELECT expires_at FROM platform_account_sessions
      WHERE token_sha256=$1 AND platform_account_id=$2 AND credential_id=$3 AND expires_at>clock_timestamp() FOR SHARE`,
        [actor.sessionHash, actor.platformAccountId, actor.credentialId],
      )
    ).rows[0];
    if (!session) return fail('PUBLIC_AGENT_SESSION_EXPIRED', 401);
    expiry(session.expires_at);
    return session.expires_at;
  }

  private async lockAccount(tx: PublicAgentSql, actor: PlatformTaskActor): Promise<void> {
    await tx.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
      `public-agent:account:${actor.platformAccountId}`,
    ]);
  }
  private sameBinding(row: BindingRow, actor: PlatformTaskActor, binding: TaskBinding): void {
    if (
      row.platform_account_id !== actor.platformAccountId ||
      row.credential_id !== actor.credentialId ||
      row.session_hash !== actor.sessionHash ||
      row.task !== binding.task ||
      row.request_id !== binding.requestId ||
      row.school_id !== binding.schoolId ||
      row.payload_hash !== binding.payloadHash ||
      row.provider !== binding.provider ||
      row.model !== binding.model
    )
      fail('PUBLIC_AGENT_REQUEST_CONFLICT', 409);
  }
  private async operation(
    tx: PublicAgentSql,
    actor: PlatformTaskActor,
    task: PublicTaskName,
    requestId: string,
  ): Promise<OperationRow | undefined> {
    return (
      await tx.query<OperationRow>(
        `SELECT *,expires_at>clock_timestamp() AS unexpired FROM platform_public_agent_operations
      WHERE platform_account_id=$1 AND task=$2 AND request_id=$3 FOR UPDATE`,
        [actor.platformAccountId, task, requestId],
      )
    ).rows[0];
  }
  private async unacknowledged(
    tx: PublicAgentSql,
    actor: PlatformTaskActor,
    task: PublicTaskName,
    schoolId: string,
  ): Promise<
    | {
        id: string;
        status: OperationRow['status'];
        unexpired: boolean;
        dispatch_fence_version: number;
      }
    | undefined
  > {
    const rows = (
      await tx.query<{
        id: string;
        status: OperationRow['status'];
        unexpired: boolean;
        dispatch_fence_version: number;
      }>(
        `SELECT id,status,dispatch_fence_version,expires_at>clock_timestamp() AS unexpired FROM platform_public_agent_operations
       WHERE platform_account_id=$1 AND school_id=$2 AND task=$3 AND acknowledged_at IS NULL LIMIT 2 FOR UPDATE`,
        [actor.platformAccountId, schoolId, task],
      )
    ).rows;
    if (rows.length > 1 || (rows[0] && rows[0].dispatch_fence_version !== 1))
      return fail('PUBLIC_AGENT_STORE_INVALID', 503);
    return rows[0];
  }
  private async requireClearScope(
    tx: PublicAgentSql,
    actor: PlatformTaskActor,
    binding: TaskBinding,
  ): Promise<void> {
    const open = await this.unacknowledged(tx, actor, binding.task, binding.schoolId);
    if (!open) return;
    const same = await this.operation(tx, actor, binding.task, binding.requestId);
    if (!same || same.id !== open.id) return fail('PUBLIC_AGENT_OPEN_OPERATION', 409);
    this.sameBinding(same, actor, binding);
  }
  private async state(tx: PublicAgentSql, row: OperationRow): Promise<PublicAgentOperation> {
    if (
      !['running', 'unknown', 'completed', 'failed'].includes(row.status) ||
      row.dispatch_fence_version !== 1
    )
      return fail('PUBLIC_AGENT_STORE_INVALID', 503);
    if (typeof row.unexpired !== 'boolean') return fail('PUBLIC_AGENT_STORE_INVALID', 503);
    if (row.status === 'running' && !row.unexpired) {
      const updated = (
        await tx.query<{ id: string }>(
          `UPDATE platform_public_agent_operations SET status='unknown',updated_at=clock_timestamp()
        WHERE id=$1 AND platform_account_id=$2 AND session_hash=$3 AND payload_hash=$4
          AND status='running' AND expires_at<=clock_timestamp() RETURNING id`,
          [row.id, row.platform_account_id, row.session_hash, row.payload_hash],
        )
      ).rows[0];
      if (!updated || updated.id !== row.id) return fail('PUBLIC_AGENT_CONFLICT', 409);
      row = { ...row, status: 'unknown' };
    }
    const identity = { operationId: row.id, expiresAt: expiry(row.expires_at) };
    if (row.status === 'completed') {
      try {
        return {
          ...identity,
          status: 'completed',
          result: resultInput(row.result_json, row.task, row.school_id),
        };
      } catch {
        return fail('PUBLIC_AGENT_STORE_INVALID', 503);
      }
    }
    if (row.status === 'failed') {
      if (!failureCode(row.failure_code)) return fail('PUBLIC_AGENT_STORE_INVALID', 503);
      return { ...identity, status: 'failed', failureCode: row.failure_code };
    }
    return { ...identity, status: row.status === 'unknown' ? 'unknown' : 'pending' };
  }

  async confirm(
    rawActor: PlatformTaskActor,
    rawBinding: TaskBinding,
  ): Promise<{ confirmationId: string; expiresAt: number }> {
    const actor = this.actorInput(rawActor),
      binding = bindingInput(rawBinding);
    return this.transaction(async (tx) => {
      await this.verifyActor(tx, actor);
      await this.lockAccount(tx, actor);
      const sessionExpiry = await this.verifySession(tx, actor);
      const existing = (
        await tx.query<ConfirmationRow>(
          `SELECT *,expires_at>clock_timestamp() AS unexpired FROM platform_public_agent_confirmations
        WHERE platform_account_id=$1 AND task=$2 AND request_id=$3 FOR UPDATE`,
          [actor.platformAccountId, binding.task, binding.requestId],
        )
      ).rows[0];
      if (existing) {
        this.sameBinding(existing, actor, binding);
        await this.requireClearScope(tx, actor, binding);
        if (existing.unexpired !== true) return fail('PUBLIC_AGENT_CONFIRMATION_EXPIRED', 409);
        return { confirmationId: existing.id, expiresAt: expiry(existing.expires_at) };
      }
      await this.requireClearScope(tx, actor, binding);
      // Retain consumed/expired bindings; capacity never silently forgets request IDs.
      const capacity = (
        await tx.query<{ at_capacity: boolean }>(
          `SELECT count(*) >= $2 AS at_capacity
        FROM platform_public_agent_confirmations WHERE platform_account_id=$1`,
          [actor.platformAccountId, this.policy.maxConfirmationsPerAccount],
        )
      ).rows[0];
      if (typeof capacity?.at_capacity !== 'boolean')
        return fail('PUBLIC_AGENT_STORE_INVALID', 503);
      if (capacity.at_capacity) return fail('PUBLIC_AGENT_CONFIRMATION_CAPACITY', 429);
      const id = `pagc_${randomUUID()}`;
      const row = (
        await tx.query<{ id: string; expires_at: Date | string }>(
          `INSERT INTO platform_public_agent_confirmations
        (id,platform_account_id,credential_id,session_hash,task,request_id,school_id,payload_hash,provider,model,expires_at)
        SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,LEAST($11::timestamptz,clock_timestamp()+($12::double precision*interval '1 millisecond'))
        WHERE $11::timestamptz>clock_timestamp()
        RETURNING id,expires_at`,
          [
            id,
            actor.platformAccountId,
            actor.credentialId,
            actor.sessionHash,
            binding.task,
            binding.requestId,
            binding.schoolId,
            binding.payloadHash,
            binding.provider,
            binding.model,
            sessionExpiry,
            this.policy.confirmationTtlMs,
          ],
        )
      ).rows[0];
      if (!row) return fail('PUBLIC_AGENT_SESSION_EXPIRED', 401);
      if (row.id !== id) return fail('PUBLIC_AGENT_STORE_INVALID', 503);
      return { confirmationId: row.id, expiresAt: expiry(row.expires_at) };
    });
  }

  async claim(
    rawActor: PlatformTaskActor,
    rawBinding: TaskBinding,
    confirmationId: string,
  ): Promise<PublicAgentClaim> {
    const actor = this.actorInput(rawActor),
      binding = bindingInput(rawBinding);
    if (typeof confirmationId !== 'string' || !/^pagc_[a-f0-9-]{36}$/u.test(confirmationId))
      return fail('PUBLIC_AGENT_INVALID_INPUT');
    return this.transaction(async (tx) => {
      await this.verifyActor(tx, actor);
      // Shared provider budget first, then account: all claim transactions use this order.
      await tx.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
        `public-agent:provider:${this.policy.providerBudgetKey}`,
      ]);
      await this.lockAccount(tx, actor);
      const sessionExpiry = await this.verifySession(tx, actor);
      const existing = await this.operation(tx, actor, binding.task, binding.requestId);
      if (existing) {
        this.sameBinding(existing, actor, binding);
        if (existing.confirmation_id !== confirmationId)
          return fail('PUBLIC_AGENT_CONFIRMATION_CONFLICT', 409);
        return this.state(tx, existing);
      }
      await this.requireClearScope(tx, actor, binding);
      const confirmation = (
        await tx.query<ConfirmationRow>(
          `SELECT *,expires_at>clock_timestamp() AS unexpired FROM platform_public_agent_confirmations
        WHERE id=$1 AND platform_account_id=$2 FOR UPDATE`,
          [confirmationId, actor.platformAccountId],
        )
      ).rows[0];
      if (!confirmation) return fail('PUBLIC_AGENT_CONFIRMATION_REQUIRED', 409);
      this.sameBinding(confirmation, actor, binding);
      if (confirmation.unexpired !== true) return fail('PUBLIC_AGENT_CONFIRMATION_EXPIRED', 409);
      if (confirmation.consumed_at !== null) return fail('PUBLIC_AGENT_CONFIRMATION_REPLAYED', 409);
      const consumed = (
        await tx.query<{ id: string }>(
          `UPDATE platform_public_agent_confirmations SET consumed_at=clock_timestamp()
        WHERE id=$1 AND platform_account_id=$2 AND credential_id=$3 AND session_hash=$4
          AND task=$5 AND request_id=$6 AND school_id=$7 AND payload_hash=$8 AND provider=$9 AND model=$10
          AND consumed_at IS NULL AND expires_at>clock_timestamp() RETURNING id`,
          [
            confirmationId,
            actor.platformAccountId,
            actor.credentialId,
            actor.sessionHash,
            binding.task,
            binding.requestId,
            binding.schoolId,
            binding.payloadHash,
            binding.provider,
            binding.model,
          ],
        )
      ).rows[0];
      if (!consumed || consumed.id !== confirmationId)
        return fail('PUBLIC_AGENT_CONFIRMATION_REPLAYED', 409);
      const quotaDay = (
        await tx.query<{ quota_day: string }>(
          `SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD') AS quota_day`,
        )
      ).rows[0]?.quota_day;
      if (typeof quotaDay !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(quotaDay))
        return fail('PUBLIC_AGENT_STORE_INVALID', 503);
      await this.debit(
        tx,
        'provider',
        this.policy.providerBudgetKey,
        null,
        this.policy.providerDailyLimit,
        quotaDay,
      );
      await this.debit(
        tx,
        'account',
        actor.platformAccountId,
        actor.platformAccountId,
        this.policy.accountDailyLimit,
        quotaDay,
      );
      const operationId = `pago_${randomUUID()}`;
      const executionToken = randomBytes(32).toString('base64url');
      const tokenHash = createHash('sha256').update(executionToken).digest('hex');
      const row = (
        await tx.query<{ id: string; expires_at: Date | string }>(
          `INSERT INTO platform_public_agent_operations
        (id,platform_account_id,credential_id,session_hash,task,request_id,school_id,payload_hash,provider,model,confirmation_id,status,expires_at,execution_token_hash,dispatch_fence_version)
        SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'running',
          LEAST($12::timestamptz,$13::timestamptz,clock_timestamp()+($14::double precision*interval '1 millisecond')),$15,1
        WHERE $12::timestamptz>clock_timestamp() AND $13::timestamptz>clock_timestamp()
        RETURNING id,expires_at`,
          [
            operationId,
            actor.platformAccountId,
            actor.credentialId,
            actor.sessionHash,
            binding.task,
            binding.requestId,
            binding.schoolId,
            binding.payloadHash,
            binding.provider,
            binding.model,
            confirmationId,
            confirmation.expires_at,
            sessionExpiry,
            this.policy.operationTtlMs,
            tokenHash,
          ],
        )
      ).rows[0];
      if (!row) return fail('PUBLIC_AGENT_ADMISSION_EXPIRED', 409);
      if (row.id !== operationId) return fail('PUBLIC_AGENT_STORE_INVALID', 503);
      return {
        status: 'claimed',
        operationId: row.id,
        expiresAt: expiry(row.expires_at),
        executionToken,
      };
    });
  }

  private async debit(
    tx: PublicAgentSql,
    kind: 'account' | 'provider',
    key: string,
    accountId: string | null,
    limit: number,
    quotaDay: string,
  ): Promise<void> {
    const row = (
      await tx.query<{ used: number }>(
        `INSERT INTO platform_public_agent_quota
      (budget_kind,budget_key,platform_account_id,window_start,used)
      VALUES ($1,$2,$3,$5::date,1)
      ON CONFLICT (budget_kind,budget_key,window_start) DO UPDATE
      SET used=platform_public_agent_quota.used+1
      WHERE platform_public_agent_quota.used<$4 RETURNING used`,
        [kind, key, accountId, limit, quotaDay],
      )
    ).rows[0];
    if (!row) return fail('PUBLIC_AGENT_FREE_QUOTA_UNAVAILABLE', 429);
    if (!Number.isSafeInteger(row.used) || row.used < 1 || row.used > limit)
      return fail('PUBLIC_AGENT_STORE_INVALID', 503);
  }

  async status(
    rawActor: PlatformTaskActor,
    raw: unknown,
  ): Promise<{
    status: 'pending' | 'unknown' | 'completed' | 'failed';
    operationId: string;
  } | null> {
    const { task, schoolId } = parseRecoveryScope(raw),
      actor = this.actorInput(rawActor);
    return this.transaction(async (tx) => {
      await this.verifyActor(tx, actor);
      await this.lockAccount(tx, actor);
      await this.verifySession(tx, actor);
      const row = await this.unacknowledged(tx, actor, task, schoolId);
      if (!row) return null;
      if (
        !['running', 'unknown', 'completed', 'failed'].includes(row.status) ||
        typeof row.unexpired !== 'boolean'
      )
        return fail('PUBLIC_AGENT_STORE_INVALID', 503);
      const status =
        row.status === 'running' ? (row.unexpired ? 'pending' : 'unknown') : row.status;
      return { status, operationId: row.id };
    });
  }
  async ack(
    rawActor: PlatformTaskActor,
    raw: unknown,
  ): Promise<{ status: 'acknowledged'; operationId: string }> {
    const { task, schoolId, operationId: id } = parseRecoveryAcknowledgement(raw),
      actor = this.actorInput(rawActor);
    return this.transaction(async (tx) => {
      await this.verifyActor(tx, actor);
      await this.lockAccount(tx, actor);
      await this.verifySession(tx, actor);
      const row = (
        await tx.query<
          Pick<OperationRow, 'id' | 'status' | 'acknowledged_at' | 'dispatch_fence_version'>
        >(
          `SELECT id,status,acknowledged_at,dispatch_fence_version FROM platform_public_agent_operations
         WHERE platform_account_id=$1 AND school_id=$2 AND task=$3 AND id=$4 FOR UPDATE`,
          [actor.platformAccountId, schoolId, task, id],
        )
      ).rows[0];
      if (!row) return fail('PUBLIC_AGENT_OPERATION_NOT_FOUND', 404);
      if (row.dispatch_fence_version !== 1) return fail('PUBLIC_AGENT_STORE_INVALID', 503);
      if (!['running', 'unknown', 'completed', 'failed'].includes(row.status))
        return fail('PUBLIC_AGENT_STORE_INVALID', 503);
      if (row.status !== 'completed' && row.status !== 'failed')
        return fail('PUBLIC_AGENT_OUTCOME_UNKNOWN', 409);
      if (row.acknowledged_at === null) {
        const changed = (
          await tx.query<{ id: string }>(
            `UPDATE platform_public_agent_operations SET acknowledged_at=clock_timestamp(),updated_at=clock_timestamp()
           WHERE platform_account_id=$1 AND school_id=$2 AND task=$3 AND id=$4
             AND acknowledged_at IS NULL AND status IN ('completed','failed') RETURNING id`,
            [actor.platformAccountId, schoolId, task, id],
          )
        ).rows[0];
        if (!changed || changed.id !== id) return fail('PUBLIC_AGENT_CONFLICT', 409);
      } else if (!(row.acknowledged_at instanceof Date) && typeof row.acknowledged_at !== 'string')
        return fail('PUBLIC_AGENT_STORE_INVALID', 503);
      return { status: 'acknowledged', operationId: id };
    });
  }

  /** A durable dispatch fence; commit must be acknowledged before any executor call. */
  async beginDispatch(
    rawActor: PlatformTaskActor,
    rawBinding: TaskBinding,
    operationId: string,
    executionToken: string,
  ): Promise<{ started: true }> {
    const actor = this.actorInput(rawActor),
      binding = bindingInput(rawBinding);
    if (
      typeof operationId !== 'string' ||
      !/^pago_[a-f0-9-]{36}$/u.test(operationId) ||
      typeof executionToken !== 'string' ||
      !/^[A-Za-z0-9_-]{43}$/u.test(executionToken)
    )
      return fail('PUBLIC_AGENT_EXECUTION_LEASE_INVALID', 409);
    const tokenHash = createHash('sha256').update(executionToken).digest('hex');
    return this.transaction(async (tx) => {
      await this.verifyActor(tx, actor);
      await this.lockAccount(tx, actor);
      await this.verifySession(tx, actor);
      const row = await this.operation(tx, actor, binding.task, binding.requestId);
      if (!row || row.id !== operationId) return fail('PUBLIC_AGENT_OPERATION_NOT_FOUND', 404);
      this.sameBinding(row, actor, binding);
      if (row.dispatch_fence_version !== 1) return fail('PUBLIC_AGENT_STORE_INVALID', 503);
      if (
        typeof row.execution_token_hash !== 'string' ||
        !HASH.test(row.execution_token_hash) ||
        !timingSafeEqual(
          Buffer.from(tokenHash, 'hex'),
          Buffer.from(row.execution_token_hash, 'hex'),
        )
      )
        return fail('PUBLIC_AGENT_EXECUTION_LEASE_INVALID', 409);
      if (row.status !== 'running' || row.unexpired !== true)
        return fail('PUBLIC_AGENT_OUTCOME_UNKNOWN', 409);
      if (row.dispatch_started_at !== null)
        return fail('PUBLIC_AGENT_DISPATCH_ALREADY_STARTED', 409);
      const changed = (
        await tx.query<{ id: string }>(
          `UPDATE platform_public_agent_operations
        SET dispatch_started_at=clock_timestamp(),updated_at=clock_timestamp()
        WHERE id=$1 AND platform_account_id=$2 AND session_hash=$3 AND payload_hash=$4
          AND execution_token_hash=$5 AND status='running' AND expires_at>clock_timestamp()
          AND dispatch_fence_version=1 AND dispatch_started_at IS NULL RETURNING id`,
          [operationId, actor.platformAccountId, actor.sessionHash, binding.payloadHash, tokenHash],
        )
      ).rows[0];
      if (!changed || changed.id !== operationId) return fail('PUBLIC_AGENT_OUTCOME_UNKNOWN', 409);
      return { started: true as const };
    });
  }

  /** Only the durable absence of a dispatch fence can prove non-execution. */
  async reconcileNoDispatch(
    rawActor: PlatformTaskActor,
    raw: unknown,
  ): Promise<{ status: 'failed'; operationId: string }> {
    const input = exactRecord(raw, ['task', 'schoolId', 'operationId']);
    const { task, schoolId, operationId } = parseRecoveryAcknowledgement({
      ...input,
      approved: true,
    });
    const actor = this.actorInput(rawActor);
    return this.transaction(async (tx) => {
      await this.verifyActor(tx, actor);
      await this.lockAccount(tx, actor);
      await this.verifySession(tx, actor);
      const row = (
        await tx.query<{
          id: string;
          status: OperationRow['status'];
          failure_code: unknown;
          dispatch_started_at: unknown;
          dispatch_fence_version: number;
          unexpired: boolean;
        }>(
          `SELECT id,status,failure_code,dispatch_started_at,dispatch_fence_version,expires_at>clock_timestamp() AS unexpired
         FROM platform_public_agent_operations WHERE platform_account_id=$1 AND school_id=$2 AND task=$3 AND id=$4 FOR UPDATE`,
          [actor.platformAccountId, schoolId, task, operationId],
        )
      ).rows[0];
      if (!row) return fail('PUBLIC_AGENT_OPERATION_NOT_FOUND', 404);
      if (row.dispatch_fence_version !== 1) return fail('PUBLIC_AGENT_STORE_INVALID', 503);
      if (
        row.status === 'failed' &&
        row.failure_code === 'NOT_DISPATCHED' &&
        row.dispatch_started_at === null
      )
        return { status: 'failed' as const, operationId };
      if (
        typeof row.unexpired !== 'boolean' ||
        row.dispatch_started_at !== null ||
        !(row.status === 'unknown' || (row.status === 'running' && !row.unexpired))
      )
        return fail('PUBLIC_AGENT_OUTCOME_UNKNOWN', 409);
      const changed = (
        await tx.query<{ id: string }>(
          `UPDATE platform_public_agent_operations
        SET status='failed',failure_code='NOT_DISPATCHED',result_json=NULL,updated_at=clock_timestamp()
        WHERE platform_account_id=$1 AND school_id=$2 AND task=$3 AND id=$4 AND acknowledged_at IS NULL
          AND dispatch_fence_version=1 AND dispatch_started_at IS NULL AND (status='unknown' OR (status='running' AND expires_at<=clock_timestamp())) RETURNING id`,
          [actor.platformAccountId, schoolId, task, operationId],
        )
      ).rows[0];
      if (!changed || changed.id !== operationId) return fail('PUBLIC_AGENT_OUTCOME_UNKNOWN', 409);
      return { status: 'failed' as const, operationId };
    });
  }

  async read(
    actor: PlatformTaskActor,
    lookup: { task: PublicTaskName; requestId: string; schoolId: string },
  ): Promise<PublicAgentOperation | null> {
    return this.readCurrent(actor, lookup);
  }
  async readBound(
    actor: PlatformTaskActor,
    rawBinding: TaskBinding,
  ): Promise<PublicAgentOperation | null> {
    const binding = bindingInput(rawBinding);
    return this.readCurrent(
      actor,
      { task: binding.task, requestId: binding.requestId, schoolId: binding.schoolId },
      binding,
    );
  }

  private async readCurrent(
    rawActor: PlatformTaskActor,
    rawLookup: { task: PublicTaskName; requestId: string; schoolId: string },
    rawBinding?: TaskBinding,
  ): Promise<PublicAgentOperation | null> {
    const actor = this.actorInput(rawActor),
      lookup = parseOperationLookup(rawLookup),
      binding = rawBinding === undefined ? undefined : bindingInput(rawBinding);
    return this.transaction(async (tx) => {
      await this.verifyActor(tx, actor);
      await this.lockAccount(tx, actor);
      await this.verifySession(tx, actor);
      const row = await this.operation(tx, actor, lookup.task, lookup.requestId);
      if (!row) return null;
      if (
        row.credential_id !== actor.credentialId ||
        row.session_hash !== actor.sessionHash ||
        row.school_id !== lookup.schoolId
      )
        return fail('PUBLIC_AGENT_REQUEST_CONFLICT', 409);
      if (binding) this.sameBinding(row, actor, binding);
      return this.state(tx, row);
    });
  }

  async complete(
    actor: PlatformTaskActor,
    binding: TaskBinding,
    operationId: string,
    executionToken: string,
    result: PublicAgentResult,
  ): Promise<PublicAgentOperation> {
    const approved = bindingInput(binding);
    return this.finalize(
      actor,
      approved,
      operationId,
      executionToken,
      'completed',
      resultInput(result, approved.task, approved.schoolId),
      null,
    );
  }

  async fail(
    actor: PlatformTaskActor,
    binding: TaskBinding,
    operationId: string,
    executionToken: string,
    code: PublicAgentFailureCode,
  ): Promise<PublicAgentOperation> {
    if (!failureCode(code) || code === 'NOT_DISPATCHED') return fail('PUBLIC_AGENT_INVALID_RESULT');
    return this.finalize(actor, binding, operationId, executionToken, 'failed', null, code);
  }

  async markUnknown(
    actor: PlatformTaskActor,
    binding: TaskBinding,
    operationId: string,
    executionToken: string,
  ): Promise<PublicAgentOperation> {
    return this.finalize(actor, binding, operationId, executionToken, 'unknown', null, null);
  }

  private async finalize(
    rawActor: PlatformTaskActor,
    rawBinding: TaskBinding,
    operationId: string,
    executionToken: string,
    status: 'completed' | 'failed' | 'unknown',
    result: PublicAgentResult | null,
    code: PublicAgentFailureCode | null,
  ): Promise<PublicAgentOperation> {
    const actor = this.actorInput(rawActor),
      binding = bindingInput(rawBinding);
    if (
      typeof operationId !== 'string' ||
      !/^pago_[a-f0-9-]{36}$/u.test(operationId) ||
      typeof executionToken !== 'string' ||
      !/^[A-Za-z0-9_-]{43}$/u.test(executionToken)
    )
      return fail('PUBLIC_AGENT_EXECUTION_LEASE_INVALID', 409);
    const tokenHash = createHash('sha256').update(executionToken).digest('hex');
    return this.transaction(async (tx) => {
      await this.verifyActor(tx, actor);
      await this.lockAccount(tx, actor);
      await this.verifySession(tx, actor);
      const row = await this.operation(tx, actor, binding.task, binding.requestId);
      if (!row || row.id !== operationId) return fail('PUBLIC_AGENT_OPERATION_NOT_FOUND', 404);
      this.sameBinding(row, actor, binding);
      if (
        typeof row.execution_token_hash !== 'string' ||
        !HASH.test(row.execution_token_hash) ||
        !timingSafeEqual(
          Buffer.from(tokenHash, 'hex'),
          Buffer.from(row.execution_token_hash, 'hex'),
        )
      )
        return fail('PUBLIC_AGENT_EXECUTION_LEASE_INVALID', 409);
      const current = await this.state(tx, row);
      if (current.status !== 'pending') return current;
      if (status !== 'unknown' && row.dispatch_started_at === null)
        return fail('PUBLIC_AGENT_DISPATCH_NOT_STARTED', 409);
      if (
        row.dispatch_started_at !== null &&
        !(row.dispatch_started_at instanceof Date) &&
        typeof row.dispatch_started_at !== 'string'
      )
        return fail('PUBLIC_AGENT_STORE_INVALID', 503);
      const changed = (
        await tx.query<{ id: string }>(
          `UPDATE platform_public_agent_operations
        SET status=$6,result_json=$7::jsonb,failure_code=$8,updated_at=clock_timestamp()
        WHERE id=$1 AND platform_account_id=$2 AND session_hash=$3 AND payload_hash=$4
          AND execution_token_hash=$5 AND status='running' AND expires_at>clock_timestamp()
          AND dispatch_fence_version=1 AND ($6='unknown' OR dispatch_started_at IS NOT NULL) RETURNING id`,
          [
            operationId,
            actor.platformAccountId,
            actor.sessionHash,
            binding.payloadHash,
            tokenHash,
            status,
            result === null ? null : JSON.stringify(result),
            code,
          ],
        )
      ).rows[0];
      if (!changed) {
        // The lease can expire between the locked read and this update. Persist unknown,
        // never roll it back into running or accept the late result as completion.
        const latest = await this.operation(tx, actor, binding.task, binding.requestId);
        if (!latest || latest.id !== operationId) return fail('PUBLIC_AGENT_CONFLICT', 409);
        const observed = await this.state(tx, latest);
        if (observed.status === 'pending') return fail('PUBLIC_AGENT_CONFLICT', 409);
        return observed;
      }
      if (changed.id !== operationId) return fail('PUBLIC_AGENT_CONFLICT', 409);
      return this.state(tx, { ...row, status, result_json: result, failure_code: code });
    });
  }
}

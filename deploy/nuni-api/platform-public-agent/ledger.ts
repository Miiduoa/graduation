import { randomUUID } from 'node:crypto';
import {
  exactRecord,
  parseOperationLookup,
  PublicAgentError,
  FREE_MODEL,
  FREE_PROVIDER,
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
export type PublicAgentOperation = {
  status: 'pending' | 'unknown';
  operationId: string;
  expiresAt: number;
};
export type PublicAgentClaim = Omit<PublicAgentOperation, 'status'> & {
  status: 'claimed' | 'pending' | 'unknown';
};
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
  status: 'running' | 'unknown';
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
    row.provider !== FREE_PROVIDER ||
    row.model !== FREE_MODEL
  )
    return fail('PUBLIC_AGENT_INVALID_INPUT');
  return Object.freeze({
    task: row.task,
    requestId: row.requestId as string,
    schoolId: row.schoolId as string,
    payloadHash: row.payloadHash,
    provider: FREE_PROVIDER,
    model: FREE_MODEL,
  });
}

/** Admission only: no provider execution, result storage or completion claim. */
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
  private async state(tx: PublicAgentSql, row: OperationRow): Promise<PublicAgentOperation> {
    if (row.status !== 'running' && row.status !== 'unknown')
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
    return {
      status: row.status === 'unknown' ? 'unknown' : 'pending',
      operationId: row.id,
      expiresAt: expiry(row.expires_at),
    };
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
        if (existing.unexpired !== true) return fail('PUBLIC_AGENT_CONFIRMATION_EXPIRED', 409);
        return { confirmationId: existing.id, expiresAt: expiry(existing.expires_at) };
      }
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
      const row = (
        await tx.query<{ id: string; expires_at: Date | string }>(
          `INSERT INTO platform_public_agent_operations
        (id,platform_account_id,credential_id,session_hash,task,request_id,school_id,payload_hash,provider,model,confirmation_id,status,expires_at)
        SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'running',
          LEAST($12::timestamptz,$13::timestamptz,clock_timestamp()+($14::double precision*interval '1 millisecond'))
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
          ],
        )
      ).rows[0];
      if (!row) return fail('PUBLIC_AGENT_ADMISSION_EXPIRED', 409);
      if (row.id !== operationId) return fail('PUBLIC_AGENT_STORE_INVALID', 503);
      return { status: 'claimed', operationId: row.id, expiresAt: expiry(row.expires_at) };
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

  async read(
    rawActor: PlatformTaskActor,
    rawLookup: { task: PublicTaskName; requestId: string; schoolId: string },
  ): Promise<PublicAgentOperation | null> {
    const actor = this.actorInput(rawActor),
      lookup = parseOperationLookup(rawLookup);
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
      return this.state(tx, row);
    });
  }

  /** Internal failure acknowledgement. It cannot grant a claim or mark an operation completed. */
  async markUnknown(
    rawActor: PlatformTaskActor,
    rawBinding: TaskBinding,
    operationId: string,
  ): Promise<PublicAgentOperation> {
    const actor = this.actorInput(rawActor),
      binding = bindingInput(rawBinding);
    if (typeof operationId !== 'string' || !/^pago_[a-f0-9-]{36}$/u.test(operationId))
      return fail('PUBLIC_AGENT_INVALID_INPUT');
    return this.transaction(async (tx) => {
      await this.verifyActor(tx, actor);
      await this.lockAccount(tx, actor);
      await this.verifySession(tx, actor);
      const row = await this.operation(tx, actor, binding.task, binding.requestId);
      if (!row || row.id !== operationId) return fail('PUBLIC_AGENT_OPERATION_NOT_FOUND', 404);
      this.sameBinding(row, actor, binding);
      if (row.status === 'unknown') return this.state(tx, row);
      if (row.status !== 'running') return fail('PUBLIC_AGENT_STORE_INVALID', 503);
      const changed = (
        await tx.query<{ id: string }>(
          `UPDATE platform_public_agent_operations SET status='unknown',updated_at=clock_timestamp()
        WHERE id=$1 AND platform_account_id=$2 AND session_hash=$3 AND payload_hash=$4 AND status='running' RETURNING id`,
          [operationId, actor.platformAccountId, actor.sessionHash, binding.payloadHash],
        )
      ).rows[0];
      if (!changed || changed.id !== operationId) return fail('PUBLIC_AGENT_CONFLICT', 409);
      return { status: 'unknown', operationId, expiresAt: expiry(row.expires_at) };
    });
  }
}

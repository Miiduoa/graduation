import { createHash } from 'node:crypto';
import { validatePersonalImportSyncRecords } from './imports/sync';
import type { PersonalImportRecord } from './imports/types';

export type ImportSyncActor = {
  platformAccountId: string;
  credentialId: string;
  expiresAt: number;
  /** Derived from the already validated Platform session, never accepted from JSON. */
  sessionHash: string;
};
export interface ImportSyncSql {
  query<Row = Record<string, unknown>>(sql: string, parameters?: unknown[]): Promise<{ rows: Row[] }>;
}
export interface ImportSyncDatabase {
  transaction<T>(run: (tx: ImportSyncSql) => Promise<T>): Promise<T>;
}
export class PersonalImportSyncError extends Error {
  constructor(public readonly code: string, public readonly statusCode = 422) { super(code); }
}
export type PersonalImportSnapshot = {
  schoolId: string;
  revision: number;
  records: PersonalImportRecord[];
  updatedAt: string | null;
  /** Row IDs whose reference no longer points to a currently accessible class. */
  detachedCourseLinks: string[];
};
type Ledger = { school_id: string; revision: number; records: PersonalImportRecord[]; updated_at: Date | string };
const fail = (code = 'PERSONAL_IMPORT_INVALID_INPUT', statusCode = 422): never => {
  throw new PersonalImportSyncError(code, statusCode);
};
function record(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return fail();
  const result: Record<string, unknown> = Object.create(null);
  for (const name of Reflect.ownKeys(value)) {
    if (typeof name !== 'string' || !allowed.includes(name)) return fail();
    const descriptor = Object.getOwnPropertyDescriptor(value, name)!;
    if (!('value' in descriptor)) return fail();
    result[name] = descriptor.value;
  }
  if (allowed.some(name => !(name in result))) return fail();
  return result;
}
function school(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9-]{0,79}$/u.test(value) || value === 'personal') return fail();
  return value;
}
function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, sorted(item)]));
  return value;
}
function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(sorted(value))).digest('hex');
}

/** Account isolation is taken only from a validated Platform session. No school verification is implied. */
export class PersonalImportSyncService {
  constructor(private readonly db: ImportSyncDatabase) {}

  private async actor(tx: ImportSyncSql, actor: ImportSyncActor) {
    if (!Number.isFinite(actor.expiresAt) || actor.expiresAt <= Date.now() || !/^[0-9a-f]{64}$/u.test(actor.sessionHash))
      return fail('PERSONAL_IMPORT_SESSION_EXPIRED', 401);
    // Lock in the same order as account closure, then hold the session against a concurrent logout.
    const account = await tx.query(`SELECT id FROM platform_accounts WHERE id=$1 AND state='active' FOR SHARE`, [actor.platformAccountId]);
    if (!account.rows.length) return fail('PERSONAL_IMPORT_SESSION_EXPIRED', 401);
    const credential = await tx.query(`SELECT id FROM platform_account_credentials
      WHERE id=$1 AND platform_account_id=$2 AND state='active' FOR SHARE`, [actor.credentialId, actor.platformAccountId]);
    if (!credential.rows.length) return fail('PERSONAL_IMPORT_SESSION_EXPIRED', 401);
    const session = await tx.query(`SELECT token_sha256 FROM platform_account_sessions
      WHERE token_sha256=$1 AND platform_account_id=$2 AND credential_id=$3 AND expires_at>now() FOR SHARE`,
    [actor.sessionHash, actor.platformAccountId, actor.credentialId]);
    if (!session.rows.length) return fail('PERSONAL_IMPORT_SESSION_EXPIRED', 401);
  }

  private async accessibleLinks(tx: ImportSyncSql, actor: ImportSyncActor, schoolId: string, records: PersonalImportRecord[]) {
    const ids = [...new Set(records.flatMap(item => item.linkedCourseId ? [item.linkedCourseId] : []))];
    if (!ids.length) return { records, detachedCourseLinks: [] as string[] };
    const access = await tx.query<{ id: string }>(`SELECT w.id FROM class_workspaces w
      JOIN class_workspace_members m ON m.workspace_id=w.id AND m.platform_account_id=$1 AND m.state='active'
      WHERE w.id=ANY($2::text[]) AND w.state='active'
        AND NOT EXISTS (SELECT 1 FROM class_workspace_affiliations a
          WHERE a.workspace_id=w.id AND (a.state<>'active' OR a.tenant_id<>$3))
      FOR SHARE OF w,m`, [actor.platformAccountId, ids, schoolId]);
    const permitted = new Set(access.rows.map(item => item.id));
    const detachedCourseLinks: string[] = [];
    const normalized = records.map(item => {
      if (!item.linkedCourseId || permitted.has(item.linkedCourseId)) return item;
      detachedCourseLinks.push(item.id);
      const { linkedCourseId: _reference, ...personalData } = item;
      return personalData;
    });
    return { records: normalized, detachedCourseLinks };
  }

  private async snapshot(tx: ImportSyncSql, actor: ImportSyncActor, schoolId: string): Promise<PersonalImportSnapshot> {
    const ledger = (await tx.query<Ledger>(`SELECT school_id,revision,records,updated_at FROM personal_import_ledgers
      WHERE platform_account_id=$1 AND school_id=$2`, [actor.platformAccountId, schoolId])).rows[0];
    if (!ledger) return { schoolId, revision: 0, records: [], updatedAt: null, detachedCourseLinks: [] };
    return { schoolId, revision: ledger.revision, updatedAt: new Date(ledger.updated_at).toISOString(),
      ...await this.accessibleLinks(tx, actor, schoolId, ledger.records) };
  }

  async read(actor: ImportSyncActor, raw: unknown): Promise<PersonalImportSnapshot> {
    const input = record(raw, ['schoolId']), schoolId = school(input.schoolId);
    return this.db.transaction(async tx => {
      await this.actor(tx, actor);
      return this.snapshot(tx, actor, schoolId);
    });
  }

  async write(actor: ImportSyncActor, raw: unknown): Promise<PersonalImportSnapshot> {
    const input = record(raw, ['schoolId', 'expectedRevision', 'records', 'mutationId']);
    const schoolId = school(input.schoolId), revision = input.expectedRevision, mutationId = input.mutationId;
    if (!Number.isSafeInteger(revision) || (revision as number) < 0 || (revision as number) >= 2_147_483_647 ||
      typeof mutationId !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/u.test(mutationId)) return fail();
    let records: PersonalImportRecord[];
    try { records = validatePersonalImportSyncRecords(input.records, schoolId); }
    catch { return fail(); }
    const requestHash = fingerprint({ schoolId, expectedRevision: revision, records });
    return this.db.transaction(async tx => {
      await this.actor(tx, actor);
      // One account lock also makes the bounded-school quota and mutation pruning race-safe.
      await tx.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [`personal-import:${actor.platformAccountId}`]);
      const replay = (await tx.query<{ request_hash: string }>(`SELECT request_hash FROM personal_import_mutations
        WHERE platform_account_id=$1 AND school_id=$2 AND mutation_id=$3`, [actor.platformAccountId, schoolId, mutationId])).rows[0];
      if (replay) {
        if (replay.request_hash !== requestHash) return fail('PERSONAL_IMPORT_MUTATION_CONFLICT', 409);
        // Return current state, never restore a historical snapshot on a delayed retry.
        return this.snapshot(tx, actor, schoolId);
      }
      const existing = (await tx.query<{ revision: number }>(`SELECT revision FROM personal_import_ledgers
        WHERE platform_account_id=$1 AND school_id=$2 FOR UPDATE`, [actor.platformAccountId, schoolId])).rows[0];
      if ((existing?.revision ?? 0) !== revision) return fail('PERSONAL_IMPORT_REVISION_CONFLICT', 409);
      if (!existing) {
        const count = (await tx.query<{ count: number }>(`SELECT count(*)::int AS count FROM personal_import_ledgers
          WHERE platform_account_id=$1`, [actor.platformAccountId])).rows[0]?.count ?? 0;
        if (count >= 20) return fail('PERSONAL_IMPORT_SCHOOL_LIMIT', 429);
      }
      const normalized = await this.accessibleLinks(tx, actor, schoolId, records);
      await tx.query(`INSERT INTO personal_import_ledgers (platform_account_id,school_id,revision,records)
        VALUES ($1,$2,$3,$4::jsonb) ON CONFLICT (platform_account_id,school_id) DO UPDATE
        SET revision=EXCLUDED.revision,records=EXCLUDED.records,updated_at=now()`,
      [actor.platformAccountId, schoolId, (revision as number) + 1, JSON.stringify(normalized.records)]);
      await tx.query(`INSERT INTO personal_import_mutations (platform_account_id,school_id,mutation_id,request_hash)
        VALUES ($1,$2,$3,$4)`, [actor.platformAccountId, schoolId, mutationId, requestHash]);
      // Only hashes and mutation keys are retained. A pruned old request still fails its revision check.
      await tx.query(`DELETE FROM personal_import_mutations WHERE platform_account_id=$1 AND school_id=$2
        AND mutation_id IN (SELECT mutation_id FROM personal_import_mutations
          WHERE platform_account_id=$1 AND school_id=$2 ORDER BY created_at DESC,mutation_id DESC OFFSET 100)`,
      [actor.platformAccountId, schoolId]);
      const result = await this.snapshot(tx, actor, schoolId);
      return { ...result, detachedCourseLinks: [...new Set([...normalized.detachedCourseLinks, ...result.detachedCourseLinks])] };
    });
  }
}

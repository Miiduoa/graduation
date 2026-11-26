import { createHash } from 'node:crypto';
import {
  NUNI_LOST_FOUND_PAGE_LIMIT,
  parseNuniLostFoundResponse,
  validateNuniLostFoundRequest,
  type NuniLostFoundCreateInput,
  type NuniLostFoundItem,
  type NuniLostFoundListInput,
  type NuniLostFoundMutationInput,
  type NuniLostFoundRequests,
  type NuniLostFoundResponses,
  type NuniLostFoundUpdateInput,
} from './contracts';

export type LostFoundActor = {
  platformAccountId: string;
  credentialId: string;
  expiresAt: number;
  /** Computed from the resolved Platform authorization, never accepted from a request body. */
  sessionHash: string;
};
export interface LostFoundSql {
  query<Row = Record<string, unknown>>(sql: string, parameters?: readonly unknown[]): Promise<{ rows: Row[] }>;
}
export interface LostFoundDatabase {
  transaction<T>(work: (tx: LostFoundSql) => Promise<T>): Promise<T>;
}
export class PlatformLostFoundError extends Error {
  constructor(public readonly code: string, public readonly statusCode: number) { super(code); }
}
type Mutation = 'create' | 'update' | 'resolve' | 'remove';
type ItemRow = {
  id: string; platform_account_id: string; school_id: string;
  state: 'open' | 'resolved' | 'removed'; version: number;
  item_type: 'lost' | 'found' | null; title: string | null; description: string | null;
  category: string | null; location: string | null; item_date: string | null; contact_info: string | null;
  created_at: Date | string; updated_at: Date | string; resolved_at: Date | string | null;
};
type ReplayRow = { item_id: string; action: Mutation; request_hash: string; receipt_version: number };
type PagePosition = { createdAt: string; id: string };
const columns = `i.id,i.platform_account_id,i.school_id,i.state,i.version,i.item_type,i.title,i.description,
  i.category,i.location,i.item_date::text AS item_date,i.contact_info,i.created_at,i.updated_at,i.resolved_at`;
const fail = (code: string, status: number): never => { throw new PlatformLostFoundError(code, status); };
const iso = (value: Date | string) => new Date(value).toISOString();
const fingerprint = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function projection(row: ItemRow, actor: LostFoundActor, contact: boolean): NuniLostFoundItem {
  if (row.state === 'removed') return fail('LOST_FOUND_REMOVED', 410);
  return {
    id: row.id, schoolId: row.school_id, type: row.item_type!, title: row.title!,
    description: row.description!, category: row.category!, location: row.location!, date: row.item_date!,
    status: row.state, version: row.version, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
    resolvedAt: row.resolved_at === null ? null : iso(row.resolved_at),
    isOwner: row.platform_account_id === actor.platformAccountId,
    ...(contact ? { contactInfo: row.contact_info ?? '' } : {}),
  };
}

/** The PostgreSQL owner comes only from the verified platform session. No campus persona is created. */
export class PlatformLostFoundService {
  constructor(private readonly db: LostFoundDatabase) {}

  private async actor(tx: LostFoundSql, actor: LostFoundActor) {
    if (!Number.isFinite(actor.expiresAt) || actor.expiresAt <= Date.now() ||
      actor.sessionHash.length !== 64 || !/^[0-9a-f]{64}$/.test(actor.sessionHash)) return fail('LOST_FOUND_SESSION_EXPIRED', 401);
    // Match closure/revocation lock order and hold the session against a concurrent logout.
    const account = await tx.query(`SELECT id FROM platform_accounts WHERE id=$1 AND state='active' FOR SHARE`, [actor.platformAccountId]);
    if (!account.rows.length) return fail('LOST_FOUND_SESSION_EXPIRED', 401);
    const credential = await tx.query(`SELECT id FROM platform_account_credentials
      WHERE id=$1 AND platform_account_id=$2 AND state='active' FOR SHARE`, [actor.credentialId, actor.platformAccountId]);
    if (!credential.rows.length) return fail('LOST_FOUND_SESSION_EXPIRED', 401);
    const session = await tx.query(`SELECT token_sha256 FROM platform_account_sessions
      WHERE token_sha256=$1 AND platform_account_id=$2 AND credential_id=$3 AND expires_at>clock_timestamp() FOR SHARE`,
    [actor.sessionHash, actor.platformAccountId, actor.credentialId]);
    if (!session.rows.length) return fail('LOST_FOUND_SESSION_EXPIRED', 401);
  }

  private pageScope(actor: LostFoundActor, input: NuniLostFoundListInput, ownExport: boolean) {
    return fingerprint({ account: actor.platformAccountId, school: input.schoolId, export: ownExport,
      mine: ownExport || input.mine === true, q: input.q ?? '', type: input.type ?? '', category: input.category ?? '',
      status: ownExport ? 'all' : input.status ?? (input.mine ? 'all' : 'open') });
  }

  private position(raw: string | undefined, scope: string): PagePosition | null {
    if (raw === undefined) return null;
    try {
      const buffer = Buffer.from(raw, 'base64url');
      if (buffer.toString('base64url') !== raw) return fail('LOST_FOUND_INVALID_CURSOR', 422);
      const value = JSON.parse(buffer.toString('utf8')) as Record<string, unknown>;
      if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 3 ||
        value.scope !== scope || typeof value.createdAt !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.createdAt) ||
        iso(value.createdAt) !== value.createdAt || typeof value.id !== 'string' || value.id.length !== 40 ||
        !/^plf_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value.id))
        return fail('LOST_FOUND_INVALID_CURSOR', 422);
      return { createdAt: value.createdAt, id: value.id };
    } catch { return fail('LOST_FOUND_INVALID_CURSOR', 422); }
  }

  private async page(action: 'list' | 'export', actor: LostFoundActor, raw: unknown) {
    const input = validateNuniLostFoundRequest(action, raw) as NuniLostFoundListInput;
    const ownExport = action === 'export', mine = ownExport || input.mine === true;
    const status = ownExport ? 'all' : input.status ?? (mine ? 'all' : 'open');
    const scope = this.pageScope(actor, input, ownExport), position = this.position(input.cursor, scope);
    const limit = input.limit ?? NUNI_LOST_FOUND_PAGE_LIMIT;
    return this.db.transaction(async tx => {
      await this.actor(tx, actor);
      const rows = (await tx.query<ItemRow>(`SELECT ${columns} FROM platform_lost_found_items i
        JOIN platform_accounts a ON a.id=i.platform_account_id AND a.state='active'
        WHERE i.school_id=$1 AND i.state<>'removed' AND ($2::boolean=false OR i.platform_account_id=$3)
          AND ($4::text='all' OR i.state=$4) AND ($5::text='' OR i.item_type=$5)
          AND ($6::text='' OR i.category=$6)
          AND ($7::text='' OR position(lower($7) in lower(i.title || ' ' || i.description || ' ' || i.location))>0)
          AND ($8::timestamptz IS NULL OR (i.created_at,i.id)<($8::timestamptz,$9::text))
        ORDER BY i.created_at DESC,i.id DESC LIMIT $10`,
      [input.schoolId, mine, actor.platformAccountId, status, input.type ?? '', input.category ?? '', input.q ?? '',
        position?.createdAt ?? null, position?.id ?? null, limit + 1])).rows;
      const visible = rows.slice(0, limit), last = visible.at(-1);
      const nextCursor = rows.length > limit && last ? Buffer.from(JSON.stringify({ scope, createdAt: iso(last.created_at), id: last.id })).toString('base64url') : null;
      return parseNuniLostFoundResponse(action, { schoolId: input.schoolId,
        items: visible.map(row => projection(row, actor, ownExport)), nextCursor }, input);
    });
  }

  list(actor: LostFoundActor, raw: unknown) { return this.page('list', actor, raw); }
  export(actor: LostFoundActor, raw: unknown) { return this.page('export', actor, raw); }

  async get(actor: LostFoundActor, raw: unknown) {
    const input = validateNuniLostFoundRequest('get', raw);
    return this.db.transaction(async tx => {
      await this.actor(tx, actor);
      const row = (await tx.query<ItemRow>(`SELECT ${columns} FROM platform_lost_found_items i
        JOIN platform_accounts a ON a.id=i.platform_account_id AND a.state='active'
        WHERE i.id=$1 AND i.school_id=$2`, [input.id, input.schoolId])).rows[0];
      if (!row || (row.state === 'removed' && row.platform_account_id !== actor.platformAccountId))
        return fail('LOST_FOUND_NOT_FOUND', 404);
      return parseNuniLostFoundResponse('get', { item: projection(row, actor, true) }, input);
    });
  }

  private async limits(tx: LostFoundSql, account: string, creating: boolean) {
    const recent = (await tx.query<{ count: number }>(`SELECT count(*)::int AS count FROM platform_lost_found_mutations
      WHERE platform_account_id=$1 AND created_at>clock_timestamp()-interval '1 minute'`, [account])).rows[0]?.count ?? 0;
    if (recent >= 20) return fail('LOST_FOUND_RATE_LIMIT', 429);
    if (!creating) return;
    const counts = (await tx.query<{ active: number; total: number; daily: number }>(`SELECT count(*)::int AS total,
      count(*) FILTER (WHERE state<>'removed')::int AS active,
      count(*) FILTER (WHERE created_at>clock_timestamp()-interval '1 day')::int AS daily
      FROM platform_lost_found_items WHERE platform_account_id=$1`, [account])).rows[0]!;
    if (counts.daily >= 50) return fail('LOST_FOUND_RATE_LIMIT', 429);
    // Tombstones preserve item IDs so a delayed create cannot resurrect a removed notice.
    if (counts.active >= 200 || counts.total >= 5000) return fail('LOST_FOUND_ITEM_LIMIT', 429);
  }

  private receipt<A extends Mutation>(action: A, row: ItemRow, actor: LostFoundActor, input: NuniLostFoundRequests[A]): NuniLostFoundResponses[A] {
    if (action === 'remove' && row.state !== 'removed') return fail('LOST_FOUND_REPLAY_CHANGED', 409);
    return parseNuniLostFoundResponse(action,
      action === 'remove' ? { removed: true, id: row.id, schoolId: row.school_id }
        : { item: projection(row, actor, true) }, input);
  }

  private async mutate<A extends Mutation>(action: A, actor: LostFoundActor, raw: unknown): Promise<NuniLostFoundResponses[A]> {
    const input = validateNuniLostFoundRequest(action, raw);
    const { mutationId, ...intent } = input;
    const hash = fingerprint({ action, ...intent });
    return this.db.transaction(async tx => {
      await this.actor(tx, actor);
      await tx.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [`platform-lost-found:${actor.platformAccountId}`]);
      // Time-based expiry may pass while another mutation holds the account's advisory lock.
      await this.actor(tx, actor);
      const replay = (await tx.query<ReplayRow>(`SELECT item_id,action,request_hash,receipt_version FROM platform_lost_found_mutations
        WHERE platform_account_id=$1 AND mutation_id=$2`, [actor.platformAccountId, mutationId])).rows[0];
      const row = (await tx.query<ItemRow>(`SELECT ${columns} FROM platform_lost_found_items i WHERE i.id=$1 FOR UPDATE`, [input.id])).rows[0];
      if (replay) {
        if (replay.action !== action || replay.item_id !== input.id || replay.request_hash !== hash)
          return fail('LOST_FOUND_MUTATION_CONFLICT', 409);
        if (!row || row.platform_account_id !== actor.platformAccountId || row.school_id !== input.schoolId)
          return fail('LOST_FOUND_NOT_FOUND', 404);
        if (row.state === 'removed' && action !== 'remove') return fail('LOST_FOUND_REMOVED', 410);
        if (row.version !== replay.receipt_version) return fail('LOST_FOUND_REPLAY_CHANGED', 409);
        return this.receipt(action, row, actor, input);
      }
      if (row && (row.platform_account_id !== actor.platformAccountId || row.school_id !== input.schoolId))
        return fail('LOST_FOUND_NOT_FOUND', 404);
      if (row?.state === 'removed') {
        if (action === 'remove') return this.receipt(action, row, actor, input);
        return fail('LOST_FOUND_REMOVED', 410);
      }
      let saved: ItemRow;
      if (action === 'create') {
        if (row) return fail('LOST_FOUND_MUTATION_CONFLICT', 409);
        await this.limits(tx, actor.platformAccountId, true);
        const fields = (input as NuniLostFoundCreateInput).fields;
        saved = (await tx.query<ItemRow>(`INSERT INTO platform_lost_found_items AS i
          (id,platform_account_id,school_id,state,version,item_type,title,description,category,location,item_date,contact_info)
          VALUES ($1,$2,$3,'open',1,$4,$5,$6,$7,$8,$9::date,$10) RETURNING ${columns}`,
        [input.id, actor.platformAccountId, input.schoolId, fields.type, fields.title, fields.description,
          fields.category, fields.location, fields.date, fields.contactInfo ?? ''])).rows[0]!;
      } else {
        if (!row) return fail('LOST_FOUND_NOT_FOUND', 404);
        if (row.version !== (input as NuniLostFoundMutationInput).expectedVersion) return fail('LOST_FOUND_VERSION_CONFLICT', 409);
        if (row.state !== 'open' && action !== 'remove') return fail('LOST_FOUND_CLOSED', 409);
        await this.limits(tx, actor.platformAccountId, false);
        if (action === 'update') {
          const fields = (input as NuniLostFoundUpdateInput).fields;
          saved = (await tx.query<ItemRow>(`UPDATE platform_lost_found_items AS i
            SET item_type=$2,title=$3,description=$4,category=$5,location=$6,item_date=$7::date,contact_info=$8,
              version=version+1,updated_at=date_trunc('milliseconds',clock_timestamp()) WHERE id=$1 RETURNING ${columns}`,
          [input.id, fields.type, fields.title, fields.description, fields.category, fields.location, fields.date,
            fields.contactInfo ?? row.contact_info ?? ''])).rows[0]!;
        } else if (action === 'resolve') {
          saved = (await tx.query<ItemRow>(`UPDATE platform_lost_found_items AS i SET state='resolved',contact_info='',version=version+1,
            updated_at=date_trunc('milliseconds',clock_timestamp()),resolved_at=date_trunc('milliseconds',clock_timestamp())
            WHERE id=$1 RETURNING ${columns}`, [input.id])).rows[0]!;
        } else {
          saved = (await tx.query<ItemRow>(`UPDATE platform_lost_found_items AS i SET state='removed',version=version+1,
            item_type=NULL,title=NULL,description=NULL,category=NULL,location=NULL,item_date=NULL,contact_info=NULL,resolved_at=NULL,
            updated_at=date_trunc('milliseconds',clock_timestamp()) WHERE id=$1 RETURNING ${columns}`, [input.id])).rows[0]!;
        }
      }
      await tx.query(`INSERT INTO platform_lost_found_mutations
        (platform_account_id,mutation_id,item_id,action,request_hash,receipt_version) VALUES ($1,$2,$3,$4,$5,$6)`,
      [actor.platformAccountId, mutationId, input.id, action, hash, saved.version]);
      // An expired receipt never recreates an item: its stable ID/tombstone and version still reject stale writes.
      await tx.query(`DELETE FROM platform_lost_found_mutations WHERE platform_account_id=$1 AND mutation_id IN
        (SELECT mutation_id FROM platform_lost_found_mutations WHERE platform_account_id=$1
          ORDER BY created_at DESC,mutation_id DESC OFFSET 1000)`, [actor.platformAccountId]);
      return this.receipt(action, saved, actor, input);
    });
  }

  create(actor: LostFoundActor, raw: unknown) { return this.mutate('create', actor, raw); }
  update(actor: LostFoundActor, raw: unknown) { return this.mutate('update', actor, raw); }
  resolve(actor: LostFoundActor, raw: unknown) { return this.mutate('resolve', actor, raw); }
  remove(actor: LostFoundActor, raw: unknown) { return this.mutate('remove', actor, raw); }
}

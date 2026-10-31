import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { NuniError } from '@campus/shared/src/nuni';
import type { AssignmentFileKind } from '@campus/shared/src/assignmentFiles';

export const MEMORY_BLOB_TTL_MS = 2 * 60 * 60 * 1000;
export const ASSIGNMENT_FILE_BUCKET = 'assignment-submissions';

export type FileRecord = {
  id: string;
  workspaceId: string;
  assignmentId: string;
  platformAccountId: string;
  originalName: string;
  contentType: string;
  byteSize: number;
  sha256: string;
  kind: AssignmentFileKind;
  storageKey: string;
  createdAt: string;
  uploadedAt: string | null;
  submittedAt: string | null;
  supersededAt: string | null;
  late: boolean;
};

export type IdempotencyRow = { hash: string; payload: unknown };

export type AssignmentFileIndexStore = {
  countWithdrawn(assignmentId: string): Promise<number>;
  isWithdrawn(assignmentId: string, accountId: string, submittedAt: string): Promise<boolean>;
  withdraw(assignmentId: string, accountId: string, submittedAt: string): Promise<void>;
  getFile(id: string): Promise<FileRecord | null>;
  putFile(record: FileRecord, version?: string): Promise<void>;
  advanceVersion(assignmentId: string, accountId: string, version: string): Promise<void>;
  currentVersion(assignmentId: string, accountId: string): Promise<string | null>;
  listVisible(assignmentId: string, accountId: string): Promise<FileRecord[]>;
  listStaged(assignmentId: string, accountId: string): Promise<FileRecord[]>;
  getIdempotency(actorId: string, key: string): Promise<IdempotencyRow | null>;
  putIdempotency(actorId: string, key: string, row: IdempotencyRow): Promise<void>;
};

export type AssignmentBlobStore = {
  put(storageKey: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(storageKey: string): Promise<Uint8Array | null>;
};

export type AssignmentFileRuntimeStores = {
  index: AssignmentFileIndexStore;
  blobs: AssignmentBlobStore;
};

export type SqlQuery = (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;

const FILE_COLUMNS = `id, workspace_id, assignment_id, platform_account_id, original_name, content_type,
  byte_size, sha256, kind, storage_key, created_at, uploaded_at, submitted_at, superseded_at, late`;

export const ASSIGNMENT_FILE_SQL = {
  countWithdrawn: `SELECT count(*)::int AS count FROM class_assignment_submission_withdrawals withdrawal
    JOIN class_workspace_assignment_submissions submission
    ON submission.assignment_id = withdrawal.assignment_id AND submission.platform_account_id = withdrawal.platform_account_id
    AND date_trunc('milliseconds', submission.submitted_at) = withdrawal.submitted_at WHERE withdrawal.assignment_id = $1`,
  isWithdrawn: `SELECT 1 FROM class_assignment_submission_withdrawals
    WHERE assignment_id = $1 AND platform_account_id = $2 AND submitted_at = $3::timestamptz`,
  withdraw: `INSERT INTO class_assignment_submission_withdrawals (assignment_id, platform_account_id, submitted_at)
    VALUES ($1, $2, $3::timestamptz) ON CONFLICT DO NOTHING`,
  advanceVersion: `INSERT INTO class_assignment_file_idempotency (actor_id, key, request_hash, payload)
    VALUES ($1, $2, $3, to_jsonb($3::text)) ON CONFLICT (actor_id, key) DO UPDATE
    SET request_hash = EXCLUDED.request_hash, payload = EXCLUDED.payload
    WHERE class_assignment_file_idempotency.request_hash::timestamptz < EXCLUDED.request_hash::timestamptz`,
  getFile: `SELECT ${FILE_COLUMNS} FROM class_assignment_submission_files WHERE id = $1`,
  upsertFile: `INSERT INTO class_assignment_submission_files (
      id, workspace_id, assignment_id, platform_account_id, original_name, content_type,
      byte_size, sha256, kind, storage_key, created_at, uploaded_at, submitted_at, superseded_at, late
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
    ON CONFLICT (id) DO UPDATE SET
      sha256 = EXCLUDED.sha256,
      uploaded_at = EXCLUDED.uploaded_at,
      submitted_at = EXCLUDED.submitted_at,
      superseded_at = EXCLUDED.superseded_at,
      late = EXCLUDED.late`,
  listVisible: `SELECT ${FILE_COLUMNS} FROM class_assignment_submission_files
    WHERE assignment_id = $1 AND platform_account_id = $2
      AND submitted_at IS NOT NULL AND superseded_at IS NULL`,
  listStaged: `SELECT ${FILE_COLUMNS} FROM class_assignment_submission_files
    WHERE assignment_id = $1 AND platform_account_id = $2
      AND submitted_at IS NULL AND superseded_at IS NULL`,
  getIdempotency: `SELECT request_hash, payload FROM class_assignment_file_idempotency
    WHERE actor_id = $1 AND key = $2`,
  putIdempotency: `INSERT INTO class_assignment_file_idempotency (actor_id, key, request_hash, payload)
    VALUES ($1, $2, $3, $4::jsonb)
    ON CONFLICT (actor_id, key) DO NOTHING`,
} as const;

function cloneFile(record: FileRecord): FileRecord {
  return { ...record };
}

function iso(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const text = String(value);
  return text || null;
}

function fileFromRow(row: Record<string, unknown>): FileRecord {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    assignmentId: String(row.assignment_id),
    platformAccountId: String(row.platform_account_id),
    originalName: String(row.original_name),
    contentType: String(row.content_type),
    byteSize: Number(row.byte_size),
    sha256: String(row.sha256 ?? ''),
    kind: row.kind === 'file' ? 'file' : 'image',
    storageKey: String(row.storage_key),
    createdAt: iso(row.created_at) ?? new Date(0).toISOString(),
    uploadedAt: iso(row.uploaded_at),
    submittedAt: iso(row.submitted_at),
    supersededAt: iso(row.superseded_at),
    late: row.late === true,
  };
}

function unavailable(
  code: 'ASSIGNMENT_FILE_STORE_UNAVAILABLE' | 'ASSIGNMENT_FILE_UPLOAD_UNAVAILABLE',
) {
  return async () => {
    throw new NuniError(503, code);
  };
}

export function createMemoryIndexStore(): AssignmentFileIndexStore {
  const files = new Map<string, FileRecord>();
  const versions = new Map<string, string>();
  const withdrawals = new Set<string>();
  const idempotency = new Map<string, IdempotencyRow>();
  return {
    async countWithdrawn(assignmentId) {
      return [...withdrawals].filter((key) => JSON.parse(key)[0] === assignmentId).length;
    },
    async isWithdrawn(assignmentId, accountId, submittedAt) {
      return withdrawals.has(
        JSON.stringify([assignmentId, accountId, new Date(submittedAt).toISOString()]),
      );
    },
    async withdraw(assignmentId, accountId, submittedAt) {
      withdrawals.add(
        JSON.stringify([assignmentId, accountId, new Date(submittedAt).toISOString()]),
      );
    },
    async getFile(id) {
      const row = files.get(id);
      return row ? cloneFile(row) : null;
    },
    async advanceVersion(assignmentId, accountId, version) {
      const key = `${assignmentId}:${accountId}`;
      if (!versions.has(key) || Date.parse(versions.get(key)!) < Date.parse(version))
        versions.set(key, version);
    },
    async currentVersion(assignmentId, accountId) {
      return versions.get(`${assignmentId}:${accountId}`) ?? null;
    },
    async putFile(record, version) {
      if (
        version &&
        Date.parse(versions.get(`${record.assignmentId}:${record.platformAccountId}`) ?? version) >
          Date.parse(version)
      )
        throw new NuniError(409, 'ASSIGNMENT_SUBMISSION_SUPERSEDED');
      files.set(record.id, cloneFile(record));
    },
    async listVisible(assignmentId, accountId) {
      return [...files.values()]
        .filter(
          (file) =>
            file.assignmentId === assignmentId &&
            file.platformAccountId === accountId &&
            file.submittedAt &&
            !file.supersededAt,
        )
        .map(cloneFile);
    },
    async listStaged(assignmentId, accountId) {
      return [...files.values()]
        .filter(
          (file) =>
            file.assignmentId === assignmentId &&
            file.platformAccountId === accountId &&
            !file.submittedAt &&
            !file.supersededAt,
        )
        .map(cloneFile);
    },
    async getIdempotency(actorId, key) {
      const row = idempotency.get(`${actorId}:${key}`);
      return row ? { hash: row.hash, payload: row.payload } : null;
    },
    async putIdempotency(actorId, key, row) {
      const id = `${actorId}:${key}`;
      if (!idempotency.has(id)) idempotency.set(id, { hash: row.hash, payload: row.payload });
    },
  };
}

export function createSqlIndexStore(query: SqlQuery): AssignmentFileIndexStore {
  return {
    async countWithdrawn(assignmentId) {
      return Number(
        (await query(ASSIGNMENT_FILE_SQL.countWithdrawn, [assignmentId]))[0]?.count ?? 0,
      );
    },
    async isWithdrawn(assignmentId, accountId, submittedAt) {
      return (
        (await query(ASSIGNMENT_FILE_SQL.isWithdrawn, [assignmentId, accountId, submittedAt]))
          .length > 0
      );
    },
    async withdraw(assignmentId, accountId, submittedAt) {
      await query(ASSIGNMENT_FILE_SQL.withdraw, [assignmentId, accountId, submittedAt]);
    },
    async getFile(id) {
      const rows = await query(ASSIGNMENT_FILE_SQL.getFile, [id]);
      return rows[0] ? fileFromRow(rows[0]) : null;
    },
    async advanceVersion(assignmentId, accountId, version) {
      await query(ASSIGNMENT_FILE_SQL.advanceVersion, [
        accountId,
        `submit-version:${assignmentId}`,
        version,
      ]);
    },
    async currentVersion(assignmentId, accountId) {
      const rows = await query(ASSIGNMENT_FILE_SQL.getIdempotency, [
        accountId,
        `submit-version:${assignmentId}`,
      ]);
      return rows[0] ? String(rows[0].request_hash) : null;
    },
    async putFile(record, version) {
      const sql = version
        ? `WITH current_version AS MATERIALIZED (
        SELECT request_hash FROM class_assignment_file_idempotency
        WHERE actor_id = $4 AND key = 'submit-version:' || $3 FOR UPDATE
      ) ` +
          ASSIGNMENT_FILE_SQL.upsertFile.replace(
            'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)',
            `SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15
        WHERE NOT EXISTS (SELECT 1 FROM current_version WHERE request_hash::timestamptz > $16::timestamptz)`,
          ) +
          ` WHERE NOT EXISTS (SELECT 1 FROM current_version WHERE request_hash::timestamptz > $16::timestamptz) RETURNING id`
        : ASSIGNMENT_FILE_SQL.upsertFile;
      const rows = await query(sql, [
        record.id,
        record.workspaceId,
        record.assignmentId,
        record.platformAccountId,
        record.originalName,
        record.contentType,
        record.byteSize,
        record.sha256,
        record.kind,
        record.storageKey,
        record.createdAt,
        record.uploadedAt,
        record.submittedAt,
        record.supersededAt,
        record.late,
        ...(version ? [version] : []),
      ]);
      if (version && !rows.length) throw new NuniError(409, 'ASSIGNMENT_SUBMISSION_SUPERSEDED');
    },
    async listVisible(assignmentId, accountId) {
      return (await query(ASSIGNMENT_FILE_SQL.listVisible, [assignmentId, accountId])).map(
        fileFromRow,
      );
    },
    async listStaged(assignmentId, accountId) {
      return (await query(ASSIGNMENT_FILE_SQL.listStaged, [assignmentId, accountId])).map(
        fileFromRow,
      );
    },
    async getIdempotency(actorId, key) {
      const rows = await query(ASSIGNMENT_FILE_SQL.getIdempotency, [actorId, key]);
      const row = rows[0];
      if (!row) return null;
      return { hash: String(row.request_hash), payload: row.payload };
    },
    async putIdempotency(actorId, key, row) {
      await query(ASSIGNMENT_FILE_SQL.putIdempotency, [
        actorId,
        key,
        row.hash,
        JSON.stringify(row.payload),
      ]);
    },
  };
}

export function createFakeAssignmentFileSql(): SqlQuery {
  const files = new Map<string, Record<string, unknown>>();
  const withdrawals = new Set<string>();
  const idempotency = new Map<string, Record<string, unknown>>();
  return async (sql, params = []) => {
    if (sql === ASSIGNMENT_FILE_SQL.countWithdrawn)
      return [{ count: [...withdrawals].filter((key) => JSON.parse(key)[0] === params[0]).length }];
    const withdrawalKey = JSON.stringify(params);
    if (sql === ASSIGNMENT_FILE_SQL.isWithdrawn) return withdrawals.has(withdrawalKey) ? [{ exists: 1 }] : [];
    if (sql === ASSIGNMENT_FILE_SQL.withdraw) { withdrawals.add(withdrawalKey); return []; }
    if (sql === ASSIGNMENT_FILE_SQL.getFile) {
      const row = files.get(String(params[0]));
      return row ? [row] : [];
    }
    if (sql === ASSIGNMENT_FILE_SQL.advanceVersion) {
      const key = `${params[0]}:${params[1]}`;
      const previous = idempotency.get(key);
      if (!previous || Date.parse(String(previous.request_hash)) < Date.parse(String(params[2])))
        idempotency.set(key, { request_hash: params[2], payload: params[2] });
      return [];
    }
    if (sql === ASSIGNMENT_FILE_SQL.upsertFile || sql.includes('RETURNING id')) {
      if (
        params.length === 16 &&
        Date.parse(
          String(
            idempotency.get(`${params[3]}:submit-version:${params[2]}`)?.request_hash ?? params[15],
          ),
        ) > Date.parse(String(params[15]))
      )
        return [];
      const row = {
        id: params[0],
        workspace_id: params[1],
        assignment_id: params[2],
        platform_account_id: params[3],
        original_name: params[4],
        content_type: params[5],
        byte_size: params[6],
        sha256: params[7],
        kind: params[8],
        storage_key: params[9],
        created_at: params[10],
        uploaded_at: params[11],
        submitted_at: params[12],
        superseded_at: params[13],
        late: params[14],
      };
      files.set(String(row.id), row);
      return params.length === 16 ? [{ id: row.id }] : [];
    }
    if (sql === ASSIGNMENT_FILE_SQL.listVisible || sql === ASSIGNMENT_FILE_SQL.listStaged) {
      const assignmentId = params[0];
      const accountId = params[1];
      return [...files.values()].filter((row) => {
        if (row.assignment_id !== assignmentId || row.platform_account_id !== accountId) return false;
        if (sql === ASSIGNMENT_FILE_SQL.listVisible) return Boolean(row.submitted_at) && !row.superseded_at;
        return !row.submitted_at && !row.superseded_at;
      });
    }
    if (sql === ASSIGNMENT_FILE_SQL.getIdempotency) {
      const row = idempotency.get(`${params[0]}:${params[1]}`);
      return row ? [row] : [];
    }
    if (sql === ASSIGNMENT_FILE_SQL.putIdempotency) {
      const id = `${params[0]}:${params[1]}`;
      if (!idempotency.has(id)) {
        idempotency.set(id, {
          request_hash: params[2],
          payload: JSON.parse(String(params[3])),
        });
      }
      return [];
    }
    throw new Error(`unexpected assignment file SQL: ${sql}`);
  };
}

export function createTtlMemoryBlobStore(now: () => number = Date.now): AssignmentBlobStore {
  const blobs = new Map<string, { bytes: Uint8Array; expiresAt: number }>();
  function sweep(key?: string) {
    const current = now();
    if (key) {
      const entry = blobs.get(key);
      if (entry && entry.expiresAt <= current) blobs.delete(key);
      return;
    }
    for (const [storageKey, entry] of blobs) {
      if (entry.expiresAt <= current) blobs.delete(storageKey);
    }
  }
  return {
    async put(storageKey, bytes) {
      blobs.set(storageKey, { bytes, expiresAt: now() + MEMORY_BLOB_TTL_MS });
      sweep();
    },
    async get(storageKey) {
      sweep(storageKey);
      return blobs.get(storageKey)?.bytes ?? null;
    },
  };
}

function createDiskBlobStore(dir: string): AssignmentBlobStore {
  return {
    async put(storageKey, bytes) {
      const full = path.join(dir, storageKey);
      await mkdir(path.dirname(full), { recursive: true });
      await writeFile(full, bytes);
    },
    async get(storageKey) {
      try {
        return await readFile(path.join(dir, storageKey));
      } catch {
        return null;
      }
    },
  };
}

export function createSupabaseBlobStore(
  base: string,
  key: string,
  fetchImpl: typeof fetch = fetch,
): AssignmentBlobStore {
  const root = `${base.replace(/\/$/, '')}/storage/v1/object/${ASSIGNMENT_FILE_BUCKET}/`;
  return {
    async put(storageKey, bytes, contentType) {
      const response = await fetchImpl(`${root}${storageKey}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          apikey: key,
          'Content-Type': contentType,
          'x-upsert': 'true',
        },
        body: Buffer.from(bytes),
      });
      if (!response.ok) throw new NuniError(503, 'ASSIGNMENT_FILE_UPLOAD_UNAVAILABLE');
    },
    async get(storageKey) {
      const response = await fetchImpl(`${root}${storageKey}`, {
        headers: { Authorization: `Bearer ${key}`, apikey: key },
      });
      if (response.status === 404) return null;
      if (!response.ok) throw new NuniError(503, 'ASSIGNMENT_FILE_UPLOAD_UNAVAILABLE');
      return new Uint8Array(await response.arrayBuffer());
    },
  };
}

function productionIndexUnavailable(): AssignmentFileIndexStore {
  const fail = unavailable('ASSIGNMENT_FILE_STORE_UNAVAILABLE');
  return {
    advanceVersion: fail,
    currentVersion: fail,
    countWithdrawn: fail,
    isWithdrawn: fail,
    withdraw: fail,
    getFile: fail,
    putFile: fail,
    listVisible: fail,
    listStaged: fail,
    getIdempotency: fail,
    putIdempotency: fail,
  };
}

function productionBlobUnavailable(): AssignmentBlobStore {
  const fail = unavailable('ASSIGNMENT_FILE_UPLOAD_UNAVAILABLE');
  return { put: fail, get: fail };
}

type Pool = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
};
export type AssignmentFilePoolFactory = (connectionString: string) => Pool;

const pools = new Map<string, Pool>();
const queries = new Map<string, SqlQuery>();
const resolvedByKey = new Map<string, AssignmentFileRuntimeStores>();
let poolFactory: AssignmentFilePoolFactory | undefined;

export function setAssignmentFilePoolFactory(factory?: AssignmentFilePoolFactory) {
  poolFactory = factory;
}

export function cachedAssignmentFilePoolCount() {
  return pools.size;
}

function defaultPool(connectionString: string): Pool {
  try {
    const required = createRequire(import.meta.url);
    const pg = required('pg') as {
      Pool: new (config: { connectionString: string; max: number }) => Pool;
    };
    return new pg.Pool({ connectionString, max: 4 });
  } catch {
    throw new NuniError(503, 'ASSIGNMENT_FILE_STORE_UNAVAILABLE');
  }
}

function poolFor(connectionString: string): Pool {
  const existing = pools.get(connectionString);
  if (existing) return existing;
  const pool = (poolFactory ?? defaultPool)(connectionString);
  pools.set(connectionString, pool);
  return pool;
}

export function postgresQuery(connectionString: string): SqlQuery {
  const cached = queries.get(connectionString);
  if (cached) return cached;
  const query: SqlQuery = async (text, params) => {
    const result = await poolFor(connectionString).query(text, params);
    return result.rows;
  };
  queries.set(connectionString, query);
  return query;
}

function storesKey(env: Record<string, string | undefined>, query?: SqlQuery) {
  if (query) return '';
  return [
    env.NODE_ENV ?? '',
    env.ASSIGNMENT_FILE_DATABASE_URL?.trim() ?? '',
    env.DATABASE_URL?.trim() ?? '',
    env.SUPABASE_URL?.trim() ?? '',
    env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? '',
    env.ASSIGNMENT_FILE_STORE_DIR?.trim() ?? '',
  ].join('\0');
}

function buildAssignmentFileStores(
  env: Record<string, string | undefined>,
  query?: SqlQuery,
): AssignmentFileRuntimeStores {
  const production = env.NODE_ENV === 'production';
  const databaseUrl =
    env.ASSIGNMENT_FILE_DATABASE_URL?.trim() || (production ? env.DATABASE_URL?.trim() : '');
  const index = query
    ? createSqlIndexStore(query)
    : databaseUrl
      ? createSqlIndexStore(postgresQuery(databaseUrl))
      : production
        ? productionIndexUnavailable()
        : createMemoryIndexStore();

  const supabaseUrl = env.SUPABASE_URL?.trim();
  const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const dir = env.ASSIGNMENT_FILE_STORE_DIR?.trim();
  let blobs: AssignmentBlobStore;
  if (production) {
    blobs =
      supabaseUrl && supabaseKey
        ? createSupabaseBlobStore(supabaseUrl, supabaseKey)
        : productionBlobUnavailable();
  } else if (supabaseUrl && supabaseKey) {
    blobs = createSupabaseBlobStore(supabaseUrl, supabaseKey);
  } else if (dir) {
    blobs = createDiskBlobStore(dir);
  } else {
    blobs = createTtlMemoryBlobStore();
  }
  return { index, blobs };
}

export function resolveAssignmentFileStores(
  env: Record<string, string | undefined> = process.env,
  query?: SqlQuery,
): AssignmentFileRuntimeStores {
  const key = storesKey(env, query);
  if (key) {
    const cached = resolvedByKey.get(key);
    if (cached) return cached;
  }
  const stores = buildAssignmentFileStores(env, query);
  if (key) resolvedByKey.set(key, stores);
  return stores;
}

const defaultStores = {
  index: createMemoryIndexStore(),
  blobs: createTtlMemoryBlobStore(),
};

export function defaultAssignmentFileStores(): AssignmentFileRuntimeStores {
  return defaultStores;
}

export function resetAssignmentFileStores() {
  defaultStores.index = createMemoryIndexStore();
  defaultStores.blobs = createTtlMemoryBlobStore();
  pools.clear();
  queries.clear();
  resolvedByKey.clear();
  poolFactory = undefined;
}

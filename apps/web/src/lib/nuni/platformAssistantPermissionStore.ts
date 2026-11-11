import { NuniError } from '@campus/shared/src/nuni';
import {
  createDefaultPlatformAssistantPermissions,
  isPlatformAssistantAccountId,
  parsePlatformAssistantPermissionState,
  parsePlatformAssistantPermissionUpdate,
  type PlatformAssistantPermissionState,
  type PlatformAssistantPermissions,
} from '@campus/shared/src/platformAssistantPermissions';
import { postgresQuery, type SqlQuery } from './assignmentFileStore';

export type PlatformAssistantPermissionStore = {
  read(accountId: string): Promise<PlatformAssistantPermissionState>;
  save(
    accountId: string,
    expectedRevision: number,
    permissions: PlatformAssistantPermissions,
  ): Promise<PlatformAssistantPermissionState>;
};

const COLUMNS = 'revision, create_personal_event, prepare_food_order';
const ACTIVE_ACCOUNT = `SELECT id FROM platform_accounts WHERE id = $1 AND state = 'active' FOR SHARE`;
export const PLATFORM_ASSISTANT_PERMISSION_SQL = {
  read: `SELECT a.id AS account_id, p.revision, p.create_personal_event, p.prepare_food_order
    FROM platform_accounts a LEFT JOIN platform_assistant_permissions p ON p.platform_account_id = a.id
    WHERE a.id = $1 AND a.state = 'active'`,
  insert: `WITH actor AS MATERIALIZED (${ACTIVE_ACCOUNT}), changed AS (
      INSERT INTO platform_assistant_permissions (platform_account_id, revision, create_personal_event, prepare_food_order)
      SELECT id, 1, $2, $3 FROM actor
      ON CONFLICT (platform_account_id) DO NOTHING
      RETURNING ${COLUMNS}
    ) SELECT actor.id AS account_id, changed.* FROM actor LEFT JOIN changed ON true`,
  update: `WITH actor AS MATERIALIZED (${ACTIVE_ACCOUNT}), changed AS (
      UPDATE platform_assistant_permissions p
      SET revision = p.revision + 1, create_personal_event = $2, prepare_food_order = $3, updated_at = now()
      FROM actor WHERE p.platform_account_id = actor.id AND p.revision = $4
      RETURNING p.revision, p.create_personal_event, p.prepare_food_order
    ) SELECT actor.id AS account_id, changed.* FROM actor LEFT JOIN changed ON true`,
} as const;

function unavailable(): never {
  throw new NuniError(503, 'ASSISTANT_PERMISSION_STORE_UNAVAILABLE');
}

function account(value: string) {
  if (!isPlatformAssistantAccountId(value)) throw new NuniError(401, 'SIGN_IN_REQUIRED');
}

function state(
  accountId: string,
  row: Record<string, unknown>,
  missing: boolean,
): PlatformAssistantPermissionState {
  if (row.account_id !== accountId) return unavailable();
  if (missing) {
    if (row.create_personal_event !== null || row.prepare_food_order !== null) return unavailable();
    return {
      scope: 'platform-account',
      accountId,
      revision: 0,
      permissions: createDefaultPlatformAssistantPermissions(),
    };
  }
  try {
    if (typeof row.revision !== 'number' || row.revision < 1) return unavailable();
    return parsePlatformAssistantPermissionState({
      scope: 'platform-account',
      accountId,
      revision: row.revision,
      permissions: {
        createPersonalEvent: row.create_personal_event,
        prepareFoodOrder: row.prepare_food_order,
      },
    });
  } catch {
    return unavailable();
  }
}

/** Server-side only: the query is parameterized and every read reaches PostgreSQL. */
export function createSqlPlatformAssistantPermissionStore(
  query: SqlQuery,
): PlatformAssistantPermissionStore {
  async function run(sql: string, params: unknown[]) {
    try {
      return await query(sql, params);
    } catch {
      return unavailable();
    }
  }
  return {
    async read(accountId) {
      account(accountId);
      const rows = await run(PLATFORM_ASSISTANT_PERMISSION_SQL.read, [accountId]);
      if (!rows.length) throw new NuniError(401, 'SIGN_IN_REQUIRED');
      if (rows.length !== 1) return unavailable();
      return state(accountId, rows[0], rows[0].revision === null);
    },
    async save(accountId, expectedRevision, permissions) {
      account(accountId);
      const validated = parsePlatformAssistantPermissionUpdate({ expectedRevision, permissions });
      const rows = await run(
        expectedRevision === 0
          ? PLATFORM_ASSISTANT_PERMISSION_SQL.insert
          : PLATFORM_ASSISTANT_PERMISSION_SQL.update,
        [
          accountId,
          validated.permissions.createPersonalEvent,
          validated.permissions.prepareFoodOrder,
          ...(expectedRevision === 0 ? [] : [expectedRevision]),
        ],
      );
      if (!rows.length) throw new NuniError(401, 'SIGN_IN_REQUIRED');
      if (rows.length !== 1 || rows[0].account_id !== accountId) return unavailable();
      if (rows[0].revision === null)
        throw new NuniError(409, 'ASSISTANT_PERMISSION_REVISION_CONFLICT');
      const saved = state(accountId, rows[0], false);
      if (
        saved.revision !== expectedRevision + 1 ||
        saved.permissions.createPersonalEvent !== validated.permissions.createPersonalEvent ||
        saved.permissions.prepareFoodOrder !== validated.permissions.prepareFoodOrder
      )
        return unavailable();
      return saved;
    },
  };
}

export function resolvePlatformAssistantPermissionStore(
  env: Record<string, string | undefined> = process.env,
): PlatformAssistantPermissionStore {
  const databaseUrl =
    env.PLATFORM_ASSISTANT_DATABASE_URL?.trim() ||
    env.ASSIGNMENT_FILE_DATABASE_URL?.trim() ||
    env.DATABASE_URL?.trim();
  // Never turn missing persistence into a successful local-memory preference.
  if (!databaseUrl) return { read: async () => unavailable(), save: async () => unavailable() };
  return createSqlPlatformAssistantPermissionStore(postgresQuery(databaseUrl));
}

export async function readPlatformAssistantPermissions(accountId: string) {
  return resolvePlatformAssistantPermissionStore().read(accountId);
}

export async function savePlatformAssistantPermissions(
  accountId: string,
  expectedRevision: number,
  permissions: PlatformAssistantPermissions,
) {
  return resolvePlatformAssistantPermissionStore().save(accountId, expectedRevision, permissions);
}

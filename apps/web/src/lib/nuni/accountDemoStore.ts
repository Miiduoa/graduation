import {
  AccountDemoError,
  applyAccountDemoAction,
  parseAccountDemoMutation,
  parseAccountDemoSnapshot,
  type AccountDemoMutation,
  type AccountDemoSnapshot,
} from '@campus/shared/src/accountDemo';
import { postgresQuery, type SqlQuery } from './assignmentFileStore';

export type AccountDemoStore = {
  read(accountId: string): Promise<AccountDemoSnapshot | null>;
  mutate(accountId: string, input: AccountDemoMutation): Promise<AccountDemoSnapshot>;
};
const fields = `demo.account_id, demo.revision, demo.profile, demo.permissions, demo.state, demo.expires_at`;
export const ACCOUNT_DEMO_SQL = {
  read: `SELECT ${fields} FROM public.nuni_account_demos demo
    JOIN public.platform_accounts account ON account.id=demo.account_id AND account.state='active'
    WHERE demo.account_id=$1 AND demo.enabled AND demo.expires_at>clock_timestamp()`,
  // The account lock keeps a concurrent suspension ordered against this mutation.
  update: `WITH current_account AS (
      SELECT id FROM public.platform_accounts WHERE id=$1 AND state='active' FOR SHARE
    )
    UPDATE public.nuni_account_demos demo SET permissions=$3::jsonb, state=$4::jsonb,
      revision=demo.revision+1, updated_at=clock_timestamp()
    FROM current_account account
    WHERE demo.account_id=account.id AND demo.account_id=$1
      AND demo.revision=$2 AND demo.enabled AND demo.expires_at>clock_timestamp()
    RETURNING ${fields}`,
};
function snapshot(row: Record<string, unknown>, accountId: string): AccountDemoSnapshot {
  try {
    const parsed = parseAccountDemoSnapshot({
      accountId: row.account_id,
      revision: Number(row.revision),
      profile: row.profile,
      permissions: row.permissions,
      state: row.state,
      expiresAt: row.expires_at instanceof Date ? row.expires_at.toISOString() : row.expires_at,
    });
    if (parsed.accountId !== accountId || Date.parse(parsed.expiresAt) <= Date.now()) {
      throw new Error('Demo account is unavailable');
    }
    return parsed;
  } catch {
    throw new AccountDemoError(503, 'ACCOUNT_DEMO_STORE_UNAVAILABLE');
  }
}
function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
export function createAccountDemoStore(query: SqlQuery): AccountDemoStore {
  const read = async (accountId: string) => {
    const rows = await query(ACCOUNT_DEMO_SQL.read, [accountId]);
    if (rows.length === 0) return null;
    if (rows.length !== 1) throw new AccountDemoError(503, 'ACCOUNT_DEMO_STORE_UNAVAILABLE');
    return snapshot(rows[0]!, accountId);
  };
  return {
    read,
    async mutate(accountId, raw) {
      const input = parseAccountDemoMutation(raw);
      const current = await read(accountId);
      if (!current) throw new AccountDemoError(404, 'ACCOUNT_DEMO_UNAVAILABLE');
      if (current.revision !== input.expectedRevision) {
        throw new AccountDemoError(409, 'DEMO_REVISION_CHANGED');
      }
      if (current.revision >= Number.MAX_SAFE_INTEGER) {
        throw new AccountDemoError(409, 'DEMO_REVISION_CHANGED');
      }
      const permissions = 'permissions' in input ? input.permissions : current.permissions;
      const state =
        'action' in input ? applyAccountDemoAction(current, input.action) : current.state;
      const rows = await query(ACCOUNT_DEMO_SQL.update, [
        accountId,
        input.expectedRevision,
        JSON.stringify(permissions),
        JSON.stringify(state),
      ]);
      if (rows.length !== 1) throw new AccountDemoError(409, 'DEMO_REVISION_CHANGED');
      const saved = snapshot(rows[0]!, accountId);
      if (
        saved.revision !== input.expectedRevision + 1 ||
        !same(saved.permissions, permissions) ||
        !same(saved.state, state)
      ) {
        throw new AccountDemoError(503, 'DEMO_SAVE_NOT_CONFIRMED');
      }
      // Confirm the owner is still active and this exact revision is readable.
      const confirmed = await read(accountId);
      if (!confirmed || !same(confirmed, saved)) {
        throw new AccountDemoError(409, 'DEMO_SAVE_NOT_CONFIRMED');
      }
      return confirmed;
    },
  };
}
export function resolveAccountDemoStore(
  env: Record<string, string | undefined> = process.env,
): AccountDemoStore {
  const url =
    env.ACCOUNT_DEMO_DATABASE_URL?.trim() ||
    env.ASSIGNMENT_FILE_DATABASE_URL?.trim() ||
    env.DATABASE_URL?.trim();
  if (!url) throw new AccountDemoError(503, 'ACCOUNT_DEMO_STORE_UNAVAILABLE');
  return createAccountDemoStore(postgresQuery(url));
}

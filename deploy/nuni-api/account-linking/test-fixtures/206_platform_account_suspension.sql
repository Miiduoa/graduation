-- 206: 一般帳號的停權寫入路徑。
--
-- 146 的 CHECK 從第一天就允許 'suspended'、登入端也一直過濾 state='active'，
-- 但全樹零寫入端——「過濾條件正確，值域是空的」那一族。這一支補上
-- 停權時刻欄位與 append-only 的停權決定帳本；現樹沒有任何 suspended 列，
-- 新 CHECK 不會碰到既有資料。

ALTER TABLE platform_accounts
  ADD COLUMN IF NOT EXISTS suspended_at timestamptz;

ALTER TABLE platform_accounts
  ADD CONSTRAINT platform_accounts_suspended_at_check
  CHECK ((state = 'suspended') = (suspended_at IS NOT NULL));

CREATE TABLE platform_account_suspensions (
  id text PRIMARY KEY CHECK (id ~ '^pas_[0-9a-f-]{36}$'),
  platform_account_id text NOT NULL REFERENCES platform_accounts(id),
  tenant_id text NOT NULL,
  action text NOT NULL CHECK (action IN ('suspend', 'reinstate')),
  decided_by text NOT NULL,
  reason_detail text NOT NULL CHECK (length(btrim(reason_detail)) BETWEEN 5 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX platform_account_suspensions_account_idx
  ON platform_account_suspensions (platform_account_id, created_at DESC);

CREATE OR REPLACE FUNCTION platform_account_suspensions_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'platform account suspension decisions are append-only';
END;
$$;

CREATE TRIGGER platform_account_suspensions_guard
BEFORE UPDATE OR DELETE ON platform_account_suspensions
FOR EACH ROW EXECUTE FUNCTION platform_account_suspensions_append_only();

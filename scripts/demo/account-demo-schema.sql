-- Account-scoped synthetic demonstration data. Run with the database owner.
-- This schema creates no login, campus membership, operator role or payment capability.
BEGIN;
CREATE TABLE IF NOT EXISTS public.nuni_account_demos (
  account_id text PRIMARY KEY REFERENCES public.platform_accounts(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  expires_at timestamptz NOT NULL,
  profile jsonb NOT NULL CHECK (jsonb_typeof(profile) = 'object'),
  permissions jsonb NOT NULL CHECK (jsonb_typeof(permissions) = 'object'),
  state jsonb NOT NULL CHECK (jsonb_typeof(state) = 'object'),
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0 AND revision <= 9007199254740991),
  seed_tag text NOT NULL CHECK (length(seed_tag) BETWEEN 1 AND 120),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- Upgrade an earlier copy without making account deletion depend on demo cleanup.
DO $account_demo_fk$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.nuni_account_demos'::regclass
      AND conname='nuni_account_demos_account_id_fkey' AND confdeltype <> 'c'
  ) THEN
    ALTER TABLE public.nuni_account_demos DROP CONSTRAINT nuni_account_demos_account_id_fkey;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.nuni_account_demos'::regclass
      AND conname='nuni_account_demos_account_id_fkey'
  ) THEN
    ALTER TABLE public.nuni_account_demos
      ADD CONSTRAINT nuni_account_demos_account_id_fkey
      FOREIGN KEY (account_id) REFERENCES public.platform_accounts(id) ON DELETE CASCADE;
  END IF;
END;
$account_demo_fk$;
ALTER TABLE public.nuni_account_demos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.nuni_account_demos FROM PUBLIC;
-- Grant only to the existing server runtime, never create a role or expose a public API.
-- Per-account ownership is checked by the authenticated handler and every SQL predicate.
DO $account_demo_runtime$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='nuni_web_files') THEN
    -- Remove stale table or column grants before reinstalling the exact runtime contract.
    REVOKE ALL PRIVILEGES ON TABLE public.nuni_account_demos FROM nuni_web_files;
    REVOKE ALL PRIVILEGES (account_id, enabled, expires_at, profile, permissions, state,
      revision, seed_tag, created_at, updated_at)
      ON TABLE public.nuni_account_demos FROM nuni_web_files;
    GRANT SELECT ON TABLE public.nuni_account_demos TO nuni_web_files;
    GRANT UPDATE (permissions, state, revision, updated_at)
      ON TABLE public.nuni_account_demos TO nuni_web_files;
    -- SELECT ... FOR SHARE needs UPDATE privilege on at least one account column.
    -- This grants no ability to change account state, identity, email or roles.
    GRANT UPDATE (updated_at) ON TABLE public.platform_accounts TO nuni_web_files;
    DROP POLICY IF EXISTS nuni_account_demos_web_read ON public.nuni_account_demos;
    CREATE POLICY nuni_account_demos_web_read ON public.nuni_account_demos
      FOR SELECT TO nuni_web_files
      USING (enabled AND expires_at > clock_timestamp());
    DROP POLICY IF EXISTS nuni_account_demos_web_update ON public.nuni_account_demos;
    CREATE POLICY nuni_account_demos_web_update ON public.nuni_account_demos
      FOR UPDATE TO nuni_web_files
      USING (enabled AND expires_at > clock_timestamp())
      WITH CHECK (enabled AND expires_at > clock_timestamp());
  END IF;
END;
$account_demo_runtime$;
COMMENT ON TABLE public.nuni_account_demos IS 'Private synthetic presentation state; never campus authority or real commerce.';
COMMIT;

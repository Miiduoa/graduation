-- Candidate only: integrate into the verified platform migration runner and
-- apply atomically before opting the Web worker in. The Web never runs DDL.
CREATE TABLE tronclass_account_closure_outbox (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  platform_account_id text NOT NULL UNIQUE
    CHECK (platform_account_id ~ '^pa_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  reason text NOT NULL CHECK (reason IN ('closed', 'deleted')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 1000000),
  next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  lease_token uuid,
  lease_expires_at timestamptz,
  last_failure text CHECK (last_failure IS NULL OR last_failure = 'cleanup_failed'),
  CHECK ((lease_token IS NULL) = (lease_expires_at IS NULL))
);
-- Deliberately no account FK: the evidence must survive the account's DELETE.
CREATE INDEX tronclass_account_closure_ready ON tronclass_account_closure_outbox (next_attempt_at, id);
REVOKE ALL ON TABLE tronclass_account_closure_outbox FROM PUBLIC;
REVOKE ALL ON SEQUENCE tronclass_account_closure_outbox_id_seq FROM PUBLIC;

CREATE FUNCTION enqueue_tronclass_account_closure() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  account_id text;
  closure_reason text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    account_id := OLD.id;
    closure_reason := 'deleted';
  ELSIF NEW.state IN ('closed', 'deleted') THEN
    IF TG_OP = 'UPDATE' AND NEW.state IS NOT DISTINCT FROM OLD.state THEN
      RETURN NEW;
    END IF;
    account_id := NEW.id;
    closure_reason := NEW.state;
  ELSE
    RETURN NEW;
  END IF;
  -- The trigger owns the real platform row. Neither a Web request nor the
  -- worker DB role may insert an arbitrary owner into this queue.
  EXECUTE format(
    'INSERT INTO %I.tronclass_account_closure_outbox (platform_account_id, reason)
     VALUES ($1, $2) ON CONFLICT (platform_account_id) DO NOTHING', TG_TABLE_SCHEMA)
    USING account_id, closure_reason;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION enqueue_tronclass_account_closure() FROM PUBLIC;

CREATE TRIGGER tronclass_account_closed AFTER INSERT OR UPDATE OF state ON platform_accounts
  FOR EACH ROW EXECUTE FUNCTION enqueue_tronclass_account_closure();
CREATE TRIGGER tronclass_account_deleted AFTER DELETE ON platform_accounts
  FOR EACH ROW EXECUTE FUNCTION enqueue_tronclass_account_closure();

-- Existing authoritative closed/deleted rows are evidence too. Never infer a
-- closure merely because an account is absent, and never scan Firestore owners.
INSERT INTO tronclass_account_closure_outbox (platform_account_id, reason)
  SELECT id, state FROM platform_accounts WHERE state IN ('closed', 'deleted')
  ON CONFLICT (platform_account_id) DO NOTHING;

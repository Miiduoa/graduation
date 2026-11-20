-- One private ledger per platform account and selected school. No membership or official grades are written.
CREATE TABLE personal_import_ledgers (
  platform_account_id text NOT NULL REFERENCES platform_accounts(id) ON DELETE CASCADE,
  school_id text NOT NULL CHECK (school_id ~ '^[a-z0-9][a-z0-9-]{0,79}$' AND school_id <> 'personal'),
  revision integer NOT NULL CHECK (revision > 0),
  records jsonb NOT NULL CHECK (jsonb_typeof(records)='array' AND jsonb_array_length(records)<=2000),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (platform_account_id,school_id)
);

CREATE TABLE personal_import_mutations (
  platform_account_id text NOT NULL,
  school_id text NOT NULL,
  mutation_id text NOT NULL CHECK (mutation_id ~ '^[A-Za-z0-9_-]{8,100}$'),
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (platform_account_id,school_id,mutation_id),
  FOREIGN KEY (platform_account_id,school_id) REFERENCES personal_import_ledgers(platform_account_id,school_id) ON DELETE CASCADE
);
CREATE INDEX personal_import_mutations_recent_idx
  ON personal_import_mutations (platform_account_id,school_id,created_at DESC,mutation_id DESC);

-- All closure entry points, including existing account APIs, dispose of personal imports in the same transaction.
-- Temporary account suspension retains data but all API access remains denied until reactivation.
CREATE FUNCTION dispose_closed_account_personal_imports() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.state IN ('deleted','closed') AND NEW.state IS DISTINCT FROM OLD.state THEN
    DELETE FROM personal_import_ledgers WHERE platform_account_id=NEW.id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER closed_account_personal_imports AFTER UPDATE OF state ON platform_accounts
  FOR EACH ROW EXECUTE FUNCTION dispose_closed_account_personal_imports();

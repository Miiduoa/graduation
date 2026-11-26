-- Platform-owned notices. school_id is a browsing group, never a membership grant.
CREATE TABLE platform_lost_found_items (
  id text PRIMARY KEY CHECK (length(id)=40 AND id ~ '^plf_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  platform_account_id text NOT NULL REFERENCES platform_accounts(id) ON DELETE CASCADE,
  school_id text NOT NULL CHECK (school_id ~ '^[a-z0-9]([a-z0-9-]{0,78}[a-z0-9])?$'
    AND school_id !~ '[[:space:]]' AND school_id NOT IN ('personal','all','unavailable-campus')),
  state text NOT NULL CHECK (state IN ('open','resolved','removed')),
  version integer NOT NULL CHECK (version > 0),
  item_type text CHECK (item_type IN ('lost','found')),
  title text CHECK (length(title) BETWEEN 1 AND 80),
  description text CHECK (length(description) BETWEEN 1 AND 2000),
  category text CHECK (category IN ('electronics','cards','documents','wallet','clothing','accessories','books','keys','other')),
  location text CHECK (length(location) BETWEEN 1 AND 120),
  item_date date CHECK (item_date >= DATE '1900-01-01'),
  contact_info text CHECK (length(contact_info) <= 200),
  created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()),
  updated_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()),
  resolved_at timestamptz,
  UNIQUE (id,platform_account_id),
  CHECK (
    (state='removed' AND item_type IS NULL AND title IS NULL AND description IS NULL
      AND category IS NULL AND location IS NULL AND item_date IS NULL AND contact_info IS NULL AND resolved_at IS NULL)
    OR (state IN ('open','resolved') AND item_type IS NOT NULL AND title IS NOT NULL AND description IS NOT NULL
      AND category IS NOT NULL AND location IS NOT NULL AND item_date IS NOT NULL AND contact_info IS NOT NULL)
  ),
  CHECK ((state='open' AND resolved_at IS NULL) OR (state='resolved' AND resolved_at IS NOT NULL AND contact_info='')
    OR (state='removed' AND resolved_at IS NULL))
);
CREATE INDEX platform_lost_found_school_page_idx ON platform_lost_found_items
  (school_id,state,created_at DESC,id DESC) WHERE state<>'removed';
CREATE INDEX platform_lost_found_owner_page_idx ON platform_lost_found_items
  (platform_account_id,school_id,created_at DESC,id DESC);

-- A retry keeps only the request fingerprint and receipt version, never duplicate post/contact content.
CREATE TABLE platform_lost_found_mutations (
  platform_account_id text NOT NULL REFERENCES platform_accounts(id) ON DELETE CASCADE,
  mutation_id text NOT NULL CHECK (mutation_id ~ '^[A-Za-z0-9_-]{8,100}$' AND mutation_id !~ '[[:space:]]'),
  item_id text NOT NULL,
  action text NOT NULL CHECK (action IN ('create','update','resolve','remove')),
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  receipt_version integer NOT NULL CHECK (receipt_version > 0),
  created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()),
  PRIMARY KEY (platform_account_id,mutation_id),
  FOREIGN KEY (item_id,platform_account_id) REFERENCES platform_lost_found_items(id,platform_account_id) ON DELETE CASCADE
);
CREATE INDEX platform_lost_found_mutations_recent_idx ON platform_lost_found_mutations
  (platform_account_id,created_at DESC,mutation_id DESC);

-- Every existing account-closure path erases notices, contacts, tombstones and retry metadata atomically.
-- Suspension only hides the notices; it does not erase a potentially recoverable account's data.
CREATE FUNCTION dispose_closed_account_lost_found() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.state IN ('deleted','closed') AND NEW.state IS DISTINCT FROM OLD.state THEN
    DELETE FROM platform_lost_found_items WHERE platform_account_id=NEW.id;
    DELETE FROM platform_lost_found_mutations WHERE platform_account_id=NEW.id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER closed_account_lost_found AFTER UPDATE OF state ON platform_accounts
  FOR EACH ROW EXECUTE FUNCTION dispose_closed_account_lost_found();

-- Additive file-object table for class-workspace assignment submissions.
-- Do not apply until the product owner explicitly says to go live.
-- Does not alter or drop existing tables or columns.
-- Rerunnable: CREATE IF NOT EXISTS so a second apply does not fail.
CREATE TABLE IF NOT EXISTS class_assignment_submission_files (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES class_workspaces(id),
  assignment_id text NOT NULL REFERENCES class_workspace_assignments(id),
  platform_account_id text NOT NULL REFERENCES platform_accounts(id),
  original_name text NOT NULL CHECK (char_length(original_name) BETWEEN 1 AND 200),
  content_type text NOT NULL CHECK (char_length(content_type) BETWEEN 1 AND 120),
  byte_size integer NOT NULL CHECK (byte_size > 0 AND byte_size <= 20971520),
  sha256 text NOT NULL DEFAULT '' CHECK (sha256 = '' OR sha256 ~ '^[0-9a-f]{64}$'),
  kind text NOT NULL CHECK (kind IN ('image', 'file')),
  storage_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  uploaded_at timestamptz,
  submitted_at timestamptz,
  superseded_at timestamptz,
  late boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS class_assignment_submission_files_visible
  ON class_assignment_submission_files (assignment_id, platform_account_id, submitted_at)
  WHERE superseded_at IS NULL;

CREATE TABLE IF NOT EXISTS class_assignment_file_idempotency (
  actor_id text NOT NULL REFERENCES platform_accounts(id),
  key text NOT NULL CHECK (length(key) BETWEEN 8 AND 100),
  request_hash text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_id, key)
);

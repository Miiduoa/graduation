-- Disposable local PostgreSQL fixture for the account demo seed tests only.
-- Relevant constraints mirror the inspected platform schema; no production connection is used.
CREATE TABLE platform_accounts (
  id text PRIMARY KEY CHECK (id ~ '^pa_[0-9a-f-]{36}$'),
  display_name text NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 100),
  primary_email text, state text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE platform_account_credentials (
  id text PRIMARY KEY,
  platform_account_id text NOT NULL REFERENCES platform_accounts(id),
  method text NOT NULL, provider_issuer text NOT NULL, provider_subject text NOT NULL,
  email_at_registration text, email_verified boolean NOT NULL DEFAULT false,
  state text NOT NULL DEFAULT 'active', UNIQUE (provider_issuer,provider_subject)
);
CREATE TABLE class_workspaces (
  id text PRIMARY KEY CHECK (id ~ '^cw_[0-9a-f-]{36}$'),
  owner_platform_account_id text NOT NULL REFERENCES platform_accounts(id),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 2 AND 120),
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active','archived')),
  archived_at timestamptz, CHECK ((state='archived')=(archived_at IS NOT NULL))
);
CREATE TABLE class_workspace_members (
  workspace_id text NOT NULL REFERENCES class_workspaces(id),
  platform_account_id text NOT NULL REFERENCES platform_accounts(id),
  role text NOT NULL CHECK (role IN ('owner-teacher','co-teacher','student')),
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active','removed')),
  removed_at timestamptz,
  PRIMARY KEY (workspace_id,platform_account_id),
  CHECK ((state='removed')=(removed_at IS NOT NULL)),
  CHECK ((role='owner-teacher' AND state='active') OR role IN ('co-teacher','student'))
);
CREATE TABLE class_workspace_affiliations (workspace_id text PRIMARY KEY REFERENCES class_workspaces(id), tenant_id text);
CREATE TABLE class_workspace_units (
  id text PRIMARY KEY CHECK (id ~ '^cwu_[0-9a-f-]{36}$'),
  workspace_id text NOT NULL REFERENCES class_workspaces(id),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 80),
  position integer NOT NULL CHECK (position BETWEEN 1 AND 500),
  created_by_platform_account_id text NOT NULL REFERENCES platform_accounts(id),
  UNIQUE (workspace_id,position)
);
CREATE TABLE class_workspace_materials (
  id text PRIMARY KEY CHECK (id ~ '^cwm_[0-9a-f-]{36}$'),
  workspace_id text NOT NULL REFERENCES class_workspaces(id),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 160),
  body text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 8000),
  created_by_platform_account_id text NOT NULL REFERENCES platform_accounts(id),
  unit_id text REFERENCES class_workspace_units(id)
);
CREATE TABLE class_workspace_assignments (
  id text PRIMARY KEY CHECK (id ~ '^cwa_[0-9a-f-]{36}$'),
  workspace_id text NOT NULL REFERENCES class_workspaces(id),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 160),
  instructions text NOT NULL CHECK (length(btrim(instructions)) BETWEEN 1 AND 8000),
  state text NOT NULL CHECK (state IN ('open','closed')),
  created_by_platform_account_id text NOT NULL REFERENCES platform_accounts(id),
  due_at timestamptz, unit_id text REFERENCES class_workspace_units(id), version integer NOT NULL CHECK (version>0),
  closed_at timestamptz, CHECK ((state='closed')=(closed_at IS NOT NULL))
);
CREATE TABLE class_workspace_quizzes (
  id text PRIMARY KEY CHECK (id ~ '^cwq_[0-9a-f-]{36}$'),
  workspace_id text NOT NULL REFERENCES class_workspaces(id),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 160),
  prompt text NOT NULL CHECK (length(btrim(prompt)) BETWEEN 1 AND 4000),
  state text NOT NULL CHECK (state IN ('open','closed')),
  created_by_platform_account_id text NOT NULL REFERENCES platform_accounts(id),
  due_at timestamptz, unit_id text REFERENCES class_workspace_units(id), version integer NOT NULL CHECK (version>0),
  closed_at timestamptz, CHECK ((state='closed')=(closed_at IS NOT NULL))
);
CREATE TABLE personal_import_ledgers (
  platform_account_id text NOT NULL REFERENCES platform_accounts(id),
  school_id text NOT NULL CHECK (school_id ~ '^[a-z0-9][a-z0-9-]{0,79}$' AND school_id<>'personal'),
  revision integer NOT NULL CHECK (revision>0),
  records jsonb NOT NULL CHECK (jsonb_typeof(records)='array' AND jsonb_array_length(records)<=2000),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (platform_account_id,school_id)
);

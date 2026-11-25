ALTER TABLE platform_account_credentials
  DROP CONSTRAINT platform_account_credentials_method_check;

ALTER TABLE platform_account_credentials
  ADD CONSTRAINT platform_account_credentials_method_check
    CHECK (method IN ('google', 'apple', 'qa', 'password'));

CREATE TABLE platform_password_credentials (
  credential_id text PRIMARY KEY,
  platform_account_id text NOT NULL UNIQUE REFERENCES platform_accounts(id),
  email text NOT NULL UNIQUE CHECK (email = lower(btrim(email)) AND length(email) BETWEEN 3 AND 254),
  password_hash text NOT NULL CHECK (length(password_hash) BETWEEN 80 AND 256),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (credential_id, platform_account_id)
    REFERENCES platform_account_credentials(id, platform_account_id)
);

-- Unknown and existing accounts share the same lockout path. No email or
-- submitted password is stored in the failed-attempt record.
CREATE TABLE platform_password_login_throttles (
  login_key text PRIMARY KEY CHECK (login_key ~ '^[a-f0-9]{64}$'),
  failure_count integer NOT NULL DEFAULT 0 CHECK (failure_count BETWEEN 0 AND 5),
  window_started_at timestamptz NOT NULL DEFAULT now(),
  locked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX platform_password_login_throttles_expiry_idx
  ON platform_password_login_throttles(updated_at);

CREATE TABLE platform_password_admin_audit (
  id text PRIMARY KEY CHECK (id ~ '^ppa_[0-9a-f-]{36}$'),
  platform_account_id text NOT NULL REFERENCES platform_accounts(id),
  credential_id text NOT NULL REFERENCES platform_account_credentials(id),
  action text NOT NULL CHECK (action IN ('create-account', 'add-credential', 'rotate-password')),
  operator_grant text NOT NULL CHECK (operator_grant IN ('grant', 'restore', 'unchanged')),
  performed_by text NOT NULL CHECK (length(btrim(performed_by)) BETWEEN 3 AND 100),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 5 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION platform_password_admin_audit_append_only()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'administrator credential audit is append-only' USING ERRCODE = '42501';
END;
$$;

CREATE TRIGGER platform_password_admin_audit_guard
BEFORE UPDATE OR DELETE ON platform_password_admin_audit
FOR EACH ROW EXECUTE FUNCTION platform_password_admin_audit_append_only();

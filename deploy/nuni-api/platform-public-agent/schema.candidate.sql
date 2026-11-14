-- Unregistered schema candidate only. Not a migration number, runtime manifest or grant.
-- The existing API migration runner must own any future transaction and checksum registration.
CREATE TABLE platform_public_agent_confirmations (
  id text PRIMARY KEY CHECK (id ~ '^pagc_[a-f0-9-]{36}$'),
  platform_account_id text NOT NULL REFERENCES platform_accounts(id) ON DELETE CASCADE,
  credential_id text NOT NULL,
  session_hash text NOT NULL CHECK (session_hash ~ '^[a-f0-9]{64}$'),
  task text NOT NULL CHECK (task IN ('campus-service-entry','public-campus-navigation')),
  request_id text NOT NULL CHECK (request_id ~ '^[A-Za-z0-9_-]{8,100}$'),
  school_id text NOT NULL CHECK (school_id ~ '^[A-Za-z0-9_-]{2,40}$'),
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
  provider text NOT NULL,
  model text NOT NULL,
  CHECK ((provider='groq' AND model='openai/gpt-oss-120b')
    OR (task='public-campus-navigation' AND provider='deterministic' AND model='public-poi-exact-match-v1')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  CHECK (expires_at>created_at),
  UNIQUE (platform_account_id,task,request_id),
  UNIQUE (id,platform_account_id,task,request_id)
);

CREATE TABLE platform_public_agent_operations (
  id text PRIMARY KEY CHECK (id ~ '^pago_[a-f0-9-]{36}$'),
  platform_account_id text NOT NULL REFERENCES platform_accounts(id) ON DELETE CASCADE,
  credential_id text NOT NULL,
  session_hash text NOT NULL CHECK (session_hash ~ '^[a-f0-9]{64}$'),
  task text NOT NULL CHECK (task IN ('campus-service-entry','public-campus-navigation')),
  request_id text NOT NULL CHECK (request_id ~ '^[A-Za-z0-9_-]{8,100}$'),
  school_id text NOT NULL CHECK (school_id ~ '^[A-Za-z0-9_-]{2,40}$'),
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
  provider text NOT NULL,
  model text NOT NULL,
  CHECK ((provider='groq' AND model='openai/gpt-oss-120b')
    OR (task='public-campus-navigation' AND provider='deterministic' AND model='public-poi-exact-match-v1')),
  confirmation_id text NOT NULL UNIQUE,
  status text NOT NULL CHECK (status IN ('running','unknown','completed','failed')),
  execution_token_hash text NOT NULL CHECK (execution_token_hash ~ '^[a-f0-9]{64}$'),
  result_json jsonb,
  failure_code text,
  acknowledged_at timestamptz,
  dispatch_started_at timestamptz,
  -- No default: any pre-fence executor must fail its INSERT rather than create false evidence.
  dispatch_fence_version smallint NOT NULL CHECK (dispatch_fence_version=1),
  CHECK (acknowledged_at IS NULL OR status IN ('completed','failed')),
  CHECK ((status NOT IN ('completed','failed')) OR
    (status='failed' AND failure_code='NOT_DISPATCHED' AND dispatch_started_at IS NULL) OR
    (dispatch_started_at IS NOT NULL AND (failure_code IS NULL OR failure_code<>'NOT_DISPATCHED'))),
  CHECK (result_json IS NULL OR (jsonb_typeof(result_json)='object' AND octet_length(result_json::text)<=32768)),
  CHECK ((status='completed' AND result_json IS NOT NULL AND failure_code IS NULL)
    OR (status='failed' AND result_json IS NULL AND failure_code IS NOT NULL AND failure_code IN ('SOURCE_CHANGED','INVALID_RESULT','EXECUTION_FAILED','FREE_QUOTA_UNAVAILABLE','FREE_ASSURANCE_UNAVAILABLE','DESTINATION_UNCLEAR','INVALID_PROVIDER_RESPONSE','NOT_DISPATCHED'))
    OR (status IN ('running','unknown') AND result_json IS NULL AND failure_code IS NULL)),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  CHECK (expires_at>created_at),
  UNIQUE (platform_account_id,task,request_id),
  FOREIGN KEY (confirmation_id,platform_account_id,task,request_id)
    REFERENCES platform_public_agent_confirmations(id,platform_account_id,task,request_id)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);

-- Unacknowledged operations of any status block a new request in the same scope.
CREATE UNIQUE INDEX platform_public_agent_one_unacknowledged
  ON platform_public_agent_operations(platform_account_id,school_id,task)
  WHERE acknowledged_at IS NULL;

CREATE TABLE platform_public_agent_quota (
  budget_kind text NOT NULL CHECK (budget_kind IN ('account','provider')),
  budget_key text NOT NULL CHECK (length(budget_key) BETWEEN 1 AND 160),
  platform_account_id text REFERENCES platform_accounts(id) ON DELETE CASCADE,
  window_start date NOT NULL,
  used integer NOT NULL CHECK (used BETWEEN 1 AND 10000),
  CHECK ((budget_kind='account' AND platform_account_id IS NOT NULL AND budget_key=platform_account_id)
    OR (budget_kind='provider' AND platform_account_id IS NULL)),
  PRIMARY KEY (budget_kind,budget_key,window_start)
);

-- Session/credential revocation denies access but does not erase operation tombstones.
-- Account closure removes its records; already debited provider-wide quota is not refunded.
CREATE FUNCTION dispose_closed_account_public_agent() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.state IN ('deleted','closed') AND NEW.state IS DISTINCT FROM OLD.state THEN
    DELETE FROM platform_public_agent_operations WHERE platform_account_id=NEW.id;
    DELETE FROM platform_public_agent_confirmations WHERE platform_account_id=NEW.id;
    DELETE FROM platform_public_agent_quota WHERE platform_account_id=NEW.id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER closed_account_public_agent AFTER UPDATE OF state ON platform_accounts
  FOR EACH ROW EXECUTE FUNCTION dispose_closed_account_public_agent();

-- No TTL pruning: unknown/expired operations remain non-executable tombstones.
-- No GRANT statements. Deployment, retention and runtime privilege review remain separate.

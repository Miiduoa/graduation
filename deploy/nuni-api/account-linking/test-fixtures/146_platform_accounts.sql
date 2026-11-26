-- A platform account is an application identity, not a campus identity.
-- Consumer Google / Apple authentication may create one of these rows, but it
-- must not create identity_subjects, people, or any campus role. Campus access
-- starts only after a separate membership has been verified and linked to an
-- authoritative tenant identity.

CREATE TABLE platform_identity_providers (
  kind text PRIMARY KEY CHECK (kind IN ('google-consumer', 'apple')),
  issuer text NOT NULL,
  client_id text NOT NULL CHECK (length(btrim(client_id)) BETWEEN 3 AND 300),
  jwks_uri text NOT NULL,
  authorization_endpoint text NOT NULL,
  token_endpoint text NOT NULL,
  state text NOT NULL DEFAULT 'disabled' CHECK (state IN ('disabled', 'enabled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_identity_providers_trust_roots CHECK (
    (kind = 'google-consumer'
      AND issuer = 'https://accounts.google.com'
      AND jwks_uri = 'https://www.googleapis.com/oauth2/v3/certs'
      AND authorization_endpoint = 'https://accounts.google.com/o/oauth2/v2/auth'
      AND token_endpoint = 'https://oauth2.googleapis.com/token')
    OR
    (kind = 'apple'
      AND issuer = 'https://appleid.apple.com'
      AND jwks_uri = 'https://appleid.apple.com/auth/keys'
      AND authorization_endpoint = 'https://appleid.apple.com/auth/authorize'
      AND token_endpoint = 'https://appleid.apple.com/auth/token')
  )
);

CREATE TABLE platform_accounts (
  id text PRIMARY KEY CHECK (id ~ '^pa_[0-9a-f-]{36}$'),
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'suspended', 'deleted')),
  display_name text NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 100),
  primary_email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CHECK ((state = 'deleted') = (deleted_at IS NOT NULL))
);

CREATE TABLE platform_account_credentials (
  id text PRIMARY KEY CHECK (id ~ '^pac_[0-9a-f-]{36}$'),
  platform_account_id text NOT NULL REFERENCES platform_accounts(id),
  method text NOT NULL CHECK (method IN ('google', 'apple')),
  provider_issuer text NOT NULL,
  provider_subject text NOT NULL CHECK (length(btrim(provider_subject)) BETWEEN 1 AND 255),
  email_at_registration text,
  email_verified boolean NOT NULL DEFAULT false,
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'revoked')),
  verified_at timestamptz NOT NULL,
  last_authenticated_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider_issuer, provider_subject),
  UNIQUE (id, platform_account_id),
  CHECK ((state = 'revoked') = (revoked_at IS NOT NULL))
);

CREATE INDEX platform_account_credentials_account_idx
  ON platform_account_credentials (platform_account_id, state);

CREATE TABLE platform_login_transactions (
  token_sha256 text PRIMARY KEY CHECK (token_sha256 ~ '^[a-f0-9]{64}$'),
  provider_kind text NOT NULL REFERENCES platform_identity_providers(kind),
  nonce_sha256 text NOT NULL CHECK (nonce_sha256 ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at)
);

CREATE INDEX platform_login_transactions_expiry_idx
  ON platform_login_transactions (expires_at) WHERE consumed_at IS NULL;

CREATE TABLE platform_account_sessions (
  token_sha256 text PRIMARY KEY CHECK (token_sha256 ~ '^[a-f0-9]{64}$'),
  platform_account_id text NOT NULL REFERENCES platform_accounts(id),
  credential_id text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (credential_id, platform_account_id)
    REFERENCES platform_account_credentials(id, platform_account_id),
  CHECK (expires_at > created_at)
);

CREATE INDEX platform_account_sessions_account_idx
  ON platform_account_sessions (platform_account_id, expires_at DESC);

CREATE TABLE campus_membership_claims (
  id text PRIMARY KEY CHECK (id ~ '^pm_[0-9a-f-]{36}$'),
  platform_account_id text NOT NULL REFERENCES platform_accounts(id),
  tenant_id text NOT NULL REFERENCES tenants(id),
  claimed_email text,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'verified', 'rejected', 'revoked')),
  assurance text NOT NULL DEFAULT 'unverified' CHECK (
    assurance IN ('unverified', 'domain-email', 'invite', 'campus-sso', 'admin-approved')
  ),
  linked_subject_id text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  revoked_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (platform_account_id, tenant_id),
  FOREIGN KEY (tenant_id, linked_subject_id) REFERENCES identity_subjects(tenant_id, id),
  CHECK (
    (state = 'pending' AND assurance = 'unverified' AND linked_subject_id IS NULL
      AND decided_at IS NULL AND revoked_at IS NULL)
    OR
    (state = 'verified' AND assurance <> 'unverified' AND linked_subject_id IS NOT NULL
      AND decided_at IS NOT NULL AND revoked_at IS NULL)
    OR
    (state = 'rejected' AND assurance = 'unverified' AND linked_subject_id IS NULL
      AND decided_at IS NOT NULL AND revoked_at IS NULL)
    OR
    (state = 'revoked' AND decided_at IS NOT NULL AND revoked_at IS NOT NULL)
  )
);

CREATE INDEX campus_membership_claims_tenant_state_idx
  ON campus_membership_claims (tenant_id, state, requested_at);

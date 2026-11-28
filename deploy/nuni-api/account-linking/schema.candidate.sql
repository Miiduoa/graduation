-- Isolated candidate: not an approved migration; not included in any active builder.
-- Reuse existing 146 platform account / credential / session rows. Do not add a second identity registry.
CREATE TABLE platform_google_link_transactions (
  token_sha256 text PRIMARY KEY CHECK (token_sha256 ~ '^[a-f0-9]{64}$'),
  platform_account_id text NOT NULL UNIQUE REFERENCES platform_accounts(id),
  credential_id text NOT NULL,
  session_sha256 text NOT NULL REFERENCES platform_account_sessions(token_sha256) ON DELETE CASCADE,
  nonce_sha256 text NOT NULL CHECK (nonce_sha256 ~ '^[a-f0-9]{64}$'),
  client_id text NOT NULL CHECK (length(client_id) BETWEEN 1 AND 300),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL CHECK (expires_at > created_at AND expires_at <= created_at + interval '5 minutes'),
  consumed_at timestamptz CHECK (consumed_at IS NULL OR consumed_at >= created_at),
  FOREIGN KEY (credential_id,platform_account_id) REFERENCES platform_account_credentials(id,platform_account_id)
);
REVOKE ALL ON TABLE platform_google_link_transactions FROM PUBLIC;
-- No grants here. Runtime inventory and migration runner must be independently reviewed.
-- Pending rows are replaced under an account lock; session deletion cascades.
-- Before rollout, add bounded expiry maintenance, index review, and controlled retention validation.

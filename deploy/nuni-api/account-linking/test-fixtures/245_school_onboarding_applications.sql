-- 平台營運者與學校接入申請。
-- 核准建立／確認 tenants(state=provisioned, directory_source=manual)；
-- 不自動 open，不寫 role-admin，不核發學籍。

CREATE TABLE platform_operator_assignments (
  platform_account_id text PRIMARY KEY REFERENCES platform_accounts(id),
  role_key text NOT NULL DEFAULT 'platform-operator'
    CHECK (role_key = 'platform-operator'),
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'revoked')),
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((state = 'revoked') = (revoked_at IS NOT NULL))
);

CREATE TABLE school_onboarding_applications (
  id text PRIMARY KEY CHECK (id ~ '^soa_[0-9a-f-]{36}$'),
  platform_account_id text NOT NULL REFERENCES platform_accounts(id),
  display_name text NOT NULL CHECK (length(btrim(display_name)) BETWEEN 2 AND 100),
  proposed_tenant_id text NOT NULL CHECK (
    proposed_tenant_id = lower(proposed_tenant_id)
    AND proposed_tenant_id ~ '^[a-z0-9][a-z0-9-]*[a-z0-9]$'
  ),
  proposed_email_domain text NOT NULL CHECK (
    proposed_email_domain = lower(proposed_email_domain)
    AND proposed_email_domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
  ),
  contact_name text NOT NULL CHECK (length(btrim(contact_name)) BETWEEN 1 AND 100),
  contact_email text NOT NULL CHECK (position('@' in contact_email) > 1),
  justification text NOT NULL CHECK (length(btrim(justification)) BETWEEN 8 AND 1000),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'approved', 'rejected')),
  tenant_id text REFERENCES tenants(id),
  decision_reason text,
  decided_by_platform_account_id text REFERENCES platform_accounts(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  CHECK (
    (state = 'pending' AND tenant_id IS NULL AND decided_at IS NULL
      AND decided_by_platform_account_id IS NULL AND decision_reason IS NULL)
    OR
    (state = 'approved' AND tenant_id IS NOT NULL AND decided_at IS NOT NULL
      AND decided_by_platform_account_id IS NOT NULL
      AND decision_reason IS NOT NULL AND length(btrim(decision_reason)) >= 5)
    OR
    (state = 'rejected' AND tenant_id IS NULL AND decided_at IS NOT NULL
      AND decided_by_platform_account_id IS NOT NULL
      AND decision_reason IS NOT NULL AND length(btrim(decision_reason)) >= 5)
  )
);

CREATE INDEX school_onboarding_applications_applicant_idx
  ON school_onboarding_applications (platform_account_id, created_at DESC);

CREATE INDEX school_onboarding_applications_state_idx
  ON school_onboarding_applications (state, created_at ASC);

CREATE UNIQUE INDEX school_onboarding_applications_pending_tenant_idx
  ON school_onboarding_applications (proposed_tenant_id)
  WHERE state = 'pending';

CREATE UNIQUE INDEX school_onboarding_applications_pending_domain_idx
  ON school_onboarding_applications (proposed_email_domain)
  WHERE state = 'pending';

CREATE TABLE school_onboarding_submit_idempotency (
  platform_account_id text NOT NULL REFERENCES platform_accounts(id),
  idempotency_key text NOT NULL CHECK (length(btrim(idempotency_key)) BETWEEN 8 AND 100),
  application_id text NOT NULL REFERENCES school_onboarding_applications(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (platform_account_id, idempotency_key)
);

CREATE TABLE school_onboarding_decision_idempotency (
  platform_account_id text NOT NULL REFERENCES platform_accounts(id),
  application_id text NOT NULL REFERENCES school_onboarding_applications(id),
  idempotency_key text NOT NULL CHECK (length(btrim(idempotency_key)) BETWEEN 8 AND 100),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (platform_account_id, application_id, idempotency_key)
);

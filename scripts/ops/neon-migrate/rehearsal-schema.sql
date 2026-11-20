-- 本機演練用的精簡 schema。模擬 nuni 課班／作業檔相關表、函式、觸發器、sequence，
-- 以及 Neon 常見的「非 superuser owner + 另有 web 角色」權限模型。
-- 不是正式 539 張表的替代品；用來證明工具鏈、權限重放與 QA 條件。

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE public.schema_migrations (
  id text PRIMARY KEY,
  checksum text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.platform_accounts (
  id text PRIMARY KEY,
  state text NOT NULL,
  display_name text NOT NULL,
  primary_email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.class_workspaces (
  id text PRIMARY KEY,
  owner_platform_account_id text NOT NULL REFERENCES public.platform_accounts(id),
  title text NOT NULL,
  state text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.class_workspace_members (
  workspace_id text NOT NULL REFERENCES public.class_workspaces(id),
  platform_account_id text NOT NULL REFERENCES public.platform_accounts(id),
  role text NOT NULL,
  state text NOT NULL,
  joined_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, platform_account_id)
);

CREATE TABLE public.class_workspace_invites (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES public.class_workspaces(id),
  code_sha256 text NOT NULL,
  code_hint text,
  state text NOT NULL,
  max_uses integer,
  used_count integer,
  created_by_platform_account_id text NOT NULL REFERENCES public.platform_accounts(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.class_workspace_invite_idempotency (
  platform_account_id text NOT NULL REFERENCES public.platform_accounts(id),
  workspace_id text NOT NULL REFERENCES public.class_workspaces(id),
  idempotency_key text NOT NULL,
  invite_id text REFERENCES public.class_workspace_invites(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (platform_account_id, workspace_id, idempotency_key)
);

CREATE TABLE public.class_workspace_join_idempotency (
  platform_account_id text NOT NULL REFERENCES public.platform_accounts(id),
  idempotency_key text NOT NULL,
  workspace_id text NOT NULL REFERENCES public.class_workspaces(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (platform_account_id, idempotency_key)
);

CREATE TABLE public.class_workspace_assignments (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES public.class_workspaces(id),
  title text NOT NULL,
  instructions text,
  state text NOT NULL,
  created_by_platform_account_id text NOT NULL REFERENCES public.platform_accounts(id),
  due_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.class_workspace_assignment_idempotency (
  platform_account_id text NOT NULL REFERENCES public.platform_accounts(id),
  workspace_id text NOT NULL REFERENCES public.class_workspaces(id),
  idempotency_key text NOT NULL,
  assignment_id text REFERENCES public.class_workspace_assignments(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (platform_account_id, workspace_id, idempotency_key)
);

CREATE TABLE public.class_workspace_assignment_submissions (
  assignment_id text NOT NULL REFERENCES public.class_workspace_assignments(id),
  platform_account_id text NOT NULL REFERENCES public.platform_accounts(id),
  body text,
  state text NOT NULL,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (assignment_id, platform_account_id)
);

CREATE TABLE public.class_workspace_submission_idempotency (
  platform_account_id text NOT NULL REFERENCES public.platform_accounts(id),
  assignment_id text NOT NULL REFERENCES public.class_workspace_assignments(id),
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (platform_account_id, assignment_id, idempotency_key)
);

CREATE TABLE public.class_workspace_submission_feedback_idempotency (
  assignment_id text NOT NULL REFERENCES public.class_workspace_assignments(id),
  student_platform_account_id text NOT NULL REFERENCES public.platform_accounts(id),
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (assignment_id, student_platform_account_id, idempotency_key)
);

CREATE TABLE public.class_assignment_submission_files (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES public.class_workspaces(id),
  assignment_id text NOT NULL REFERENCES public.class_workspace_assignments(id),
  platform_account_id text NOT NULL REFERENCES public.platform_accounts(id),
  original_name text NOT NULL,
  content_type text NOT NULL,
  byte_size integer NOT NULL,
  sha256 text NOT NULL DEFAULT '',
  kind text NOT NULL,
  storage_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  uploaded_at timestamptz,
  submitted_at timestamptz,
  superseded_at timestamptz,
  late boolean NOT NULL DEFAULT false
);

CREATE TABLE public.class_assignment_file_idempotency (
  actor_id text NOT NULL REFERENCES public.platform_accounts(id),
  key text NOT NULL,
  request_hash text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_id, key)
);

-- 沒有時間欄，delta 腳本必須列到 no_timestamp，不能自動補。
CREATE TABLE public.lookup_codes (
  code text PRIMARY KEY,
  label text NOT NULL
);

CREATE OR REPLACE FUNCTION public.nuni_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER class_workspaces_touch
  BEFORE UPDATE ON public.class_workspaces
  FOR EACH ROW
  EXECUTE FUNCTION public.nuni_touch_updated_at();

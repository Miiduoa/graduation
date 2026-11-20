-- 本機演練用種子。只插入 CLEANUP.md 寫明的 QA id，外加一位課班老師與一條 sequence。
INSERT INTO public.platform_accounts (id, state, display_name, primary_email)
VALUES
  ('pa_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'active', 'QA 老師', 'qa-teacher@example.test'),
  ('pa_2e7c9b14-8a5f-4d31-9c6a-0b4e8f17d2c3', 'active', 'qa-student-nocard', 'qa-student-nocard@example.test'),
  ('pa_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'active', '真實學生', 'real-student@example.test')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.class_workspaces (id, owner_platform_account_id, title, state)
VALUES ('cw_b7db89dd-4abe-4cfa-80f3-8bead74f58c2', 'pa_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'QA測試課班', 'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.class_workspace_members (workspace_id, platform_account_id, role, state)
VALUES
  ('cw_b7db89dd-4abe-4cfa-80f3-8bead74f58c2', 'pa_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'owner-teacher', 'active'),
  ('cw_b7db89dd-4abe-4cfa-80f3-8bead74f58c2', 'pa_2e7c9b14-8a5f-4d31-9c6a-0b4e8f17d2c3', 'student', 'active'),
  ('cw_b7db89dd-4abe-4cfa-80f3-8bead74f58c2', 'pa_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'student', 'active')
ON CONFLICT DO NOTHING;

INSERT INTO public.class_workspace_invites (
  id, workspace_id, code_sha256, code_hint, state, max_uses, used_count,
  created_by_platform_account_id
) VALUES (
  'cwi_2ab1b7f3-d0c8-469b-991c-2d2abf940f14',
  'cw_b7db89dd-4abe-4cfa-80f3-8bead74f58c2',
  repeat('ab', 32),
  'QA12',
  'exhausted',
  1,
  1,
  'pa_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO public.class_workspace_invite_idempotency (
  platform_account_id, workspace_id, idempotency_key, invite_id
) VALUES (
  'pa_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'cw_b7db89dd-4abe-4cfa-80f3-8bead74f58c2',
  'qa-file-smoke-invite-1',
  'cwi_2ab1b7f3-d0c8-469b-991c-2d2abf940f14'
) ON CONFLICT DO NOTHING;

INSERT INTO public.class_workspace_join_idempotency (
  platform_account_id, idempotency_key, workspace_id
) VALUES (
  'pa_2e7c9b14-8a5f-4d31-9c6a-0b4e8f17d2c3',
  'qa-file-smoke-join-1',
  'cw_b7db89dd-4abe-4cfa-80f3-8bead74f58c2'
) ON CONFLICT DO NOTHING;

INSERT INTO public.class_workspace_assignments (
  id, workspace_id, title, instructions, state, created_by_platform_account_id, due_at
) VALUES (
  'cwa_b5d32f94-a23a-4df5-899c-a070d63d2ec1',
  'cw_b7db89dd-4abe-4cfa-80f3-8bead74f58c2',
  'QA 拍照傳檔測試作業',
  '僅供清理演練，非正式繳交。',
  'open',
  'pa_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  TIMESTAMPTZ '2026-10-29 15:59:00+00'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO public.class_workspace_assignment_idempotency (
  platform_account_id, workspace_id, idempotency_key, assignment_id
) VALUES (
  'pa_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'cw_b7db89dd-4abe-4cfa-80f3-8bead74f58c2',
  'qa-file-smoke-assignment-1',
  'cwa_b5d32f94-a23a-4df5-899c-a070d63d2ec1'
) ON CONFLICT DO NOTHING;

INSERT INTO public.class_workspace_assignment_submissions (
  assignment_id, platform_account_id, body, state
) VALUES (
  'cwa_b5d32f94-a23a-4df5-899c-a070d63d2ec1',
  'pa_2e7c9b14-8a5f-4d31-9c6a-0b4e8f17d2c3',
  '（附檔繳交）',
  'submitted'
) ON CONFLICT DO NOTHING;

INSERT INTO public.class_workspace_submission_idempotency (
  platform_account_id, assignment_id, idempotency_key
) VALUES
  ('pa_2e7c9b14-8a5f-4d31-9c6a-0b4e8f17d2c3', 'cwa_b5d32f94-a23a-4df5-899c-a070d63d2ec1', 'qa-file-smoke-submit-1'),
  ('pa_2e7c9b14-8a5f-4d31-9c6a-0b4e8f17d2c3', 'cwa_b5d32f94-a23a-4df5-899c-a070d63d2ec1', 'qa-file-smoke-submit-2')
ON CONFLICT DO NOTHING;

INSERT INTO public.class_assignment_submission_files (
  id, workspace_id, assignment_id, platform_account_id, original_name, content_type,
  byte_size, sha256, kind, storage_key, submitted_at, superseded_at
) VALUES
  (
    'cwf_ea17f0d4-0000-4000-8000-000000000001',
    'cw_b7db89dd-4abe-4cfa-80f3-8bead74f58c2',
    'cwa_b5d32f94-a23a-4df5-899c-a070d63d2ec1',
    'pa_2e7c9b14-8a5f-4d31-9c6a-0b4e8f17d2c3',
    'old.jpg', 'image/jpeg', 12, repeat('a', 64), 'image',
    'cw_b7db89dd-4abe-4cfa-80f3-8bead74f58c2/cwa_b5d32f94-a23a-4df5-899c-a070d63d2ec1/old.jpg',
    now(), now()
  ),
  (
    'cwf_31a64f77-0000-4000-8000-000000000002',
    'cw_b7db89dd-4abe-4cfa-80f3-8bead74f58c2',
    'cwa_b5d32f94-a23a-4df5-899c-a070d63d2ec1',
    'pa_2e7c9b14-8a5f-4d31-9c6a-0b4e8f17d2c3',
    'new.jpg', 'image/jpeg', 24, repeat('b', 64), 'image',
    'cw_b7db89dd-4abe-4cfa-80f3-8bead74f58c2/cwa_b5d32f94-a23a-4df5-899c-a070d63d2ec1/new.jpg',
    now(), NULL
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.class_assignment_file_idempotency (actor_id, key, request_hash, payload)
VALUES
  ('pa_2e7c9b14-8a5f-4d31-9c6a-0b4e8f17d2c3', 'smoke-01', repeat('c', 64), '{}'::jsonb),
  ('pa_2e7c9b14-8a5f-4d31-9c6a-0b4e8f17d2c3', 'smoke-02', repeat('d', 64), '{}'::jsonb),
  ('pa_2e7c9b14-8a5f-4d31-9c6a-0b4e8f17d2c3', 'smoke-03', repeat('e', 64), '{}'::jsonb),
  ('pa_2e7c9b14-8a5f-4d31-9c6a-0b4e8f17d2c3', 'smoke-04', repeat('f', 64), '{}'::jsonb)
ON CONFLICT DO NOTHING;

INSERT INTO public.class_workspace_assignments (
  id, workspace_id, title, instructions, state, created_by_platform_account_id, due_at
) VALUES (
  'cwa_cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  'cw_b7db89dd-4abe-4cfa-80f3-8bead74f58c2',
  '週三小考',
  '真實作業，清理時必須留下。',
  'open',
  'pa_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  TIMESTAMPTZ '2026-11-05 15:59:00+00'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO public.class_workspace_assignment_submissions (
  assignment_id, platform_account_id, body, state
) VALUES (
  'cwa_cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  'pa_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  '真實學生的繳交，不可刪。',
  'submitted'
) ON CONFLICT DO NOTHING;

INSERT INTO public.lookup_codes (code, label)
VALUES ('keep-me', 'no timestamp table')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.schema_migrations (id, checksum)
VALUES
  ('279_personal_import_sync', repeat('1', 64)),
  ('280_assignment_submission_files', repeat('2', 64))
ON CONFLICT (id) DO NOTHING;

CREATE SEQUENCE IF NOT EXISTS public.rehearsal_only_seq;
SELECT setval('public.rehearsal_only_seq', 42, true);

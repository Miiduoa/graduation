-- QA 測試資料清理。條件全部綁精確 id 或明確 QA 帳號＋key 前綴。
-- 不會刪課班本身、不會刪老師成員、不會刪 product-qa session。
-- 由 qa-cleanup.sh 包在一個 transaction 裡：list 只讀後 ROLLBACK；apply 核對後 COMMIT。

\set ON_ERROR_STOP on
SELECT CASE WHEN :'apply' = '1' THEN 1 ELSE 0 END AS do_apply
\gset
\if :do_apply
SET LOCAL lock_timeout = '5s';
LOCK TABLE public.class_workspaces, public.class_workspace_assignments,
  public.class_workspace_members, public.class_workspace_invites,
  public.class_workspace_assignment_submissions, public.class_assignment_submission_files,
  public.class_assignment_file_idempotency, public.class_workspace_submission_feedback_idempotency,
  public.class_workspace_submission_idempotency, public.class_workspace_assignment_idempotency,
  public.class_workspace_join_idempotency, public.class_workspace_invite_idempotency
  IN SHARE ROW EXCLUSIVE MODE;
\endif

-- 固定識別。改這裡等於改清理範圍，不要用模糊搜尋。
SELECT
  'cw_b7db89dd-4abe-4cfa-80f3-8bead74f58c2'::text AS workspace_id,
  'cwa_b5d32f94-a23a-4df5-899c-a070d63d2ec1'::text AS assignment_id,
  'cwi_2ab1b7f3-d0c8-469b-991c-2d2abf940f14'::text AS invite_id,
  'pa_2e7c9b14-8a5f-4d31-9c6a-0b4e8f17d2c3'::text AS student_id,
  'QA 拍照傳檔測試作業'::text AS assignment_title
\gset

-- 作業標題對不上就停，避免 id 被重複使用時誤刪。
SELECT CASE
  WHEN EXISTS (
    SELECT 1 FROM public.class_workspace_assignments
     WHERE id = :'assignment_id'
       AND workspace_id = :'workspace_id'
       AND title = :'assignment_title'
  ) THEN 1
  WHEN NOT EXISTS (
    SELECT 1 FROM public.class_workspace_assignments WHERE id = :'assignment_id'
  ) THEN 1
  ELSE 0
END AS assignment_title_ok
\gset
SELECT 1 / :assignment_title_ok AS assignment_title_guard;

-- 若這份 QA 作業上還有其他學生的繳交／檔案，停止。預設 FK 是 NO ACTION，
-- 沒有這道檢查也可能刪失敗；有 CASCADE 時沒檢查會連帶刪掉別人的資料。
SELECT CASE WHEN NOT EXISTS (
  SELECT 1 FROM public.class_workspace_assignment_submissions
   WHERE assignment_id = :'assignment_id'
     AND platform_account_id <> :'student_id'
) AND NOT EXISTS (
  SELECT 1 FROM public.class_assignment_submission_files
   WHERE assignment_id = :'assignment_id'
     AND platform_account_id <> :'student_id'
) THEN 1 ELSE 0 END AS other_student_ok
\gset
SELECT 1 / :other_student_ok AS other_student_guard;

SELECT count(*) AS other_assignments_before
  FROM public.class_workspace_assignments
 WHERE workspace_id = :'workspace_id'
   AND id <> :'assignment_id'
\gset

SELECT count(*) AS teacher_members_before
  FROM public.class_workspace_members
 WHERE workspace_id = :'workspace_id'
   AND role = 'owner-teacher'
\gset

CREATE TEMP TABLE qa_preview (
  relation text PRIMARY KEY,
  row_count bigint NOT NULL,
  sample jsonb NOT NULL,
  fingerprint text NOT NULL
);

INSERT INTO qa_preview
SELECT 'class_assignment_file_idempotency', count(*), coalesce(jsonb_agg(jsonb_build_object('actor_id', actor_id, 'key', key)), '[]'::jsonb),
       encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(target) ORDER BY to_jsonb(target)::text), '[]'::jsonb)::text, 'UTF8')), 'hex')
  FROM public.class_assignment_file_idempotency AS target
 WHERE actor_id = :'student_id'
   AND (key LIKE 'smoke-%' OR key LIKE 'qa-file-smoke-%');

INSERT INTO qa_preview
SELECT 'class_assignment_submission_files', count(*), coalesce(jsonb_agg(jsonb_build_object('id', id, 'storage_key', storage_key)), '[]'::jsonb),
       encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(target) ORDER BY to_jsonb(target)::text), '[]'::jsonb)::text, 'UTF8')), 'hex')
  FROM public.class_assignment_submission_files AS target
 WHERE assignment_id = :'assignment_id'
   AND workspace_id = :'workspace_id'
   AND platform_account_id = :'student_id';

INSERT INTO qa_preview
SELECT 'class_workspace_submission_feedback_idempotency', count(*), coalesce(jsonb_agg(jsonb_build_object('idempotency_key', idempotency_key)), '[]'::jsonb),
       encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(target) ORDER BY to_jsonb(target)::text), '[]'::jsonb)::text, 'UTF8')), 'hex')
  FROM public.class_workspace_submission_feedback_idempotency AS target
 WHERE assignment_id = :'assignment_id'
   AND student_platform_account_id = :'student_id';

INSERT INTO qa_preview
SELECT 'class_workspace_submission_idempotency', count(*), coalesce(jsonb_agg(jsonb_build_object('idempotency_key', idempotency_key)), '[]'::jsonb),
       encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(target) ORDER BY to_jsonb(target)::text), '[]'::jsonb)::text, 'UTF8')), 'hex')
  FROM public.class_workspace_submission_idempotency AS target
 WHERE assignment_id = :'assignment_id'
   AND platform_account_id = :'student_id';

INSERT INTO qa_preview
SELECT 'class_workspace_assignment_submissions', count(*), coalesce(jsonb_agg(jsonb_build_object('platform_account_id', platform_account_id, 'body', left(body, 40))), '[]'::jsonb),
       encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(target) ORDER BY to_jsonb(target)::text), '[]'::jsonb)::text, 'UTF8')), 'hex')
  FROM public.class_workspace_assignment_submissions AS target
 WHERE assignment_id = :'assignment_id'
   AND platform_account_id = :'student_id';

INSERT INTO qa_preview
SELECT 'class_workspace_assignment_idempotency', count(*), coalesce(jsonb_agg(jsonb_build_object('idempotency_key', idempotency_key)), '[]'::jsonb),
       encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(target) ORDER BY to_jsonb(target)::text), '[]'::jsonb)::text, 'UTF8')), 'hex')
  FROM public.class_workspace_assignment_idempotency AS target
 WHERE assignment_id = :'assignment_id'
   AND workspace_id = :'workspace_id'
   AND idempotency_key LIKE 'qa-file-smoke-assignment-%';

INSERT INTO qa_preview
SELECT 'class_workspace_assignments', count(*), coalesce(jsonb_agg(jsonb_build_object('id', id, 'title', title)), '[]'::jsonb),
       encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(target) ORDER BY to_jsonb(target)::text), '[]'::jsonb)::text, 'UTF8')), 'hex')
  FROM public.class_workspace_assignments AS target
 WHERE id = :'assignment_id'
   AND workspace_id = :'workspace_id'
   AND title = :'assignment_title';

INSERT INTO qa_preview
SELECT 'class_workspace_members', count(*), coalesce(jsonb_agg(jsonb_build_object('platform_account_id', platform_account_id, 'role', role)), '[]'::jsonb),
       encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(target) ORDER BY to_jsonb(target)::text), '[]'::jsonb)::text, 'UTF8')), 'hex')
  FROM public.class_workspace_members AS target
 WHERE workspace_id = :'workspace_id'
   AND platform_account_id = :'student_id'
   AND role = 'student';

INSERT INTO qa_preview
SELECT 'class_workspace_join_idempotency', count(*), coalesce(jsonb_agg(jsonb_build_object('idempotency_key', idempotency_key)), '[]'::jsonb),
       encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(target) ORDER BY to_jsonb(target)::text), '[]'::jsonb)::text, 'UTF8')), 'hex')
  FROM public.class_workspace_join_idempotency AS target
 WHERE workspace_id = :'workspace_id'
   AND platform_account_id = :'student_id'
   AND idempotency_key LIKE 'qa-file-smoke-join-%';

INSERT INTO qa_preview
SELECT 'class_workspace_invite_idempotency', count(*), coalesce(jsonb_agg(jsonb_build_object('idempotency_key', idempotency_key, 'invite_id', invite_id)), '[]'::jsonb),
       encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(target) ORDER BY to_jsonb(target)::text), '[]'::jsonb)::text, 'UTF8')), 'hex')
  FROM public.class_workspace_invite_idempotency AS target
 WHERE invite_id = :'invite_id'
   AND workspace_id = :'workspace_id'
   AND idempotency_key LIKE 'qa-file-smoke-invite-%';

INSERT INTO qa_preview
SELECT 'class_workspace_invites', count(*), coalesce(jsonb_agg(jsonb_build_object('id', id, 'state', state, 'max_uses', max_uses)), '[]'::jsonb),
       encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(target) ORDER BY to_jsonb(target)::text), '[]'::jsonb)::text, 'UTF8')), 'hex')
  FROM public.class_workspace_invites AS target
 WHERE id = :'invite_id'
   AND workspace_id = :'workspace_id';

\echo ===qa_preview===
SELECT relation, row_count, sample FROM qa_preview ORDER BY relation;

-- Bind every selected row (including full body/metadata) to the reviewed receipt.
SELECT encode(sha256(convert_to(string_agg(relation || ':' || row_count || ':' || fingerprint, ',' ORDER BY relation), 'UTF8')), 'hex') AS preview_digest
FROM qa_preview
\gset
\echo QA_PREVIEW_DIGEST :preview_digest

-- apply=1 時才刪；持有鎖時重新核對完整指紋，過期 receipt 必須中止。
\if :do_apply
SELECT CASE WHEN :'preview_digest' = :'expected_preview_digest' THEN 1 ELSE 0 END AS receipt_matches
\gset
SELECT 1 / :receipt_matches AS receipt_guard;
DELETE FROM public.class_assignment_file_idempotency
 WHERE actor_id = :'student_id'
   AND (key LIKE 'smoke-%' OR key LIKE 'qa-file-smoke-%');

DELETE FROM public.class_assignment_submission_files
 WHERE assignment_id = :'assignment_id'
   AND workspace_id = :'workspace_id'
   AND platform_account_id = :'student_id';

DELETE FROM public.class_workspace_submission_feedback_idempotency
 WHERE assignment_id = :'assignment_id'
   AND student_platform_account_id = :'student_id';

DELETE FROM public.class_workspace_submission_idempotency
 WHERE assignment_id = :'assignment_id'
   AND platform_account_id = :'student_id';

DELETE FROM public.class_workspace_assignment_submissions
 WHERE assignment_id = :'assignment_id'
   AND platform_account_id = :'student_id';

DELETE FROM public.class_workspace_assignment_idempotency
 WHERE assignment_id = :'assignment_id'
   AND workspace_id = :'workspace_id'
   AND idempotency_key LIKE 'qa-file-smoke-assignment-%';

DELETE FROM public.class_workspace_assignments
 WHERE id = :'assignment_id'
   AND workspace_id = :'workspace_id'
   AND title = :'assignment_title';

DELETE FROM public.class_workspace_members
 WHERE workspace_id = :'workspace_id'
   AND platform_account_id = :'student_id'
   AND role = 'student';

DELETE FROM public.class_workspace_join_idempotency
 WHERE workspace_id = :'workspace_id'
   AND platform_account_id = :'student_id'
   AND idempotency_key LIKE 'qa-file-smoke-join-%';

DELETE FROM public.class_workspace_invite_idempotency
 WHERE invite_id = :'invite_id'
   AND workspace_id = :'workspace_id'
   AND idempotency_key LIKE 'qa-file-smoke-invite-%';

DELETE FROM public.class_workspace_invites
 WHERE id = :'invite_id'
   AND workspace_id = :'workspace_id';

-- 刪完必須是 0。課班列必須還在。其他作業與老師成員數量不得變。
SELECT 1 / CASE WHEN EXISTS (SELECT 1 FROM public.class_workspaces WHERE id = :'workspace_id') THEN 1 ELSE 0 END;
SELECT 1 / CASE WHEN NOT EXISTS (SELECT 1 FROM public.class_workspace_assignments WHERE id = :'assignment_id') THEN 1 ELSE 0 END;
SELECT 1 / CASE WHEN NOT EXISTS (
  SELECT 1 FROM public.class_workspace_members
   WHERE workspace_id = :'workspace_id' AND platform_account_id = :'student_id'
) THEN 1 ELSE 0 END;
SELECT 1 / CASE WHEN (
  SELECT count(*) FROM public.class_workspace_assignments
   WHERE workspace_id = :'workspace_id' AND id <> :'assignment_id'
) = :other_assignments_before THEN 1 ELSE 0 END;
SELECT 1 / CASE WHEN (
  SELECT count(*) FROM public.class_workspace_members
   WHERE workspace_id = :'workspace_id' AND role = 'owner-teacher'
) = :teacher_members_before AND :teacher_members_before >= 1 THEN 1 ELSE 0 END;
\endif

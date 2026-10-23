-- Contract-level privilege checks run on each fresh, upgrade and reset database.
-- Behavioral role/RLS tests live in api.test.mjs; this matrix also makes a newly
-- introduced public relation fail until its exposure is explicitly reviewed.
\set ON_ERROR_STOP on
begin;
create temporary table expected_access (
  name text primary key, kind text, anon text, authenticated text, service_role text
) on commit drop;
insert into expected_access values
  ('profiles', 'r', '', 'SU', 'SU'),
  ('courses', 'r', '', 'SIUD', 'S'),
  ('course_members', 'r', '', 'SIUD', ''),
  ('course_materials', 'r', '', 'SIUD', 'S'),
  ('announcements', 'r', '', 'SIUD', ''),
  ('assignments', 'r', '', 'SIUD', 'S'),
  ('submissions', 'r', '', 'SIU', ''),
  ('quizzes', 'r', '', 'SIUD', 'S'),
  ('quiz_questions', 'r', '', 'SIUD', ''),
  ('quiz_question_solutions', 'r', '', 'SIUD', ''),
  ('quiz_attempts', 'r', '', 'S', ''),
  ('quiz_answers', 'r', '', 'SIUD', ''),
  ('forum_topics', 'r', '', 'SIUD', ''),
  ('forum_posts', 'r', '', 'SIUD', ''),
  ('grade_categories', 'r', '', 'SIUD', ''),
  ('grade_items', 'r', '', 'SIUD', ''),
  ('grade_scores', 'r', '', 'SIUD', ''),
  ('live_sessions', 'r', '', 'SIUD', ''),
  ('live_buzzer_state', 'r', '', 'SIUD', ''),
  ('live_attendance', 'r', '', 'SUD', ''),
  ('live_chat_messages', 'r', '', 'SI', ''),
  ('notifications', 'r', '', 'SUD', 'SU'),
  ('push_tokens', 'r', '', 'SIUD', 'S'),
  ('material_progress', 'r', '', 'SIUD', ''),
  ('forum_reports', 'r', '', 'SIU', ''),
  ('forum_post_edits', 'r', '', 'S', ''),
  ('audit_logs', 'r', '', 'S', ''),
  ('ai_usage_daily', 'r', '', 'S', ''),
  ('quiz_pool_entries', 'r', '', 'SIUD', ''),
  ('course_question_bank', 'r', '', 'SIUD', ''),
  ('notification_push_logs', 'r', '', 'S', 'I'),
  ('course_role_capabilities', 'r', '', 'S', ''),
  ('material_ai_enrichment', 'r', '', 'SIU', ''),
  ('alert_dispatch_outbox', 'r', '', 'S', ''),
  ('report_export_jobs', 'r', '', 'SI', ''),
  ('ai_compliance_policies', 'r', '', 'SIUD', ''),
  ('ai_consent_log', 'r', '', 'S', ''),
  ('media_play_tokens', 'r', '', 'S', ''),
  ('course_units', 'r', '', 'SIUD', 'S'),
  ('course_unit_items', 'r', '', 'SIUD', ''),
  ('calendar_events', 'r', '', 'SIUD', ''),
  ('course_groups', 'r', '', 'SIUD', ''),
  ('course_group_members', 'r', '', 'SIUD', ''),
  ('peer_review_assignments', 'r', '', 'SIUD', ''),
  ('peer_review_pairs', 'r', '', 'SIUD', ''),
  ('peer_review_responses', 'r', '', 'S', ''),
  ('surveys', 'r', '', 'SIUD', ''),
  ('survey_questions', 'r', '', 'SIUD', ''),
  ('survey_responses', 'r', '', 'S', ''),
  ('course_badges', 'r', '', 'SIUD', ''),
  ('course_badge_awards', 'r', '', 'SID', ''),
  ('scorm_packages', 'r', '', 'SIUD', ''),
  ('scorm_attempts', 'r', '', 'SIU', ''),
  ('xapi_statements', 'r', '', 'S', ''),
  ('lti_tools', 'r', '', 'SIUD', ''),
  ('lti_resource_links', 'r', '', 'SIUD', ''),
  ('lti_launches', 'r', '', 'SI', ''),
  ('rubrics', 'r', '', 'SIUD', ''),
  ('rubric_criteria', 'r', '', 'SIUD', ''),
  ('rubric_scores', 'r', '', 'S', ''),
  ('material_notes', 'r', '', 'SIUD', ''),
  ('material_bookmarks', 'r', '', 'SIUD', ''),
  ('material_versions', 'r', '', 'SIUD', ''),
  ('material_chapter_markers', 'r', '', 'SIUD', ''),
  ('course_meetings', 'r', '', 'SIUD', ''),
  ('livestream_sessions', 'r', '', 'SIUD', ''),
  ('learning_time_entries', 'r', '', 'S', ''),
  ('course_export_packages', 'r', '', 'SI', ''),
  ('badge_issuer_config', 'r', '', 'SIUD', ''),
  ('badge_assertions', 'r', '', 'S', ''),
  ('html_sanitize_policy', 'r', '', 'SIUD', ''),
  ('material_previews', 'r', '', 'SIUD', ''),
  ('whiteboard_sessions', 'r', '', 'SIUD', ''),
  ('whiteboard_annotations', 'r', '', 'SID', ''),
  ('announcement_reads', 'r', '', 'S', ''),
  ('course_tags', 'r', '', 'SIUD', ''),
  ('course_material_tag_map', 'r', '', 'SIUD', ''),
  ('teacher_private_notes', 'r', '', 'SIUD', ''),
  ('course_feedback', 'r', '', 'SI', ''),
  ('grade_approval_requests', 'r', '', 'SIU', ''),
  ('enrollment_history', 'r', '', 'S', ''),
  ('webhook_subscriptions', 'r', '', 'SIUD', ''),
  ('webhook_deliveries', 'r', '', 'S', ''),
  ('material_offline_packs', 'r', '', 'SIUD', ''),
  ('material_offline_downloads', 'r', '', 'SI', ''),
  ('academic_terms', 'r', '', 'SIUD', ''),
  ('departments', 'r', '', 'SIUD', ''),
  ('course_sections', 'r', '', 'SIUD', ''),
  ('course_prerequisites', 'r', '', 'SIUD', ''),
  ('course_subscriptions', 'r', '', 'SID', ''),
  ('quiz_proctor_settings', 'r', '', 'SIUD', ''),
  ('quiz_proctor_events', 'r', '', 'SI', ''),
  ('ai_chat_threads', 'r', '', 'SIUD', ''),
  ('ai_chat_messages', 'r', '', 'SIUD', ''),
  ('material_ai_summary', 'r', '', 'S', ''),
  ('push_notification_preferences', 'r', '', 'SIUD', ''),
  ('user_favorites', 'r', '', 'SIUD', ''),
  ('email_digest_preferences', 'r', '', 'SIUD', ''),
  ('program_outcomes', 'r', '', 'SIUD', ''),
  ('course_outcomes', 'r', '', 'SIUD', ''),
  ('outcome_item_map', 'r', '', 'SIUD', ''),
  ('teacher_office_hours', 'r', '', 'SIUD', ''),
  ('office_hour_bookings', 'r', '', 'SIU', ''),
  ('course_grade_rollups', 'v', '', 'S', ''),
  ('reporting_grade_course_item_scores', 'v', '', 'S', ''),
  ('reporting_push_dispatch_retry_curve', 'v', '', 'S', ''),
  ('reporting_quiz_overview', 'v', '', 'S', ''),
  ('reporting_live_attendance_overview', 'v', '', 'S', ''),
  ('reporting_course_engagement_7d', 'm', '', '', ''),
  ('reporting_ai_quota_overview', 'v', '', 'S', ''),
  ('reporting_student_dashboard', 'v', '', 'S', ''),
  ('reporting_learning_time_monthly', 'v', '', 'S', ''),
  ('reporting_teacher_workload', 'v', '', 'S', ''),
  ('reporting_course_leaderboard', 'v', '', 'S', ''),
  ('reporting_announcement_read_ratio', 'v', '', 'S', ''),
  ('public_course_catalog', 'v', 'S', 'S', ''),
  ('reporting_at_risk_students', 'v', '', 'S', ''),
  ('reporting_participation_score', 'v', '', 'S', ''),
  ('course_search_index', 'v', '', 'S', '');

do $$
declare
  expected record;
  privilege record;
  role_name text;
  allowed text;
  actual boolean;
  checks integer := 0;
begin
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm')
      and not exists (select 1 from expected_access e where e.name = c.relname)
  ) then
    raise exception 'Unreviewed public table/view: update the access inventory and add behavior tests';
  end if;
  for expected in select * from expected_access loop
    if not exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = expected.name and c.relkind::text = expected.kind
    ) then
      raise exception 'Missing or changed public relation: %', expected.name;
    end if;
    if expected.kind = 'r' and not (
      select relrowsecurity from pg_class where oid = format('public.%I', expected.name)::regclass
    ) then
      raise exception 'RLS is disabled for public.%', expected.name;
    end if;
    foreach role_name in array array['anon', 'authenticated', 'service_role'] loop
      allowed := case role_name when 'anon' then expected.anon when 'authenticated' then expected.authenticated else expected.service_role end;
      for privilege in select * from (values
        ('SELECT', 'S'), ('INSERT', 'I'), ('UPDATE', 'U'), ('DELETE', 'D'),
        ('TRUNCATE', 'T'), ('REFERENCES', 'R'), ('TRIGGER', 'G')
      ) p(name, code) loop
        actual := has_table_privilege(role_name, format('public.%I', expected.name), privilege.name);
        if actual is distinct from (position(privilege.code in allowed) > 0) then
          raise exception 'Unexpected ACL: %.% % = % (expected %)', role_name, expected.name, privilege.name, actual, position(privilege.code in allowed) > 0;
        end if;
        checks := checks + 1;
      end loop;
      if current_setting('server_version_num')::integer >= 170000
         and has_table_privilege(role_name, format('public.%I', expected.name), 'MAINTAIN') then
        raise exception 'Unexpected MAINTAIN grant on %.%', role_name, expected.name;
      end if;
    end loop;
    if expected.kind = 'v' and expected.name <> 'public_course_catalog' and not exists (
      select 1 from pg_class where oid = format('public.%I', expected.name)::regclass
        and 'security_invoker=true' = any(coalesce(reloptions, array[]::text[]))
    ) then
      raise exception 'Private view bypasses caller RLS: %', expected.name;
    end if;
  end loop;
  if not exists (
    select 1 from pg_class where oid = 'public.public_course_catalog'::regclass
      and 'security_barrier=true' = any(reloptions)
      and 'security_invoker=false' = any(reloptions)
  ) then raise exception 'Public catalog must retain its deliberate restricted projection'; end if;
  if exists (
    select 1 from pg_policy
    where polrelid = 'public.grade_scores'::regclass
      and polname in ('grade_scores_insert_student_own_quiz', 'grade_scores_update_student_own_quiz')
  ) then raise exception 'Students must use validated quiz scoring, not direct gradebook writes'; end if;
  raise notice 'Passed % role/object/operation ACL assertions across % relations', checks, (select count(*) from expected_access);
end $$;

-- All application routines have explicit exposure. Triggers/internal helpers
-- remain owner-only, and extension functions are outside this application list.
create temporary table expected_functions(signature text, authenticated boolean, service_role boolean) on commit drop;
insert into expected_functions values
  ('public._quiz_answer_correct(text,jsonb,jsonb)', false, false),
  ('public._quiz_normalize_answer(text,jsonb)', false, false),
  ('public.add_owner_as_course_teacher()', false, false),
  ('public.admin_ai_quota_overview()', true, false),
  ('public.admin_bulk_cancel_notification_dispatch(uuid[])', true, false),
  ('public.admin_bulk_retry_notification_dispatch(uuid[])', true, false),
  ('public.admin_bulk_set_course_role_capabilities(jsonb)', true, false),
  ('public.admin_course_engagement_7d()', true, false),
  ('public.admin_dlq_summary()', true, false),
  ('public.admin_purge_expired_ai()', true, false),
  ('public.admin_purge_expired_dlq()', true, false),
  ('public.admin_push_retry_curve(integer)', true, false),
  ('public.admin_retry_notification_dispatch(uuid)', true, false),
  ('public.admin_set_course_role_capability(text,text,boolean)', true, false),
  ('public.admin_teacher_workload()', true, false),
  ('public.apply_late_penalty(uuid)', true, false),
  ('public.audit_forum_posts_touch()', false, false),
  ('public.audit_grade_scores_touch()', false, false),
  ('public.auto_assign_course_groups(uuid,integer)', true, false),
  ('public.auto_pair_peer_review(uuid)', true, false),
  ('public.bulk_import_course_members(uuid,jsonb)', true, false),
  ('public.claim_live_buzzer(uuid)', true, false),
  ('public.consume_media_play_token(text,text)', true, false),
  ('public.course_export_jobs_claim_next()', false, true),
  ('public.course_export_jobs_complete(uuid,text,text,jsonb,text)', false, true),
  ('public.course_member_has_capability(uuid,text)', true, false),
  ('public.course_members_audit_touch()', false, false),
  ('public.decide_grade_approval(uuid,text,text)', true, false),
  ('public.duplicate_course(uuid,text)', true, false),
  ('public.enqueue_webhook_event(text,jsonb)', false, true),
  ('public.enroll_by_code(text)', true, false),
  ('public.forum_posts_audit_edit()', false, false),
  ('public.handle_new_user()', false, false),
  ('public.import_bank_questions_to_quiz(uuid,uuid[],boolean)', true, false),
  ('public.increment_ai_usage(uuid)', false, true),
  ('public.is_course_member(uuid)', true, false),
  ('public.is_course_moderator(uuid)', true, false),
  ('public.is_course_staff(uuid)', true, false),
  ('public.is_course_teacher(uuid)', true, false),
  ('public.is_platform_admin()', true, false),
  ('public.issue_media_play_token(uuid,text,integer)', true, false),
  ('public.mark_announcement_read(uuid)', true, false),
  ('public.material_ai_enrichment_apply_policy()', false, false),
  ('public.maybe_auto_award_badges(uuid)', true, false),
  ('public.my_calendar_events(timestamp with time zone,timestamp with time zone)', true, false),
  ('public.my_course_capabilities(uuid)', true, false),
  ('public.my_course_rank(uuid)', true, false),
  ('public.my_dashboard()', true, false),
  ('public.notify_course_members(uuid,text,text)', true, false),
  ('public.pick_random_student(uuid)', true, false),
  ('public.protect_profile_role()', false, false),
  ('public.protect_quiz_answer_grading()', false, false),
  ('public.protect_submission_grading()', false, false),
  ('public.push_notification_abandon_alert()', false, false),
  ('public.quiz_attempts_before_insert_guard()', false, false),
  ('public.quiz_pool_entry_same_quiz()', false, false),
  ('public.record_ai_consent(text,text,boolean,text,text)', true, false),
  ('public.record_learning_time(uuid,text,uuid,integer)', true, false),
  ('public.record_live_attendance(uuid)', true, false),
  ('public.record_xapi_statement(uuid,text,text,jsonb,jsonb)', true, false),
  ('public.refresh_reporting_course_engagement_7d()', true, false),
  ('public.reorder_course_units(uuid,uuid[])', true, false),
  ('public.report_export_jobs_claim_next()', false, true),
  ('public.report_export_jobs_complete(uuid,text,text,integer,text)', false, true),
  ('public.revoke_media_play_tokens(uuid,uuid)', true, false),
  ('public.search_course(uuid,text)', true, false),
  ('public.set_quiz_manual_score(uuid,uuid,numeric)', true, false),
  ('public.set_updated_at()', false, false),
  ('public.snapshot_material_on_update()', false, false),
  ('public.start_quiz_attempt(uuid)', true, false),
  ('public.submit_peer_review(uuid,jsonb,text)', true, false),
  ('public.submit_quiz_attempt(uuid)', true, false),
  ('public.submit_rubric_score(uuid,text,uuid,jsonb,text)', true, false),
  ('public.submit_survey_response(uuid,jsonb)', true, false),
  ('public.sync_assignment_calendar()', false, false),
  ('public.sync_quiz_gradebook_from_attempt(uuid)', true, false),
  ('public.user_meets_course_prerequisites(uuid)', true, false),
  ('public.webhook_badge_awarded()', false, false),
  ('public.webhook_deliveries_claim_next()', false, true),
  ('public.webhook_deliveries_mark(uuid,integer,text,boolean,boolean)', false, true),
  ('public.webhook_grade_score_changed()', false, false);
do $$
declare f record;
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and not exists (select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e')
      and not exists (select 1 from expected_functions e where e.signature::regprocedure=p.oid)
  ) then raise exception 'Unreviewed public application function'; end if;
  for f in select * from expected_functions loop
    if has_function_privilege('anon',f.signature,'EXECUTE')
       or has_function_privilege('authenticated',f.signature,'EXECUTE') is distinct from f.authenticated
       or has_function_privilege('service_role',f.signature,'EXECUTE') is distinct from f.service_role then
      raise exception 'Unexpected routine ACL: %',f.signature;
    end if;
  end loop;
  raise notice 'Passed 243 application function-role ACL assertions';
end $$;

-- Worker mutation RPCs must not inherit EXECUTE through PUBLIC or the old
-- explicit authenticated grants. A profile-admin JWT is still authenticated.
do $$
declare
  signature text;
begin
  foreach signature in array array[
    'public.report_export_jobs_claim_next()',
    'public.report_export_jobs_complete(uuid,text,text,integer,text)',
    'public.course_export_jobs_claim_next()',
    'public.course_export_jobs_complete(uuid,text,text,jsonb,text)',
    'public.webhook_deliveries_claim_next()',
    'public.webhook_deliveries_mark(uuid,integer,text,boolean,boolean)',
    'public.enqueue_webhook_event(text,jsonb)'
  ] loop
    if has_function_privilege('anon', signature, 'EXECUTE')
       or has_function_privilege('authenticated', signature, 'EXECUTE')
       or not has_function_privilege('service_role', signature, 'EXECUTE') then
      raise exception 'Unexpected worker RPC exposure: %', signature;
    end if;
  end loop;
end $$;

-- Exercise the NULL-claim guard itself, separately from the function ACL.
-- Only request.jwt.claims is used by current PostgREST; a missing role must fail.
set local role service_role;
select set_config('request.jwt.claims', '{}', true);
select set_config('request.jwt.claim.role', '', true);
do $$
begin
  begin
    perform public.course_export_jobs_claim_next();
    raise exception 'Missing JWT role incorrectly claimed a course export';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.report_export_jobs_claim_next();
    raise exception 'Missing JWT role incorrectly claimed a report export';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.webhook_deliveries_claim_next();
    raise exception 'Missing JWT role incorrectly claimed a webhook';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
rollback;
\echo '119 relation ACLs, RLS metadata, private views and worker boundaries passed'

-- Explicit Data API privileges for the 2026-10-30 Supabase default change.
-- Existing installations and fresh resets converge to the same reviewed ACLs.
-- Review matrix: docs/SUPABASE_DATA_API_PERMISSIONS.md.
-- Do not grant ALL TABLES or restore permissive default privileges.

begin;

-- BYPASSRLS does not replace schema/table privileges for service_role.
grant usage on schema public to anon, authenticated, service_role;

-- profiles: Auth trigger creates profiles. Service UPDATE is retained for trusted role administration; the role-protection trigger blocks self-promotion.
revoke all privileges on table public.profiles from public, anon, authenticated, service_role;
grant select, update on table public.profiles to authenticated;
grant select, update on table public.profiles to service_role;

revoke all privileges on table public.courses from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.courses to authenticated;
grant select on table public.courses to service_role;

revoke all privileges on table public.course_members from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.course_members to authenticated;

revoke all privileges on table public.course_materials from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.course_materials to authenticated;
grant select on table public.course_materials to service_role;

revoke all privileges on table public.announcements from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.announcements to authenticated;

revoke all privileges on table public.assignments from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.assignments to authenticated;
grant select on table public.assignments to service_role;

revoke all privileges on table public.submissions from public, anon, authenticated, service_role;
grant select, insert, update on table public.submissions to authenticated;

revoke all privileges on table public.quizzes from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.quizzes to authenticated;
grant select on table public.quizzes to service_role;

revoke all privileges on table public.quiz_questions from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.quiz_questions to authenticated;

revoke all privileges on table public.quiz_question_solutions from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.quiz_question_solutions to authenticated;

-- quiz_attempts: Create/score attempts through start_quiz_attempt, submit_quiz_attempt and teacher scoring RPCs.
revoke all privileges on table public.quiz_attempts from public, anon, authenticated, service_role;
grant select on table public.quiz_attempts to authenticated;

revoke all privileges on table public.quiz_answers from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.quiz_answers to authenticated;

revoke all privileges on table public.forum_topics from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.forum_topics to authenticated;

revoke all privileges on table public.forum_posts from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.forum_posts to authenticated;

revoke all privileges on table public.grade_categories from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.grade_categories to authenticated;

revoke all privileges on table public.grade_items from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.grade_items to authenticated;

revoke all privileges on table public.grade_scores from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.grade_scores to authenticated;

revoke all privileges on table public.live_sessions from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.live_sessions to authenticated;

revoke all privileges on table public.live_buzzer_state from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.live_buzzer_state to authenticated;

-- live_attendance: Direct INSERT remains denied; students use record_live_attendance for window enforcement.
revoke all privileges on table public.live_attendance from public, anon, authenticated, service_role;
grant select, update, delete on table public.live_attendance to authenticated;

revoke all privileges on table public.live_chat_messages from public, anon, authenticated, service_role;
grant select, insert on table public.live_chat_messages to authenticated;

revoke all privileges on table public.notifications from public, anon, authenticated, service_role;
grant select, update, delete on table public.notifications to authenticated;
grant select, update on table public.notifications to service_role;

revoke all privileges on table public.push_tokens from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.push_tokens to authenticated;
grant select on table public.push_tokens to service_role;

revoke all privileges on table public.material_progress from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.material_progress to authenticated;

revoke all privileges on table public.forum_reports from public, anon, authenticated, service_role;
grant select, insert, update on table public.forum_reports to authenticated;

-- forum_post_edits: Written by a trigger; direct INSERT policy is deliberately false.
revoke all privileges on table public.forum_post_edits from public, anon, authenticated, service_role;
grant select on table public.forum_post_edits to authenticated;

-- audit_logs: Written by privileged database triggers, not clients.
revoke all privileges on table public.audit_logs from public, anon, authenticated, service_role;
grant select on table public.audit_logs to authenticated;

revoke all privileges on table public.ai_usage_daily from public, anon, authenticated, service_role;
grant select on table public.ai_usage_daily to authenticated;

revoke all privileges on table public.quiz_pool_entries from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.quiz_pool_entries to authenticated;

revoke all privileges on table public.course_question_bank from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.course_question_bank to authenticated;

revoke all privileges on table public.notification_push_logs from public, anon, authenticated, service_role;
grant select on table public.notification_push_logs to authenticated;
grant insert on table public.notification_push_logs to service_role;

-- course_role_capabilities: Read the matrix; modify through the admin capability RPCs.
revoke all privileges on table public.course_role_capabilities from public, anon, authenticated, service_role;
grant select on table public.course_role_capabilities to authenticated;

-- material_ai_enrichment: Staff-edit RLS contract retained; the disabled AI worker receives no service table grant.
revoke all privileges on table public.material_ai_enrichment from public, anon, authenticated, service_role;
grant select, insert, update on table public.material_ai_enrichment to authenticated;

revoke all privileges on table public.alert_dispatch_outbox from public, anon, authenticated, service_role;
grant select on table public.alert_dispatch_outbox to authenticated;

revoke all privileges on table public.report_export_jobs from public, anon, authenticated, service_role;
grant select, insert on table public.report_export_jobs to authenticated;

revoke all privileges on table public.ai_compliance_policies from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.ai_compliance_policies to authenticated;

-- ai_consent_log: Append through record_ai_consent.
revoke all privileges on table public.ai_consent_log from public, anon, authenticated, service_role;
grant select on table public.ai_consent_log to authenticated;

revoke all privileges on table public.media_play_tokens from public, anon, authenticated, service_role;
grant select on table public.media_play_tokens to authenticated;

revoke all privileges on table public.course_units from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.course_units to authenticated;
grant select on table public.course_units to service_role;

revoke all privileges on table public.course_unit_items from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.course_unit_items to authenticated;

revoke all privileges on table public.calendar_events from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.calendar_events to authenticated;

revoke all privileges on table public.course_groups from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.course_groups to authenticated;

revoke all privileges on table public.course_group_members from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.course_group_members to authenticated;

revoke all privileges on table public.peer_review_assignments from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.peer_review_assignments to authenticated;

revoke all privileges on table public.peer_review_pairs from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.peer_review_pairs to authenticated;

-- peer_review_responses: Append through the reviewer-scoped submit_peer_review RPC.
revoke all privileges on table public.peer_review_responses from public, anon, authenticated, service_role;
grant select on table public.peer_review_responses to authenticated;

revoke all privileges on table public.surveys from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.surveys to authenticated;

revoke all privileges on table public.survey_questions from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.survey_questions to authenticated;

-- survey_responses: Submit through submit_survey_response for respondent and anonymous-survey checks.
revoke all privileges on table public.survey_responses from public, anon, authenticated, service_role;
grant select on table public.survey_responses to authenticated;

revoke all privileges on table public.course_badges from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.course_badges to authenticated;

revoke all privileges on table public.course_badge_awards from public, anon, authenticated, service_role;
grant select, insert, delete on table public.course_badge_awards to authenticated;

revoke all privileges on table public.scorm_packages from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.scorm_packages to authenticated;

revoke all privileges on table public.scorm_attempts from public, anon, authenticated, service_role;
grant select, insert, update on table public.scorm_attempts to authenticated;

-- xapi_statements: Append through record_xapi_statement.
revoke all privileges on table public.xapi_statements from public, anon, authenticated, service_role;
grant select on table public.xapi_statements to authenticated;

revoke all privileges on table public.lti_tools from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.lti_tools to authenticated;

revoke all privileges on table public.lti_resource_links from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.lti_resource_links to authenticated;

revoke all privileges on table public.lti_launches from public, anon, authenticated, service_role;
grant select, insert on table public.lti_launches to authenticated;

revoke all privileges on table public.rubrics from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.rubrics to authenticated;

revoke all privileges on table public.rubric_criteria from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.rubric_criteria to authenticated;

revoke all privileges on table public.rubric_scores from public, anon, authenticated, service_role;
-- Rubric scoring validates course, binding and grader capability through its RPC.
grant select on table public.rubric_scores to authenticated;

revoke all privileges on table public.material_notes from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.material_notes to authenticated;

revoke all privileges on table public.material_bookmarks from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.material_bookmarks to authenticated;

revoke all privileges on table public.material_versions from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.material_versions to authenticated;

revoke all privileges on table public.material_chapter_markers from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.material_chapter_markers to authenticated;

revoke all privileges on table public.course_meetings from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.course_meetings to authenticated;

revoke all privileges on table public.livestream_sessions from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.livestream_sessions to authenticated;

-- learning_time_entries: Append through record_learning_time, including its duration checks.
revoke all privileges on table public.learning_time_entries from public, anon, authenticated, service_role;
grant select on table public.learning_time_entries to authenticated;

revoke all privileges on table public.course_export_packages from public, anon, authenticated, service_role;
grant select, insert on table public.course_export_packages to authenticated;

revoke all privileges on table public.badge_issuer_config from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.badge_issuer_config to authenticated;

revoke all privileges on table public.badge_assertions from public, anon, authenticated, service_role;
grant select on table public.badge_assertions to authenticated;

revoke all privileges on table public.html_sanitize_policy from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.html_sanitize_policy to authenticated;

revoke all privileges on table public.material_previews from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.material_previews to authenticated;

revoke all privileges on table public.whiteboard_sessions from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.whiteboard_sessions to authenticated;

revoke all privileges on table public.whiteboard_annotations from public, anon, authenticated, service_role;
grant select, insert, delete on table public.whiteboard_annotations to authenticated;

-- announcement_reads: Record through mark_announcement_read.
revoke all privileges on table public.announcement_reads from public, anon, authenticated, service_role;
grant select on table public.announcement_reads to authenticated;

revoke all privileges on table public.course_tags from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.course_tags to authenticated;

revoke all privileges on table public.course_material_tag_map from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.course_material_tag_map to authenticated;

revoke all privileges on table public.teacher_private_notes from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.teacher_private_notes to authenticated;

revoke all privileges on table public.course_feedback from public, anon, authenticated, service_role;
grant select, insert on table public.course_feedback to authenticated;

revoke all privileges on table public.grade_approval_requests from public, anon, authenticated, service_role;
grant select, insert, update on table public.grade_approval_requests to authenticated;

revoke all privileges on table public.enrollment_history from public, anon, authenticated, service_role;
grant select on table public.enrollment_history to authenticated;

revoke all privileges on table public.webhook_subscriptions from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.webhook_subscriptions to authenticated;

revoke all privileges on table public.webhook_deliveries from public, anon, authenticated, service_role;
grant select on table public.webhook_deliveries to authenticated;

revoke all privileges on table public.material_offline_packs from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.material_offline_packs to authenticated;

revoke all privileges on table public.material_offline_downloads from public, anon, authenticated, service_role;
grant select, insert on table public.material_offline_downloads to authenticated;

revoke all privileges on table public.academic_terms from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.academic_terms to authenticated;

revoke all privileges on table public.departments from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.departments to authenticated;

revoke all privileges on table public.course_sections from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.course_sections to authenticated;

revoke all privileges on table public.course_prerequisites from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.course_prerequisites to authenticated;

revoke all privileges on table public.course_subscriptions from public, anon, authenticated, service_role;
grant select, insert, delete on table public.course_subscriptions to authenticated;

revoke all privileges on table public.quiz_proctor_settings from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.quiz_proctor_settings to authenticated;

revoke all privileges on table public.quiz_proctor_events from public, anon, authenticated, service_role;
grant select, insert on table public.quiz_proctor_events to authenticated;

revoke all privileges on table public.ai_chat_threads from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.ai_chat_threads to authenticated;

revoke all privileges on table public.ai_chat_messages from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.ai_chat_messages to authenticated;

revoke all privileges on table public.material_ai_summary from public, anon, authenticated, service_role;
grant select on table public.material_ai_summary to authenticated;

revoke all privileges on table public.push_notification_preferences from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.push_notification_preferences to authenticated;

revoke all privileges on table public.user_favorites from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.user_favorites to authenticated;

revoke all privileges on table public.email_digest_preferences from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.email_digest_preferences to authenticated;

revoke all privileges on table public.program_outcomes from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.program_outcomes to authenticated;

revoke all privileges on table public.course_outcomes from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.course_outcomes to authenticated;

revoke all privileges on table public.outcome_item_map from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.outcome_item_map to authenticated;

revoke all privileges on table public.teacher_office_hours from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.teacher_office_hours to authenticated;

revoke all privileges on table public.office_hour_bookings from public, anon, authenticated, service_role;
grant select, insert, update on table public.office_hour_bookings to authenticated;

-- Views are read-only API contracts. The materialized report is RPC-only.
revoke all privileges on table public.course_grade_rollups from public, anon, authenticated, service_role;
grant select on table public.course_grade_rollups to authenticated;
revoke all privileges on table public.reporting_grade_course_item_scores from public, anon, authenticated, service_role;
grant select on table public.reporting_grade_course_item_scores to authenticated;
revoke all privileges on table public.reporting_push_dispatch_retry_curve from public, anon, authenticated, service_role;
grant select on table public.reporting_push_dispatch_retry_curve to authenticated;
revoke all privileges on table public.reporting_quiz_overview from public, anon, authenticated, service_role;
grant select on table public.reporting_quiz_overview to authenticated;
revoke all privileges on table public.reporting_live_attendance_overview from public, anon, authenticated, service_role;
grant select on table public.reporting_live_attendance_overview to authenticated;
revoke all privileges on table public.reporting_course_engagement_7d from public, anon, authenticated, service_role;
revoke all privileges on table public.reporting_ai_quota_overview from public, anon, authenticated, service_role;
grant select on table public.reporting_ai_quota_overview to authenticated;
revoke all privileges on table public.reporting_student_dashboard from public, anon, authenticated, service_role;
grant select on table public.reporting_student_dashboard to authenticated;
revoke all privileges on table public.reporting_learning_time_monthly from public, anon, authenticated, service_role;
grant select on table public.reporting_learning_time_monthly to authenticated;
revoke all privileges on table public.reporting_teacher_workload from public, anon, authenticated, service_role;
grant select on table public.reporting_teacher_workload to authenticated;
revoke all privileges on table public.reporting_course_leaderboard from public, anon, authenticated, service_role;
grant select on table public.reporting_course_leaderboard to authenticated;
revoke all privileges on table public.reporting_announcement_read_ratio from public, anon, authenticated, service_role;
grant select on table public.reporting_announcement_read_ratio to authenticated;
revoke all privileges on table public.public_course_catalog from public, anon, authenticated, service_role;
grant select on table public.public_course_catalog to anon;
grant select on table public.public_course_catalog to authenticated;
revoke all privileges on table public.reporting_at_risk_students from public, anon, authenticated, service_role;
grant select on table public.reporting_at_risk_students to authenticated;
revoke all privileges on table public.reporting_participation_score from public, anon, authenticated, service_role;
grant select on table public.reporting_participation_score to authenticated;
revoke all privileges on table public.course_search_index from public, anon, authenticated, service_role;
grant select on table public.course_search_index to authenticated;

-- Caller-scoped reporting and worker RPC boundaries.
-- Reviewed against main bcb33b260a3afb97f0ede58e9e476873f7ba8178.
-- Private views must evaluate their underlying tables with the caller's RLS.

alter view public.course_grade_rollups set (security_invoker = true);
alter view public.reporting_grade_course_item_scores set (security_invoker = true);
alter view public.reporting_push_dispatch_retry_curve set (security_invoker = true);
alter view public.reporting_quiz_overview set (security_invoker = true);
alter view public.reporting_live_attendance_overview set (security_invoker = true);
alter view public.reporting_ai_quota_overview set (security_invoker = true);
alter view public.reporting_student_dashboard set (security_invoker = true);
alter view public.reporting_learning_time_monthly set (security_invoker = true);
alter view public.reporting_teacher_workload set (security_invoker = true);
alter view public.reporting_course_leaderboard set (security_invoker = true);
alter view public.reporting_announcement_read_ratio set (security_invoker = true);
alter view public.reporting_at_risk_students set (security_invoker = true);
alter view public.reporting_participation_score set (security_invoker = true);
alter view public.course_search_index set (security_invoker = true);

-- The public catalog deliberately exposes only its fixed, non-sensitive projection
-- of published, non-archived courses. Do not grant anon access to public.courses.
alter view public.public_course_catalog
  set (security_barrier = true, security_invoker = false);

-- course_members is visible to classmates. Restrict the outer report rows as well
-- as underlying data so another student's hidden grade cannot appear as zero.
-- is_course_moderator matches grade_scores: teacher, moderator or platform admin.

create or replace view public.reporting_student_dashboard
with (security_invoker = true) as
select
  cm.course_id,
  cm.user_id as student_id,
  (select count(*) from public.assignments a
   where a.course_id = cm.course_id
     and (a.due_at is null or a.due_at >= now() - interval '30 days')) as assignments_active,
  (select count(*) from public.assignments a
   left join public.submissions s
     on s.assignment_id = a.id and s.student_id = cm.user_id
   where a.course_id = cm.course_id and s.id is null and (a.due_at is null or a.due_at > now())) as assignments_pending,
  (select count(*) from public.quizzes q
   left join public.quiz_attempts qa
     on qa.quiz_id = q.id and qa.student_id = cm.user_id and qa.submitted_at is not null
   where q.course_id = cm.course_id and qa.id is null) as quizzes_not_attempted,
  (select count(*) from public.peer_review_pairs pr
   join public.peer_review_assignments pa on pa.id = pr.review_assignment_id
   where pa.course_id = cm.course_id and pr.reviewer_id = cm.user_id and pr.status = 'pending') as peer_reviews_pending,
  (select count(*) from public.course_badge_awards a
   join public.course_badges b on b.id = a.badge_id
   where b.course_id = cm.course_id and a.recipient_id = cm.user_id) as badges_earned,
  (select coalesce(weighted_percent, 0) from public.course_grade_rollups r
   where r.course_id = cm.course_id and r.student_id = cm.user_id limit 1) as weighted_percent
from public.course_members cm
where cm.role = 'student'
  and (
    cm.user_id = auth.uid()
    or public.is_course_moderator(cm.course_id)
  );

create or replace view public.reporting_at_risk_students
with (security_invoker = true) as
with engagement as (
  select cm.course_id, cm.user_id,
    (select count(*) from public.live_attendance la
     join public.live_sessions ls on ls.id = la.session_id
     where ls.course_id = cm.course_id and la.user_id = cm.user_id
       and la.recorded_at >= now() - interval '21 days') as recent_attendances,
    (select count(*) from public.forum_posts fp
     join public.forum_topics ft on ft.id = fp.topic_id
     where ft.course_id = cm.course_id and fp.author_id = cm.user_id
       and fp.created_at >= now() - interval '21 days') as recent_forum_posts,
    (select count(*) from public.quiz_attempts qa
     join public.quizzes q on q.id = qa.quiz_id
     where q.course_id = cm.course_id and qa.student_id = cm.user_id
       and qa.submitted_at >= now() - interval '21 days') as recent_quiz_attempts,
    (select count(*) from public.submissions s
     join public.assignments a on a.id = s.assignment_id
     where a.course_id = cm.course_id and s.student_id = cm.user_id
       and a.due_at < now() and s.id is null) as missing_assignments
  from public.course_members cm
  where cm.role = 'student'
    and (
      cm.user_id = auth.uid()
      or public.is_course_moderator(cm.course_id)
    )
),
rollups as (
  select course_id, student_id, weighted_percent
  from public.course_grade_rollups
)
select
  e.course_id,
  e.user_id as student_id,
  coalesce(r.weighted_percent, 0) as weighted_percent,
  e.recent_attendances,
  e.recent_forum_posts,
  e.recent_quiz_attempts,
  e.missing_assignments,
  case
    when coalesce(r.weighted_percent, 0) < 50 then 'critical'
    when coalesce(r.weighted_percent, 0) < 60 then 'warn'
    when (e.recent_attendances + e.recent_forum_posts + e.recent_quiz_attempts) = 0
         and coalesce(r.weighted_percent, 0) < 70 then 'warn'
    else 'ok'
  end as risk_level
from engagement e
left join rollups r on r.course_id = e.course_id and r.student_id = e.user_id;

-- Queue mutation RPCs are worker-only. auth.role() understands modern JSON JWT
-- claims; IS DISTINCT FROM rejects missing/NULL claims instead of failing open.
-- current_user is the function owner inside SECURITY DEFINER and is not a caller
-- identity check. User/admin clients can still request and read their jobs via RLS.

create or replace function public.report_export_jobs_claim_next()
returns public.report_export_jobs
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_job public.report_export_jobs;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into v_job
  from public.report_export_jobs
  where status = 'queued'
  order by created_at asc
  for update skip locked
  limit 1;

  if v_job.id is null then
    return null;
  end if;

  update public.report_export_jobs
  set status = 'running', updated_at = now()
  where id = v_job.id
  returning * into v_job;

  return v_job;
end;
$$;

revoke all privileges on function public.report_export_jobs_claim_next()
  from public, anon, authenticated;
grant execute on function public.report_export_jobs_claim_next() to service_role;

create or replace function public.report_export_jobs_complete(
  p_id uuid,
  p_status text,
  p_storage_path text,
  p_row_count integer,
  p_error text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_status not in ('ready', 'failed') then
    raise exception 'invalid status (expect ready|failed)';
  end if;

  update public.report_export_jobs
  set status = p_status,
      storage_path = p_storage_path,
      row_count = p_row_count,
      error_detail = p_error,
      updated_at = now()
  where id = p_id;
end;
$$;

revoke all privileges on function public.report_export_jobs_complete(uuid, text, text, integer, text)
  from public, anon, authenticated;
grant execute on function public.report_export_jobs_complete(uuid, text, text, integer, text) to service_role;

create or replace function public.course_export_jobs_claim_next()
returns public.course_export_packages
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_job public.course_export_packages;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into v_job
  from public.course_export_packages
  where status = 'queued'
  order by created_at asc
  for update skip locked
  limit 1;

  if v_job.id is null then return null; end if;

  update public.course_export_packages
  set status = 'running', updated_at = now()
  where id = v_job.id
  returning * into v_job;
  return v_job;
end;
$$;

revoke all privileges on function public.course_export_jobs_claim_next()
  from public, anon, authenticated;
grant execute on function public.course_export_jobs_claim_next() to service_role;

create or replace function public.course_export_jobs_complete(
  p_id uuid,
  p_status text,
  p_storage_path text,
  p_manifest jsonb,
  p_error text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_status not in ('ready', 'failed') then raise exception 'invalid status'; end if;

  update public.course_export_packages
  set status = p_status,
      storage_path = p_storage_path,
      manifest_summary = p_manifest,
      error_detail = p_error,
      updated_at = now()
  where id = p_id;
end;
$$;

revoke all privileges on function public.course_export_jobs_complete(uuid, text, text, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.course_export_jobs_complete(uuid, text, text, jsonb, text) to service_role;

create or replace function public.webhook_deliveries_claim_next()
returns public.webhook_deliveries
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_row public.webhook_deliveries;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into v_row
  from public.webhook_deliveries
  where delivered_at is null and abandoned_at is null
  order by created_at asc
  for update skip locked
  limit 1;

  return v_row;
end;
$$;

revoke all privileges on function public.webhook_deliveries_claim_next()
  from public, anon, authenticated;
grant execute on function public.webhook_deliveries_claim_next() to service_role;

create or replace function public.webhook_deliveries_mark(
  p_id uuid,
  p_status integer,
  p_error text,
  p_delivered boolean,
  p_abandon boolean
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  update public.webhook_deliveries
  set attempt_count = attempt_count + 1,
      last_status = p_status,
      last_error = p_error,
      last_attempted_at = now(),
      delivered_at = case when p_delivered then now() else delivered_at end,
      abandoned_at = case when p_abandon then now() else abandoned_at end
  where id = p_id;
end;
$$;

revoke all privileges on function public.webhook_deliveries_mark(uuid, integer, text, boolean, boolean)
  from public, anon, authenticated;
grant execute on function public.webhook_deliveries_mark(uuid, integer, text, boolean, boolean) to service_role;

-- Only owner-executed triggers and trusted workers may enqueue outbound events.
-- SECURITY DEFINER triggers continue to execute this helper as its owner even
-- when the originating request is authenticated and lacks EXECUTE on the helper.
revoke all privileges on function public.enqueue_webhook_event(text, jsonb)
  from public, anon, authenticated;
grant execute on function public.enqueue_webhook_event(text, jsonb) to service_role;



-- Close the concrete cross-account RPC and student self-grading paths found
-- while validating explicit Data API privileges. Existing signatures are kept.

create or replace function public.submit_peer_review(
  p_pair_id uuid,
  p_scores jsonb,
  p_comment text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_response uuid;
begin
  if auth.uid() is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- Check and lock the assigned pending pair BEFORE writing a response. The
  -- row lock also makes concurrent/replayed submissions fail after the first.
  perform 1
  from public.peer_review_pairs pr
  where pr.id = p_pair_id
    and pr.reviewer_id = auth.uid()
    and pr.status = 'pending'
  for update;
  if not found then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  insert into public.peer_review_responses (pair_id, scores, comment)
  values (p_pair_id, coalesce(p_scores, '{}'::jsonb), coalesce(p_comment, ''))
  returning id into v_response;

  update public.peer_review_pairs
  set status = 'submitted'
  where id = p_pair_id and reviewer_id = auth.uid();

  return v_response;
end;
$$;

revoke all privileges on function public.submit_peer_review(uuid, jsonb, text)
  from public, anon, authenticated, service_role;
grant execute on function public.submit_peer_review(uuid, jsonb, text)
  to authenticated;

create or replace function public.submit_rubric_score(
  p_rubric_id uuid,
  p_target_kind text,
  p_target_id uuid,
  p_scores jsonb,
  p_comment text
)
returns numeric
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_total numeric := 0;
  c record;
  v_score numeric;
  v_course uuid;
  v_target_course uuid;
  v_target_binding uuid;
  v_bound_kind text;
  v_bound_id uuid;
begin
  if auth.uid() is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_target_kind is null or p_target_kind not in ('submission', 'peer_review_pair') then
    raise exception 'invalid target_kind';
  end if;

  select r.course_id, r.bound_kind, r.bound_id
    into v_course, v_bound_kind, v_bound_id
  from public.rubrics r
  where r.id = p_rubric_id
  for share;

  if v_course is null or not public.course_member_has_capability(v_course, 'assignments.grade') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_target_kind = 'submission' then
    select a.course_id, s.assignment_id
      into v_target_course, v_target_binding
    from public.submissions s
    join public.assignments a on a.id = s.assignment_id
    where s.id = p_target_id
    for share of s, a;
  else
    select pa.course_id, pr.review_assignment_id
      into v_target_course, v_target_binding
    from public.peer_review_pairs pr
    join public.peer_review_assignments pa on pa.id = pr.review_assignment_id
    where pr.id = p_target_id
    for share of pr, pa;
  end if;

  if v_target_course is distinct from v_course
     or (v_bound_id is not null and v_bound_id is distinct from v_target_binding)
     or (v_bound_kind is not null and v_bound_kind is distinct from
       case when p_target_kind = 'submission' then 'assignment' else 'peer_review' end) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- Preserve the existing weighted/clamped score calculation and return value.
  for c in
    select id, weight, max_points
    from public.rubric_criteria
    where rubric_id = p_rubric_id
  loop
    v_score := least(
      greatest(coalesce((p_scores->>c.id::text)::numeric, 0), 0),
      c.max_points
    );
    v_total := v_total + (v_score * c.weight);
  end loop;

  insert into public.rubric_scores (
    rubric_id, target_kind, target_id, scorer_id, scores, total_points, comment
  ) values (
    p_rubric_id, p_target_kind, p_target_id, auth.uid(),
    coalesce(p_scores, '{}'::jsonb), v_total, coalesce(p_comment, '')
  )
  on conflict (rubric_id, target_kind, target_id, scorer_id)
  do update set scores = excluded.scores,
                total_points = excluded.total_points,
                comment = excluded.comment;

  return v_total;
end;
$$;

revoke all privileges on function public.submit_rubric_score(uuid, text, uuid, jsonb, text)
  from public, anon, authenticated, service_role;
grant execute on function public.submit_rubric_score(uuid, text, uuid, jsonb, text)
  to authenticated;

-- rubric_scores must be SELECT-only for authenticated in the explicit grants
-- above: all writes go through submit_rubric_score, so callers cannot bypass its
-- course/target authorization or forge total_points with a direct table write.

create or replace function public.apply_late_penalty(p_submission_id uuid)
returns numeric
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_grade numeric;
  v_due timestamptz;
  v_pct numeric;
  v_max_days integer;
  v_submitted timestamptz;
  v_days_late integer;
  v_penalty numeric;
  v_final numeric;
begin
  if auth.uid() is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select s.grade, a.due_at, a.late_penalty_pct_per_day, a.max_late_days, s.submitted_at
    into v_grade, v_due, v_pct, v_max_days, v_submitted
  from public.submissions s
  join public.assignments a on a.id = s.assignment_id
  where s.id = p_submission_id
    and (
      s.student_id = auth.uid()
      or public.course_member_has_capability(a.course_id, 'assignments.grade')
    );

  if not found then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_grade is null then return null; end if;
  if v_due is null or v_pct is null or v_pct = 0 then return v_grade; end if;
  if v_submitted <= v_due then return v_grade; end if;

  v_days_late := ceil(extract(epoch from (v_submitted - v_due)) / 86400)::integer;
  if v_max_days is not null and v_days_late > v_max_days then
    v_days_late := v_max_days;
  end if;

  v_penalty := least(v_grade * v_pct / 100 * v_days_late, v_grade);
  v_final := greatest(v_grade - v_penalty, 0);
  return v_final;
end;
$$;

revoke all privileges on function public.apply_late_penalty(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.apply_late_penalty(uuid) to authenticated;

-- These triggers intentionally use SECURITY INVOKER. current_user must be the
-- actual executing database role, not a trigger owner's blanket bypass. Existing
-- validated SECURITY DEFINER scoring RPCs still execute their writes as owner.
create or replace function public.protect_submission_grading()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_course uuid;
begin
  -- A submitted row belongs permanently to its assignment and student; moving
  -- it could carry an existing grade into another assignment without changing it.
  if tg_op = 'UPDATE' and (
    new.assignment_id is distinct from old.assignment_id
    or new.student_id is distinct from old.student_id
  ) then
    raise exception 'Submission assignment and student cannot be changed'
      using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    if new.grade is null and new.feedback is null
       and new.graded_at is null and new.graded_by is null then
      return new;
    end if;
  elsif row(new.grade, new.feedback, new.graded_at, new.graded_by)
    is not distinct from row(old.grade, old.feedback, old.graded_at, old.graded_by) then
    return new;
  end if;

  if current_user in ('postgres', 'supabase_admin', 'service_role') then
    return new;
  end if;

  select a.course_id into v_course
  from public.assignments a where a.id = new.assignment_id;

  if public.is_course_teacher(v_course)
     or public.course_member_has_capability(v_course, 'assignments.grade') then
    return new;
  end if;

  raise exception 'Submission grading requires an authorized grader'
    using errcode = '42501';
end;
$$;

revoke all privileges on function public.protect_submission_grading()
  from public, anon, authenticated, service_role;

drop trigger if exists submissions_protect_grading on public.submissions;
create trigger submissions_protect_grading
  before insert or update on public.submissions
  for each row execute function public.protect_submission_grading();

create or replace function public.protect_quiz_answer_grading()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_course uuid;
begin
  -- Preserve the answer's composite identity, including any authorized score.
  if tg_op = 'UPDATE' and (
    new.attempt_id is distinct from old.attempt_id
    or new.question_id is distinct from old.question_id
  ) then
    raise exception 'Quiz answer attempt and question cannot be changed'
      using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    if new.manual_score is null then return new; end if;
  elsif new.manual_score is not distinct from old.manual_score then
    return new;
  end if;

  if current_user in ('postgres', 'supabase_admin', 'service_role') then
    return new;
  end if;

  select q.course_id into v_course
  from public.quiz_attempts qa
  join public.quizzes q on q.id = qa.quiz_id
  where qa.id = new.attempt_id;

  -- Match the existing set_quiz_manual_score authorization; assistant is not a
  -- moderator merely by being signed in or owning a student attempt.
  if public.is_course_moderator(v_course) then
    return new;
  end if;

  raise exception 'Manual quiz grading requires an authorized grader'
    using errcode = '42501';
end;
$$;

revoke all privileges on function public.protect_quiz_answer_grading()
  from public, anon, authenticated, service_role;

drop trigger if exists quiz_answers_protect_grading on public.quiz_answers;
create trigger quiz_answers_protect_grading
  before insert or update on public.quiz_answers
  for each row execute function public.protect_quiz_answer_grading();

-- Students must not bypass server scoring by writing their own quiz gradebook
-- rows. Keep the existing authorized-grader policies and the validated sync RPC.
drop policy if exists grade_scores_insert_student_own_quiz on public.grade_scores;
drop policy if exists grade_scores_update_student_own_quiz on public.grade_scores;

-- Preserve the staged student grade-sync RPC with a fail-closed identity check.
create or replace function public.sync_quiz_gradebook_from_attempt(p_attempt_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_quiz_id uuid;
  v_student uuid;
  v_score numeric;
  v_max numeric := 0;
  gi record;
begin
  select qa.quiz_id, qa.student_id, qa.score
    into v_quiz_id, v_student, v_score
  from public.quiz_attempts qa
  where qa.id = p_attempt_id;

  if auth.uid() is null or v_quiz_id is null or v_student is distinct from auth.uid() then
    raise exception '無法同步成績';
  end if;

  select coalesce(sum(qq.points), 0)
    into v_max
  from public.quiz_questions qq
  where qq.quiz_id = v_quiz_id;

  for gi in
    select girow.id as gid
    from public.grade_items girow
    join public.grade_categories gc on gc.id = girow.category_id
    where girow.source_type = 'quiz'
      and girow.source_id = v_quiz_id
      and public.is_course_member(gc.course_id)
  loop
    insert into public.grade_scores (grade_item_id, student_id, score)
    values (gi.gid, v_student, least(coalesce(v_score, 0), (
      select gi2.max_points from public.grade_items gi2 where gi2.id = gi.gid
    )))
    on conflict (grade_item_id, student_id)
    do update set score = excluded.score, updated_at = now();
  end loop;
end;
$$;

-- Function defaults are a separate API surface. REVOKE FROM PUBLIC alone
-- does not remove the direct anon/authenticated grants inherited on old projects.
-- Enumerate application functions only; extension and platform functions are untouched.
revoke all privileges on function public._quiz_answer_correct(text,jsonb,jsonb) from public, anon, authenticated, service_role;
revoke all privileges on function public._quiz_normalize_answer(text,jsonb) from public, anon, authenticated, service_role;
revoke all privileges on function public.add_owner_as_course_teacher() from public, anon, authenticated, service_role;
revoke all privileges on function public.admin_ai_quota_overview() from public, anon, authenticated, service_role;
grant execute on function public.admin_ai_quota_overview() to authenticated;
revoke all privileges on function public.admin_bulk_cancel_notification_dispatch(uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.admin_bulk_cancel_notification_dispatch(uuid[]) to authenticated;
revoke all privileges on function public.admin_bulk_retry_notification_dispatch(uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.admin_bulk_retry_notification_dispatch(uuid[]) to authenticated;
revoke all privileges on function public.admin_bulk_set_course_role_capabilities(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.admin_bulk_set_course_role_capabilities(jsonb) to authenticated;
revoke all privileges on function public.admin_course_engagement_7d() from public, anon, authenticated, service_role;
grant execute on function public.admin_course_engagement_7d() to authenticated;
revoke all privileges on function public.admin_dlq_summary() from public, anon, authenticated, service_role;
grant execute on function public.admin_dlq_summary() to authenticated;
revoke all privileges on function public.admin_purge_expired_ai() from public, anon, authenticated, service_role;
grant execute on function public.admin_purge_expired_ai() to authenticated;
revoke all privileges on function public.admin_purge_expired_dlq() from public, anon, authenticated, service_role;
grant execute on function public.admin_purge_expired_dlq() to authenticated;
revoke all privileges on function public.admin_push_retry_curve(integer) from public, anon, authenticated, service_role;
grant execute on function public.admin_push_retry_curve(integer) to authenticated;
revoke all privileges on function public.admin_retry_notification_dispatch(uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_retry_notification_dispatch(uuid) to authenticated;
revoke all privileges on function public.admin_set_course_role_capability(text,text,boolean) from public, anon, authenticated, service_role;
grant execute on function public.admin_set_course_role_capability(text,text,boolean) to authenticated;
revoke all privileges on function public.admin_teacher_workload() from public, anon, authenticated, service_role;
grant execute on function public.admin_teacher_workload() to authenticated;
revoke all privileges on function public.apply_late_penalty(uuid) from public, anon, authenticated, service_role;
grant execute on function public.apply_late_penalty(uuid) to authenticated;
revoke all privileges on function public.audit_forum_posts_touch() from public, anon, authenticated, service_role;
revoke all privileges on function public.audit_grade_scores_touch() from public, anon, authenticated, service_role;
revoke all privileges on function public.auto_assign_course_groups(uuid,integer) from public, anon, authenticated, service_role;
grant execute on function public.auto_assign_course_groups(uuid,integer) to authenticated;
revoke all privileges on function public.auto_pair_peer_review(uuid) from public, anon, authenticated, service_role;
grant execute on function public.auto_pair_peer_review(uuid) to authenticated;
revoke all privileges on function public.bulk_import_course_members(uuid,jsonb) from public, anon, authenticated, service_role;
grant execute on function public.bulk_import_course_members(uuid,jsonb) to authenticated;
revoke all privileges on function public.claim_live_buzzer(uuid) from public, anon, authenticated, service_role;
grant execute on function public.claim_live_buzzer(uuid) to authenticated;
revoke all privileges on function public.consume_media_play_token(text,text) from public, anon, authenticated, service_role;
grant execute on function public.consume_media_play_token(text,text) to authenticated;
revoke all privileges on function public.course_export_jobs_claim_next() from public, anon, authenticated, service_role;
grant execute on function public.course_export_jobs_claim_next() to service_role;
revoke all privileges on function public.course_export_jobs_complete(uuid,text,text,jsonb,text) from public, anon, authenticated, service_role;
grant execute on function public.course_export_jobs_complete(uuid,text,text,jsonb,text) to service_role;
revoke all privileges on function public.course_member_has_capability(uuid,text) from public, anon, authenticated, service_role;
grant execute on function public.course_member_has_capability(uuid,text) to authenticated;
revoke all privileges on function public.course_members_audit_touch() from public, anon, authenticated, service_role;
revoke all privileges on function public.decide_grade_approval(uuid,text,text) from public, anon, authenticated, service_role;
grant execute on function public.decide_grade_approval(uuid,text,text) to authenticated;
revoke all privileges on function public.duplicate_course(uuid,text) from public, anon, authenticated, service_role;
grant execute on function public.duplicate_course(uuid,text) to authenticated;
revoke all privileges on function public.enqueue_webhook_event(text,jsonb) from public, anon, authenticated, service_role;
grant execute on function public.enqueue_webhook_event(text,jsonb) to service_role;
revoke all privileges on function public.enroll_by_code(text) from public, anon, authenticated, service_role;
grant execute on function public.enroll_by_code(text) to authenticated;
revoke all privileges on function public.forum_posts_audit_edit() from public, anon, authenticated, service_role;
revoke all privileges on function public.handle_new_user() from public, anon, authenticated, service_role;
revoke all privileges on function public.import_bank_questions_to_quiz(uuid,uuid[],boolean) from public, anon, authenticated, service_role;
grant execute on function public.import_bank_questions_to_quiz(uuid,uuid[],boolean) to authenticated;
revoke all privileges on function public.increment_ai_usage(uuid) from public, anon, authenticated, service_role;
grant execute on function public.increment_ai_usage(uuid) to service_role;
revoke all privileges on function public.is_course_member(uuid) from public, anon, authenticated, service_role;
grant execute on function public.is_course_member(uuid) to authenticated;
revoke all privileges on function public.is_course_moderator(uuid) from public, anon, authenticated, service_role;
grant execute on function public.is_course_moderator(uuid) to authenticated;
revoke all privileges on function public.is_course_staff(uuid) from public, anon, authenticated, service_role;
grant execute on function public.is_course_staff(uuid) to authenticated;
revoke all privileges on function public.is_course_teacher(uuid) from public, anon, authenticated, service_role;
grant execute on function public.is_course_teacher(uuid) to authenticated;
revoke all privileges on function public.is_platform_admin() from public, anon, authenticated, service_role;
grant execute on function public.is_platform_admin() to authenticated;
revoke all privileges on function public.issue_media_play_token(uuid,text,integer) from public, anon, authenticated, service_role;
grant execute on function public.issue_media_play_token(uuid,text,integer) to authenticated;
revoke all privileges on function public.mark_announcement_read(uuid) from public, anon, authenticated, service_role;
grant execute on function public.mark_announcement_read(uuid) to authenticated;
revoke all privileges on function public.material_ai_enrichment_apply_policy() from public, anon, authenticated, service_role;
revoke all privileges on function public.maybe_auto_award_badges(uuid) from public, anon, authenticated, service_role;
grant execute on function public.maybe_auto_award_badges(uuid) to authenticated;
revoke all privileges on function public.my_calendar_events(timestamp with time zone,timestamp with time zone) from public, anon, authenticated, service_role;
grant execute on function public.my_calendar_events(timestamp with time zone,timestamp with time zone) to authenticated;
revoke all privileges on function public.my_course_capabilities(uuid) from public, anon, authenticated, service_role;
grant execute on function public.my_course_capabilities(uuid) to authenticated;
revoke all privileges on function public.my_course_rank(uuid) from public, anon, authenticated, service_role;
grant execute on function public.my_course_rank(uuid) to authenticated;
revoke all privileges on function public.my_dashboard() from public, anon, authenticated, service_role;
grant execute on function public.my_dashboard() to authenticated;
revoke all privileges on function public.notify_course_members(uuid,text,text) from public, anon, authenticated, service_role;
grant execute on function public.notify_course_members(uuid,text,text) to authenticated;
revoke all privileges on function public.pick_random_student(uuid) from public, anon, authenticated, service_role;
grant execute on function public.pick_random_student(uuid) to authenticated;
revoke all privileges on function public.protect_profile_role() from public, anon, authenticated, service_role;
revoke all privileges on function public.protect_quiz_answer_grading() from public, anon, authenticated, service_role;
revoke all privileges on function public.protect_submission_grading() from public, anon, authenticated, service_role;
revoke all privileges on function public.push_notification_abandon_alert() from public, anon, authenticated, service_role;
revoke all privileges on function public.quiz_attempts_before_insert_guard() from public, anon, authenticated, service_role;
revoke all privileges on function public.quiz_pool_entry_same_quiz() from public, anon, authenticated, service_role;
revoke all privileges on function public.record_ai_consent(text,text,boolean,text,text) from public, anon, authenticated, service_role;
grant execute on function public.record_ai_consent(text,text,boolean,text,text) to authenticated;
revoke all privileges on function public.record_learning_time(uuid,text,uuid,integer) from public, anon, authenticated, service_role;
grant execute on function public.record_learning_time(uuid,text,uuid,integer) to authenticated;
revoke all privileges on function public.record_live_attendance(uuid) from public, anon, authenticated, service_role;
grant execute on function public.record_live_attendance(uuid) to authenticated;
revoke all privileges on function public.record_xapi_statement(uuid,text,text,jsonb,jsonb) from public, anon, authenticated, service_role;
grant execute on function public.record_xapi_statement(uuid,text,text,jsonb,jsonb) to authenticated;
revoke all privileges on function public.refresh_reporting_course_engagement_7d() from public, anon, authenticated, service_role;
grant execute on function public.refresh_reporting_course_engagement_7d() to authenticated;
revoke all privileges on function public.reorder_course_units(uuid,uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.reorder_course_units(uuid,uuid[]) to authenticated;
revoke all privileges on function public.report_export_jobs_claim_next() from public, anon, authenticated, service_role;
grant execute on function public.report_export_jobs_claim_next() to service_role;
revoke all privileges on function public.report_export_jobs_complete(uuid,text,text,integer,text) from public, anon, authenticated, service_role;
grant execute on function public.report_export_jobs_complete(uuid,text,text,integer,text) to service_role;
revoke all privileges on function public.revoke_media_play_tokens(uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function public.revoke_media_play_tokens(uuid,uuid) to authenticated;
revoke all privileges on function public.search_course(uuid,text) from public, anon, authenticated, service_role;
grant execute on function public.search_course(uuid,text) to authenticated;
revoke all privileges on function public.set_quiz_manual_score(uuid,uuid,numeric) from public, anon, authenticated, service_role;
grant execute on function public.set_quiz_manual_score(uuid,uuid,numeric) to authenticated;
revoke all privileges on function public.set_updated_at() from public, anon, authenticated, service_role;
revoke all privileges on function public.snapshot_material_on_update() from public, anon, authenticated, service_role;
revoke all privileges on function public.start_quiz_attempt(uuid) from public, anon, authenticated, service_role;
grant execute on function public.start_quiz_attempt(uuid) to authenticated;
revoke all privileges on function public.submit_peer_review(uuid,jsonb,text) from public, anon, authenticated, service_role;
grant execute on function public.submit_peer_review(uuid,jsonb,text) to authenticated;
revoke all privileges on function public.submit_quiz_attempt(uuid) from public, anon, authenticated, service_role;
grant execute on function public.submit_quiz_attempt(uuid) to authenticated;
revoke all privileges on function public.submit_rubric_score(uuid,text,uuid,jsonb,text) from public, anon, authenticated, service_role;
grant execute on function public.submit_rubric_score(uuid,text,uuid,jsonb,text) to authenticated;
revoke all privileges on function public.submit_survey_response(uuid,jsonb) from public, anon, authenticated, service_role;
grant execute on function public.submit_survey_response(uuid,jsonb) to authenticated;
revoke all privileges on function public.sync_assignment_calendar() from public, anon, authenticated, service_role;
revoke all privileges on function public.sync_quiz_gradebook_from_attempt(uuid) from public, anon, authenticated, service_role;
grant execute on function public.sync_quiz_gradebook_from_attempt(uuid) to authenticated;
revoke all privileges on function public.user_meets_course_prerequisites(uuid) from public, anon, authenticated, service_role;
grant execute on function public.user_meets_course_prerequisites(uuid) to authenticated;
revoke all privileges on function public.webhook_badge_awarded() from public, anon, authenticated, service_role;
revoke all privileges on function public.webhook_deliveries_claim_next() from public, anon, authenticated, service_role;
grant execute on function public.webhook_deliveries_claim_next() to service_role;
revoke all privileges on function public.webhook_deliveries_mark(uuid,integer,text,boolean,boolean) from public, anon, authenticated, service_role;
grant execute on function public.webhook_deliveries_mark(uuid,integer,text,boolean,boolean) to service_role;
revoke all privileges on function public.webhook_grade_score_changed() from public, anon, authenticated, service_role;

notify pgrst, 'reload schema';

commit;

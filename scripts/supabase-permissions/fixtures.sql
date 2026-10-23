-- Synthetic fixtures for disposable databases only. The runner refuses remote hosts.
-- Keep this compatible with the old migration chain so the upgrade scenario can seed
-- before applying the permission migration and verify that existing rows survive.
\set ON_ERROR_STOP on
begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-000000000001', 'admin@permissions.test', '{"display_name":"Test admin"}'),
  ('00000000-0000-4000-8000-000000000002', 'teacher@permissions.test', '{"display_name":"Test teacher"}'),
  ('00000000-0000-4000-8000-000000000003', 'student-a@permissions.test', '{"display_name":"Student A"}'),
  ('00000000-0000-4000-8000-000000000004', 'student-b@permissions.test', '{"display_name":"Student B"}'),
  ('00000000-0000-4000-8000-000000000005', 'outsider@permissions.test', '{"display_name":"Other course student"}');
update public.profiles set role = 'admin' where id = '00000000-0000-4000-8000-000000000001';
update public.profiles set role = 'teacher' where id = '00000000-0000-4000-8000-000000000002';

insert into public.courses (id, title, description, owner_id, is_catalog_public, catalog_summary, enrollment_code) values
  ('10000000-0000-4000-8000-000000000001', 'Permissions course A', 'Public course description', '00000000-0000-4000-8000-000000000002', true, 'Public summary', 'private-enrollment-a'),
  ('10000000-0000-4000-8000-000000000002', 'Permissions course B', 'Private course description', '00000000-0000-4000-8000-000000000001', false, 'Not public', 'private-enrollment-b');
insert into public.course_members (course_id, user_id, role) values
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000003', 'student'),
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000004', 'student'),
  ('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000005', 'student');

insert into public.assignments (id, course_id, title, created_by, due_at) values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Course A assignment', '00000000-0000-4000-8000-000000000002', now() + interval '7 days'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'Course B assignment', '00000000-0000-4000-8000-000000000001', now() + interval '7 days');
insert into public.submissions (id, assignment_id, student_id, body_text, grade) values
  ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000003', 'Private submission A', 82),
  ('30000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000004', 'Private submission B', 65),
  ('30000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000005', 'Other course submission', 91);
-- A spare assignment tests first submission inserts; the late submission uses
-- transaction-stable timestamps so the penalty is exactly two days (80 -> 64).
insert into public.assignments (id, course_id, title, created_by, due_at, late_penalty_pct_per_day) values
  ('20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', 'New submission target', '00000000-0000-4000-8000-000000000002', now() + interval '7 days', 0),
  ('20000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001', 'Late submission target', '00000000-0000-4000-8000-000000000002', now() - interval '3 days', 10);
insert into public.submissions (id, assignment_id, student_id, body_text, grade, submitted_at) values
  ('30000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000003', 'Late submission A', 80, now() - interval '1 day');
insert into public.grade_categories (id, course_id, name, weight) values
  ('40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Assignments', 1),
  ('40000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'Assignments', 1);
insert into public.grade_items (id, category_id, source_type, source_id, title) values
  ('50000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 'assignment', '20000000-0000-4000-8000-000000000001', 'Course A grade'),
  ('50000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000002', 'assignment', '20000000-0000-4000-8000-000000000002', 'Course B grade'),
  ('50000000-0000-4000-8000-000000000003', '40000000-0000-4000-8000-000000000001', 'quiz', '72000000-0000-4000-8000-000000000001', 'Course A quiz grade');
insert into public.grade_scores (id, grade_item_id, student_id, score) values
  ('60000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000003', 82),
  ('60000000-0000-4000-8000-000000000002', '50000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000004', 65),
  ('60000000-0000-4000-8000-000000000003', '50000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000005', 91);

insert into public.course_materials (id, course_id, title, created_by, external_url, mime_type) values
  ('70000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Course A material', '00000000-0000-4000-8000-000000000002', 'https://example.invalid/a.pdf', 'application/pdf'),
  ('70000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'Course B material', '00000000-0000-4000-8000-000000000001', 'https://example.invalid/b.pdf', 'application/pdf');
insert into public.course_units (id, course_id, title, created_by) values
  ('71000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Course A unit', '00000000-0000-4000-8000-000000000002'),
  ('71000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'Course B unit', '00000000-0000-4000-8000-000000000001');
insert into public.quizzes (id, course_id, title, created_by, max_attempts) values
  ('72000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Course A quiz', '00000000-0000-4000-8000-000000000002', 3),
  ('72000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'Course B quiz', '00000000-0000-4000-8000-000000000001', 3);
insert into public.quiz_questions (id, quiz_id, question_type, prompt, choices, points) values
  ('73000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000001', 'single', 'Test question A', '["A","B"]', 10),
  ('73000000-0000-4000-8000-000000000002', '72000000-0000-4000-8000-000000000002', 'single', 'Test question B', '["A","B"]', 10),
  ('73000000-0000-4000-8000-000000000003', '72000000-0000-4000-8000-000000000001', 'single', 'Another course A question', '["A","B"]', 4);
insert into public.quiz_question_solutions (question_id, correct_answer) values
  ('73000000-0000-4000-8000-000000000001', '"A"'),
  ('73000000-0000-4000-8000-000000000002', '"B"'),
  ('73000000-0000-4000-8000-000000000003', '"B"');
insert into public.quiz_attempts (id, quiz_id, student_id, submitted_at, score) values
  ('74000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000003', now(), 10),
  ('74000000-0000-4000-8000-000000000002', '72000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000004', now(), 0),
  ('74000000-0000-4000-8000-000000000003', '72000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000005', now(), 10);

insert into public.notifications (id, user_id, title, body) values
  ('80000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000003', 'Student A notice', 'Private A'),
  ('80000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000004', 'Student B notice', 'Private B'),
  ('80000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000005', 'Other course notice', 'Private outsider');
insert into public.push_tokens (user_id, token, platform) values
  ('00000000-0000-4000-8000-000000000003', 'synthetic-permissions-token-a', 'ios'),
  ('00000000-0000-4000-8000-000000000004', 'synthetic-permissions-token-b', 'android'),
  ('00000000-0000-4000-8000-000000000005', 'synthetic-permissions-token-outsider', 'web');

insert into public.course_export_packages (id, course_id, requested_by, format) values
  ('90000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', 'json_zip');
insert into public.report_export_jobs (id, requested_by, report_kind, scope_course_id, format) values
  ('91000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', 'grade_rollups', '10000000-0000-4000-8000-000000000001', 'csv');

insert into public.live_sessions (id, course_id, host_id, title) values
  ('b0000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', 'Course A live'),
  ('b0000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', 'Course B live');
insert into public.live_attendance (session_id, user_id, status) values
  ('b0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000003', 'present'),
  ('b0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000004', 'late'),
  ('b0000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000005', 'present');

insert into public.surveys (id, course_id, title, is_anonymous, created_by) values
  ('c0000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Named course A survey', false, '00000000-0000-4000-8000-000000000002');

insert into public.peer_review_assignments (id, course_id, assignment_id, title, created_by) values
  ('f0000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Course A review', '00000000-0000-4000-8000-000000000002'),
  ('f0000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'Course B review', '00000000-0000-4000-8000-000000000001');
insert into public.peer_review_pairs (id, review_assignment_id, reviewer_id, reviewee_id, status) values
  ('f1000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000004', 'pending'),
  ('f1000000-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000003', 'pending'),
  ('f1000000-0000-4000-8000-000000000003', 'f0000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000001', 'pending'),
  ('f1000000-0000-4000-8000-000000000004', 'f0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000002', 'expired');
insert into public.rubrics (id, course_id, title, bound_kind, bound_id, created_by) values
  ('e0000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Course A rubric', 'assignment', '20000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'),
  ('e0000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'Course B rubric', 'assignment', '20000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001'),
  ('e0000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', 'Peer review rubric', 'peer_review', 'f0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'),
  ('e0000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001', 'Different assignment rubric', 'assignment', '20000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000002');
insert into public.rubric_criteria (id, rubric_id, name, weight, max_points) values
  ('e1000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 'Clarity', 2, 4),
  ('e1000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000003', 'Review quality', 1, 4);

-- No worker is invoked: these endpoints and secrets are inert synthetic test values.
insert into public.webhook_subscriptions (id, name, endpoint_url, signing_secret, event_types, created_by) values
  ('d0000000-0000-4000-8000-000000000001', 'Permissions test', 'https://example.invalid/never-called', 'synthetic-test-secret', array['permissions_test'], '00000000-0000-4000-8000-000000000001');
insert into public.webhook_deliveries (id, subscription_id, event_type, payload) values
  ('d1000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 'permissions_test', '{"synthetic":true}');
commit;

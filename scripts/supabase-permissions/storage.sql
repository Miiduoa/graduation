-- Policy regression on synthetic object metadata; all fixtures roll back.
\set ON_ERROR_STOP on
\set teacher 'a9000000-0000-4000-8000-000000000001'
\set student 'a9000000-0000-4000-8000-000000000002'
\set peer 'a9000000-0000-4000-8000-000000000003'
\set outsider 'a9000000-0000-4000-8000-000000000004'
\set admin 'a9000000-0000-4000-8000-000000000005'
\set course_a 'c9000000-0000-4000-8000-000000000001'
\set course_b 'c9000000-0000-4000-8000-000000000002'
\set assignment_a 'd9000000-0000-4000-8000-000000000001'
\set assignment_b 'd9000000-0000-4000-8000-000000000002'
\set assignment_next 'd9000000-0000-4000-8000-000000000003'
\set first_object 'e9000000-0000-4000-8000-000000000001'
\set first_path :course_a '/' :assignment_a '/' :student '/first.pdf'
\set next_path :course_a '/' :assignment_a '/' :student '/second.pdf'
\set peer_path :course_a '/' :assignment_a '/' :peer '/peer.pdf'
\set mismatched_path :course_a '/' :assignment_b '/' :student '/historical-mismatch.pdf'

begin;
-- The Storage API sets this trusted context before running DELETE policies.
select set_config('storage.allow_delete_query', 'true', true);
create temporary table storage_checks (label text, passed boolean) on commit drop;
grant insert, select on storage_checks to authenticated, anon, service_role;

create function pg_temp.expect_count(command text, expected bigint, label text) returns void
language plpgsql security invoker as $$
declare actual bigint;
begin
  begin
    execute command into actual;
    if actual is distinct from expected then
      raise no_data_found;
    end if;
    insert into storage_checks values (label, true);
  exception
    when no_data_found then insert into storage_checks values (label, false);
    when insufficient_privilege then insert into storage_checks values (label, expected = 0);
  end;
end $$;

create function pg_temp.expect_denied(command text, label text) returns void
language plpgsql security invoker as $$
begin
  begin
    execute command;
    -- Roll back an unexpected successful write before recording the failure.
    raise no_data_found;
  exception
    when insufficient_privilege then insert into storage_checks values (label, true);
    when no_data_found then insert into storage_checks values (label, false);
  end;
end $$;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
insert into auth.users (id, email) values
  (:'teacher', 'teacher@storage-permissions.test'),
  (:'student', 'student@storage-permissions.test'),
  (:'peer', 'peer@storage-permissions.test'),
  (:'outsider', 'outsider@storage-permissions.test'),
  (:'admin', 'admin@storage-permissions.test');
update public.profiles set role = 'admin' where id = :'admin';
update public.profiles set role = 'teacher' where id = :'teacher';
insert into public.courses (id, title, owner_id) values
  (:'course_a', 'Storage course A', :'teacher'),
  (:'course_b', 'Storage course B', :'admin');
insert into public.course_members (course_id, user_id, role) values
  (:'course_a', :'student', 'student'), (:'course_b', :'student', 'student'),
  (:'course_a', :'peer', 'student'), (:'course_b', :'outsider', 'student'),
  (:'course_a', :'admin', 'teacher');
insert into public.assignments (id, course_id, title, created_by) values
  (:'assignment_a', :'course_a', 'Storage assignment A', :'teacher'),
  (:'assignment_b', :'course_b', 'Storage assignment B', :'admin'),
  (:'assignment_next', :'course_a', 'Storage assignment next', :'teacher');
insert into storage.objects (bucket_id, name, owner) values ('submissions', :'peer_path', :'peer');
insert into storage.objects (bucket_id, name, owner) values ('submissions', :'mismatched_path', :'student');
insert into public.submissions (assignment_id, student_id, storage_path)
values (:'assignment_next', :'peer', :'peer_path' || '.legacy-missing');

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', :'student')::text, true);
select set_config('storage.operation', 'storage.object.sign_upload_url', true);
select pg_temp.expect_denied(format(
  'insert into storage.objects(bucket_id,name,owner) values (%L,%L,%L)',
  'submissions', :'first_path', :'student'), 'signed upload tokens cannot be issued for new paths');
select pg_temp.expect_denied(format(
  'insert into storage.objects(id,bucket_id,name,owner) values (%L,%L,%L,%L) on conflict(id) do update set owner=excluded.owner',
  :'first_object', 'submissions', :'first_path', :'student'), 'signed upsert tokens cannot be issued before the file exists');
select set_config('storage.operation', '', true);
select pg_temp.expect_denied(format(
  'insert into storage.objects(bucket_id,name,owner) values (%L,%L,%L)',
  'submissions', :'first_path', :'student'), 'uploads with missing operation context are denied');
select set_config('storage.operation', 'storage.object.unknown', true);
select pg_temp.expect_denied(format(
  'insert into storage.objects(bucket_id,name,owner) values (%L,%L,%L)',
  'submissions', :'first_path', :'student'), 'uploads with unknown operation context are denied');
select set_config('storage.operation', 'storage.object.upload', true);
select pg_temp.expect_count(format(
  'with inserted as (insert into storage.objects(id,bucket_id,name,owner) values (%L,%L,%L,%L) returning 1) select count(*) from inserted',
  :'first_object', 'submissions', :'first_path', :'student'), 1, 'active student uploads a new own attachment');
select pg_temp.expect_count(format(
  'with inserted as (insert into storage.objects(bucket_id,name,owner) values (%L,%L,%L) returning 1) select count(*) from inserted',
  'submissions', :'next_path', :'student'), 1, 'new filenames support later versions');
select pg_temp.expect_count(format('select count(*) from storage.objects where id=%L and name=%L', :'first_object', :'first_path'), 1, 'owner reads own attachment');
select pg_temp.expect_count(format('select count(*) from storage.objects where name=%L', :'peer_path'), 0, 'owner cannot read peer attachment');
select pg_temp.expect_count(format('select count(*) from storage.objects where name=%L', :'mismatched_path'), 0, 'historical mismatched path is hidden from owner');

select set_config('storage.operation', '', true);
select pg_temp.expect_count(format('select count(*) from storage.objects where name=%L', :'first_path'), 0, 'direct reads with missing operation context are denied');
select set_config('storage.operation', 'storage.object.unknown', true);
select pg_temp.expect_count(format('select count(*) from storage.objects where name=%L', :'first_path'), 0, 'reads with unknown operation context are denied');
select set_config('storage.operation', 'storage.object.sign', true);
select pg_temp.expect_count(format('select count(*) from storage.objects where name=%L', :'first_path'), 0, 'signed download tokens cannot be issued');
select set_config('storage.operation', 'storage.object.sign_many', true);
select pg_temp.expect_count(format('select count(*) from storage.objects where name=%L', :'first_path'), 0, 'bulk signed download tokens cannot be issued');
select set_config('storage.operation', 'storage.object.get_authenticated', true);
select pg_temp.expect_count(format('select count(*) from storage.objects where name=%L', :'first_path'), 1, 'authenticated download operation reads own attachment');
select set_config('storage.operation', 'storage.object.list', true);
select pg_temp.expect_count(format('select count(*) from storage.objects where name=%L', :'first_path'), 1, 'authenticated list operation reads own attachment');
select set_config('storage.operation', 'storage.object.list_v2', true);
select pg_temp.expect_count(format('select count(*) from storage.objects where name=%L', :'first_path'), 1, 'authenticated list v2 operation reads own attachment');
select set_config('storage.operation', 'object.get_authenticated_info', true);
select pg_temp.expect_count(format('select count(*) from storage.objects where name=%L', :'first_path'), 1, 'authenticated info operation reads own attachment');
select set_config('storage.operation', 'object.head_authenticated_info', true);
select pg_temp.expect_count(format('select count(*) from storage.objects where name=%L', :'first_path'), 1, 'authenticated head operation reads own attachment');
select set_config('storage.operation', 'storage.object.upload', true);

select pg_temp.expect_denied(format(
  'insert into storage.objects(bucket_id,name) values (%L,%L)',
  'submissions', :'course_a' || '/' || :'assignment_b' || '/' || :'student' || '/mismatched.pdf'),
  'assignment must belong to the course even when enrolled in both');
select pg_temp.expect_denied(format(
  'insert into storage.objects(bucket_id,name) values (%L,%L)',
  'submissions', :'course_a' || '/not-an-assignment/' || :'student' || '/unknown.pdf'),
  'malformed assignment path is denied');
select pg_temp.expect_denied(format(
  'insert into storage.objects(bucket_id,name) values (%L,%L)',
  'submissions', :'course_a' || '/' || :'assignment_a' || '/' || :'student' || '/'),
  'empty filename is denied');
select pg_temp.expect_denied(format(
  'insert into storage.objects(bucket_id,name) values (%L,%L)',
  'submissions', :'course_a' || '/' || :'assignment_a' || '/' || :'student' || '/../other.pdf'),
  'dot path segments are denied');
select pg_temp.expect_denied(format(
  'insert into storage.objects(bucket_id,name) values (%L,%L)',
  'submissions', :'course_a' || '/' || :'assignment_a' || '/' || :'peer' || '/forged.pdf'),
  'one student cannot upload for another');
select pg_temp.expect_count(format(
  'with changed as (update storage.objects set name=name||%L where name=%L returning 1) select count(*) from changed',
  '.changed', :'first_path'), 0, 'owner cannot overwrite or rename an uploaded object');
select pg_temp.expect_count(format(
  'with removed as (delete from storage.objects where name=%L returning 1) select count(*) from removed',
  :'first_path'), 0, 'owner cannot remove an uploaded object');
-- The shared id primary key reliably exercises the UPDATE arm. Storage releases
-- may use a partial/versioned name index instead of a (bucket_id,name) arbiter.
select set_config('storage.operation', 'storage.object.upload', true);
select pg_temp.expect_denied(format(
  'insert into storage.objects(id,bucket_id,name,owner) values (%L,%L,%L,%L) on conflict(id) do update set owner=excluded.owner',
  :'first_object', 'submissions', :'first_path', :'student'), 'upsert cannot replace an uploaded object');

-- PostgREST has no Storage operation. Only trigger-internal checks can read here.
select set_config('storage.operation', '', true);
select pg_temp.expect_denied(format(
  'insert into public.submissions(assignment_id,student_id,storage_path) values (%L,%L,%L)',
  :'assignment_a', :'student', :'peer_path'), 'receipt cannot claim a peer attachment');
select pg_temp.expect_denied(format(
  'insert into public.submissions(assignment_id,student_id,storage_path) values (%L,%L,%L)',
  :'assignment_a', :'student', :'first_path' || '.not-uploaded'), 'receipt requires the attachment to exist');
select pg_temp.expect_count(format(
  'with submitted as (insert into public.submissions(assignment_id,student_id,storage_path) values (%L,%L,%L) returning 1) select count(*) from submitted',
  :'assignment_a', :'student', :'first_path'), 1, 'own uploaded attachment can be submitted');
select pg_temp.expect_denied(format(
  'update public.submissions set storage_path=%L where assignment_id=%L and student_id=%L',
  :'peer_path', :'assignment_a', :'student'), 'receipt update cannot claim a peer attachment');
select pg_temp.expect_count(format(
  'with changed as (update public.submissions set storage_path=%L where assignment_id=%L and student_id=%L returning 1) select count(*) from changed',
  :'next_path', :'assignment_a', :'student'), 1, 'ungraded receipt can select a new uploaded filename');
select pg_temp.expect_denied(format(
  'insert into public.submissions(assignment_id,student_id,storage_path) values (%L,%L,%L)',
  :'assignment_next', :'student', :'first_path'), 'receipt cannot reuse another assignment attachment');

select set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', :'teacher')::text, true);
select set_config('storage.operation', 'storage.object.get_authenticated', true);
select pg_temp.expect_count(format('select count(*) from storage.objects where name=%L', :'next_path'), 1, 'current teacher reads attachment');
select pg_temp.expect_count(format('select count(*) from storage.objects where name=%L', :'mismatched_path'), 0, 'historical mismatched path is hidden from teacher');
select pg_temp.expect_count(format(
  'with changed as (update public.submissions set grade=87,graded_at=statement_timestamp(),graded_by=auth.uid() where assignment_id=%L and student_id=%L returning 1) select count(*) from changed',
  :'assignment_a', :'student'), 1, 'teacher can grade without changing attachment');
select pg_temp.expect_count(format(
  'with changed as (update public.submissions set grade=70,graded_at=statement_timestamp(),graded_by=auth.uid() where assignment_id=%L and student_id=%L returning 1) select count(*) from changed',
  :'assignment_next', :'peer'), 1, 'legacy receipt with unchanged missing pointer remains gradable');
select pg_temp.expect_count(format(
  'with changed as (update storage.objects set name=name||%L where name=%L returning 1) select count(*) from changed',
  '.teacher-changed', :'next_path'), 0, 'teacher cannot rewrite submission evidence');
select pg_temp.expect_count(format(
  'with removed as (delete from storage.objects where name=%L returning 1) select count(*) from removed',
  :'next_path'), 0, 'teacher cannot remove submission evidence');

-- Restrictions apply only to submissions; ordinary teaching material stays editable.
insert into storage.objects(bucket_id,name) values ('materials', :'course_a' || '/lesson.pdf');
select pg_temp.expect_denied(format(
  'update storage.objects set bucket_id=%L,name=%L where bucket_id=%L and name=%L',
  'submissions', :'course_a' || '/' || :'assignment_a' || '/' || :'teacher' || '/moved.pdf',
  'materials', :'course_a' || '/lesson.pdf'), 'material updates cannot move objects into submissions');
select pg_temp.expect_count(format(
  'with changed as (update storage.objects set name=%L where bucket_id=%L and name=%L returning 1) select count(*) from changed',
  :'course_a' || '/lesson-v2.pdf', 'materials', :'course_a' || '/lesson.pdf'), 1, 'teacher still updates course material');
select pg_temp.expect_count(format(
  'with removed as (delete from storage.objects where bucket_id=%L and name=%L returning 1) select count(*) from removed',
  'materials', :'course_a' || '/lesson-v2.pdf'), 1, 'teacher still deletes course material');

select set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', :'student')::text, true);
select pg_temp.expect_denied(format(
  'update public.submissions set storage_path=%L where assignment_id=%L and student_id=%L',
  :'first_path', :'assignment_a', :'student'), 'graded receipt cannot switch attachment');

select set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', :'admin')::text, true);
select pg_temp.expect_count(format('select count(*) from storage.objects where name=%L', :'next_path'), 1, 'administrator with course access reads evidence');
select pg_temp.expect_count(format(
  'with changed as (update public.submissions set grade=88,graded_by=auth.uid() where assignment_id=%L and student_id=%L returning 1) select count(*) from changed',
  :'assignment_a', :'student'), 1, 'administrator with course access can grade');
select pg_temp.expect_count(format(
  'with removed as (delete from storage.objects where name=%L returning 1) select count(*) from removed',
  :'next_path'), 0, 'administrator client cannot remove evidence');

select set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', :'outsider')::text, true);
select pg_temp.expect_count(format('select count(*) from storage.objects where name=%L', :'first_path'), 0, 'other course cannot read attachment');

reset role;
delete from public.course_members where course_id=:'course_a' and user_id in (:'student', :'teacher');
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', :'student')::text, true);
select pg_temp.expect_count(format('select count(*) from storage.objects where name=%L', :'first_path'), 0, 'former owner loses read access after unenrollment');
select set_config('storage.operation', 'storage.object.upload', true);
select pg_temp.expect_denied(format(
  'insert into storage.objects(bucket_id,name) values (%L,%L)',
  'submissions', :'first_path' || '.revoked'), 'former member cannot add new attachments');
select pg_temp.expect_count(format(
  'with changed as (update storage.objects set name=name||%L where name=%L returning 1) select count(*) from changed',
  '.revoked', :'first_path'), 0, 'former owner cannot rename evidence');
select set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', :'teacher')::text, true);
select pg_temp.expect_count(format('select count(*) from storage.objects where name=%L', :'first_path'), 0, 'former teacher loses read access');

reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select pg_temp.expect_count(format('select count(*) from storage.objects where name=%L', :'first_path'), 0, 'anonymous users cannot read evidence');

reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select pg_temp.expect_count(format('select count(*) from storage.objects where name=%L', :'next_path'), 0, 'authenticated role without identity cannot read evidence');
select pg_temp.expect_denied(format(
  'insert into storage.objects(bucket_id,name) values (%L,%L)',
  'submissions', :'first_path' || '.missing-identity'), 'upload requires an authenticated user identity');

reset role;
do $$
declare failures text;
begin
  select string_agg(label, E'\n') filter (where not passed) into failures from storage_checks;
  if failures is not null then
    raise exception 'Storage policy regression failures:%', E'\n' || failures;
  end if;
end $$;
select format('Passed %s submission storage policy assertions', count(*)) from storage_checks;
rollback;

begin;

-- Resolve both path identifiers against the current assignment and enrollment.
-- CASE keeps malformed object names from causing an invalid-UUID exception.
drop policy submissions_bucket_select on storage.objects;
create policy submissions_bucket_select on storage.objects
  for select to authenticated using (
    bucket_id = 'submissions'
    and (
      current_setting('storage.operation', true) in (
        'storage.object.upload', 'storage.object.get_authenticated',
        'storage.object.list', 'storage.object.list_v2',
        'object.get_authenticated_info', 'object.head_authenticated_info'
      )
      -- Data API receipt validation runs inside the trigger below. Empty or
      -- unknown operations otherwise fail closed, including URL signing.
      or (pg_trigger_depth() > 0 and coalesce(current_setting('storage.operation', true), '') = '')
    )
    and split_part(name, '/', 4) <> ''
    and name !~ '(^|/)([.]{1,2})?(/|$)'
    and exists (
      select 1 from public.assignments a
      where a.id = case
        when split_part(name, '/', 2) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then split_part(name, '/', 2)::uuid
      end
      and a.course_id::text = split_part(name, '/', 1)
      and public.is_course_member(a.course_id)
      and (
        split_part(name, '/', 3) = auth.uid()::text
        or public.is_course_teacher(a.course_id)
        or public.course_member_has_capability(a.course_id, 'assignments.grade')
      )
    )
  );

drop policy submissions_bucket_insert on storage.objects;
create policy submissions_bucket_insert on storage.objects
  for insert to authenticated with check (
    bucket_id = 'submissions'
    -- Signed upload tokens are executed by Storage as a privileged role. A
    -- token minted for a new path with upsert enabled could later replace it.
    -- Require a normal authenticated upload with a current authorization check.
    and current_setting('storage.operation', true) = 'storage.object.upload'
    and split_part(name, '/', 3) = auth.uid()::text
    and split_part(name, '/', 4) <> ''
    and name !~ '(^|/)([.]{1,2})?(/|$)'
    and exists (
      select 1 from public.assignments a
      where a.id = case
        when split_part(name, '/', 2) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then split_part(name, '/', 2)::uuid
      end
      and a.course_id::text = split_part(name, '/', 1)
      and public.is_course_member(a.course_id)
    )
  );

-- Uploaded submission objects are immutable for every client, including staff.
-- New versions use new filenames. This also closes the upload/grading race.
-- Restrictive checks prevent other bucket policies from moving objects here.
drop policy submissions_bucket_update on storage.objects;
create policy submissions_bucket_update on storage.objects
  as restrictive for update to authenticated
  using (bucket_id <> 'submissions')
  with check (bucket_id <> 'submissions');

drop policy submissions_bucket_delete on storage.objects;
create policy submissions_bucket_delete on storage.objects
  as restrictive for delete to authenticated
  using (bucket_id <> 'submissions');

-- Bind each new receipt pointer to an existing attachment for that assignment
-- and student. An unchanged legacy pointer must still permit ordinary grading.
create function public.protect_submission_attachment()
returns trigger
language plpgsql security invoker
set search_path = pg_catalog, public
as $$
declare v_course uuid;
begin
  if current_user <> 'authenticated' or new.storage_path is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.storage_path is not distinct from old.storage_path then
    return new;
  end if;

  select a.course_id into v_course
  from public.assignments a where a.id = new.assignment_id;

  if v_course is null
     or split_part(new.storage_path, '/', 1) <> v_course::text
     or split_part(new.storage_path, '/', 2) <> new.assignment_id::text
     or split_part(new.storage_path, '/', 3) <> new.student_id::text
     or split_part(new.storage_path, '/', 4) = ''
     or new.storage_path ~ '(^|/)([.]{1,2})?(/|$)'
     or not exists (
       select 1 from storage.objects o
       where o.bucket_id = 'submissions' and o.name = new.storage_path
     ) then
    raise exception 'Submission attachment must be an uploaded file for this assignment and student'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.protect_submission_attachment()
  from public, anon, authenticated, service_role;

create trigger submissions_protect_attachment
  before insert or update on public.submissions
  for each row execute function public.protect_submission_attachment();

commit;

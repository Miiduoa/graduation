-- Restore missing grading objects and preserve their existing privileges.
-- BEFORE row trigger order: attachment -> grading -> integrity (alphabetical).
-- 095011 stamps student resubmissions with statement_timestamp() in grading.
-- Patch only the known production integrity snapshot to accept that receipt;
-- reject unknown definitions and recognize the replacement on repeat runs.
-- Preserve SECURITY DEFINER, search_path, ACL and every other integrity check.
-- Integrity still recognizes teachers/platform admins, not assignments.grade
-- alone, and freezes group_id; privileged writes with auth.uid() face its checks.
begin;
set local lock_timeout = '5s';

do $baseline$
begin
  if pg_catalog.to_regprocedure('public.protect_submission_grading()') is null then
    create function public.protect_submission_grading()
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
    comment on function public.protect_submission_grading() is '20261106095010_restore_submission_grading_baseline';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_trigger
    where tgrelid = 'public.submissions'::regclass
      and tgname = 'submissions_protect_grading'
  ) then
    create trigger submissions_protect_grading
      before insert or update on public.submissions
      for each row execute function public.protect_submission_grading();
    comment on trigger submissions_protect_grading on public.submissions
      is '20261106095010_restore_submission_grading_baseline';
  end if;
end;
$baseline$;

-- Accept only the production snapshot or this exact compatible replacement.
-- CREATE OR REPLACE preserves the existing owner, ACL and function comment.
do $integrity_compat$
declare
  v_source_md5 text;
begin
  select pg_catalog.md5(prosrc) into v_source_md5
  from pg_catalog.pg_proc
  where oid = pg_catalog.to_regprocedure('public.protect_submission_integrity()');

  if v_source_md5 is null or v_source_md5 = 'f37c1736202222613e018f286f2ffdd9' then
    return;
  end if;
  if v_source_md5 <> 'af0334917bdf82821475e917f2826dc5' then
    raise exception 'Unexpected public.protect_submission_integrity() definition';
  end if;

CREATE OR REPLACE FUNCTION public.protect_submission_integrity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_course uuid;
  v_is_staff boolean := false;
begin
  if auth.uid() is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    select a.course_id into v_course
    from public.assignments a
    where a.id = new.assignment_id;

    v_is_staff := coalesce(public.is_course_teacher(v_course), false)
                  or public.is_platform_admin();

    if not v_is_staff then
      new.student_id := auth.uid();
      new.submitted_at := now();
      new.grade := null;
      new.feedback := null;
      new.graded_at := null;
      new.graded_by := null;
    end if;
    return new;
  end if;

  if new.assignment_id is distinct from old.assignment_id
     or new.student_id is distinct from old.student_id
     or new.group_id is distinct from old.group_id then
    raise exception 'submission identity is immutable';
  end if;

  select a.course_id into v_course
  from public.assignments a
  where a.id = old.assignment_id;

  v_is_staff := coalesce(public.is_course_teacher(v_course), false)
                or public.is_platform_admin();

  if not v_is_staff then
    if new.grade is distinct from old.grade
       or new.feedback is distinct from old.feedback
       or new.graded_at is distinct from old.graded_at
       or new.graded_by is distinct from old.graded_by then
      raise exception 'grading fields are staff-managed';
    end if;
    if new.submitted_at is distinct from old.submitted_at
       and new.submitted_at is distinct from statement_timestamp() then
      raise exception 'submitted_at is server-managed';
    end if;
  end if;

  return new;
end;
$function$
;
end;
$integrity_compat$;

commit;

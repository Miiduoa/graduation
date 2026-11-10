-- Use only to undo the baseline before applying the three following migrations.
-- Object comments record creation independently of the migration ledger.
-- Existing unmarked objects are preserved; do not remove or copy these markers.
begin;
set local lock_timeout = '5s';

do $rollback$
begin
  if exists (
    select 1 from supabase_migrations.schema_migrations
    where version = '20261021055702'
  ) then
    raise notice '055702 is recorded; baseline rollback skipped';
    return;
  end if;

  -- 後續三份已登錄時不可單獨回滾基線（會拿掉 095011 的批改防護）；改用整批回滾。
  if exists (
    select 1 from supabase_migrations.schema_migrations
    where version in ('20261106095011', '20261106123311', '20261106131129')
  ) then
    raise exception 'later submission migrations are recorded; use the batch rollback instead';
  end if;

  if exists (
    select 1 from pg_catalog.pg_trigger
    where tgrelid = 'public.submissions'::regclass
      and tgname = 'submissions_protect_grading'
      and pg_catalog.obj_description(oid, 'pg_trigger') = '20261106095010_restore_submission_grading_baseline'
  ) then
    drop trigger submissions_protect_grading on public.submissions;
  end if;

  if pg_catalog.obj_description(
    pg_catalog.to_regprocedure('public.protect_submission_grading()'), 'pg_proc'
  ) = '20261106095010_restore_submission_grading_baseline' then
    drop function public.protect_submission_grading();
  end if;
  -- Restore only the exact integrity body installed by this baseline.
  -- CREATE OR REPLACE preserves the existing owner, ACL and function comment.
  if (
    select pg_catalog.md5(prosrc) from pg_catalog.pg_proc
    where oid = pg_catalog.to_regprocedure('public.protect_submission_integrity()')
  ) = 'f37c1736202222613e018f286f2ffdd9' then
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
    if new.submitted_at is distinct from old.submitted_at then
      raise exception 'submitted_at is server-managed';
    end if;
  end if;

  return new;
end;
$function$
;
  end if;
end;
$rollback$;

commit;

-- 前提：僅適用於正式未套用 20261021055702 的環境，還原至本次正式 DDL 快照。
-- 副作用：恢復原本較寬鬆的存取規則；已上傳附件、繳交紀錄與其他使用者資料皆保留。
-- 不適用於其後已有其他相依變更的環境；請先停止相關部署與寫入。
begin;
set local lock_timeout = '5s';

do $precondition$
begin
  if exists (
    select 1 from supabase_migrations.schema_migrations
    where version = '20261021055702'
  ) then
    raise exception '055702 is recorded; batch rollback is not applicable';
  end if;
end;
$precondition$;

do $integrity_restore$
begin
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
$integrity_restore$;

alter function public.search_course(uuid, text) security definer;

CREATE OR REPLACE FUNCTION public.issue_media_play_token(p_material_id uuid, p_device_fingerprint text DEFAULT NULL::text, p_ttl_seconds integer DEFAULT 600)
 RETURNS TABLE(token text, expires_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_material record;
  v_token text;
  v_expires timestamptz;
  v_ttl integer;
begin
  if auth.uid() is null then
    raise exception 'unauthenticated';
  end if;

  v_ttl := greatest(coalesce(p_ttl_seconds, 600), 30);
  if v_ttl > 3600 then v_ttl := 3600; end if;

  select cm.id, cm.course_id, cm.external_url, cm.mime_type
    into v_material
  from public.course_materials cm
  where cm.id = p_material_id;

  if v_material.id is null then
    raise exception 'material not found';
  end if;

  if not public.is_course_member(v_material.course_id) then
    raise exception 'not a course member';
  end if;

  v_token := encode(gen_random_bytes(32), 'hex');
  v_expires := now() + make_interval(secs => v_ttl);

  insert into public.media_play_tokens (
    material_id, course_id, user_id, token, device_fingerprint, expires_at
  ) values (
    p_material_id, v_material.course_id, auth.uid(), v_token,
    nullif(p_device_fingerprint, ''), v_expires
  );

  return query select v_token, v_expires;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.consume_media_play_token(p_token text, p_signed_url_hint text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row record;
begin
  if auth.uid() is null then
    raise exception 'unauthenticated';
  end if;

  if p_token is null or length(p_token) < 32 then
    raise exception 'invalid token';
  end if;

  select * into v_row
  from public.media_play_tokens
  where token = p_token
    and user_id = auth.uid();

  if v_row.id is null then
    return false;
  end if;

  if v_row.revoked_at is not null then
    return false;
  end if;

  if v_row.expires_at < now() then
    return false;
  end if;

  if v_row.consumed_at is not null then
    return false; -- one-time only
  end if;

  update public.media_play_tokens
  set consumed_at = now(),
      signed_url_used = nullif(p_signed_url_hint, '')
  where id = v_row.id;

  return true;
end;
$function$
;

-- Restore the exported EXECUTE ACLs (CREATE OR REPLACE preserves ownership).
revoke all on function public.search_course(uuid, text),
  public.issue_media_play_token(uuid, text, integer),
  public.consume_media_play_token(text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.search_course(uuid, text) to public;
grant execute on function public.search_course(uuid, text),
  public.issue_media_play_token(uuid, text, integer),
  public.consume_media_play_token(text, text)
  to postgres, anon, authenticated, service_role;

-- These four functions originally had no per-function search_path setting.
alter function public._quiz_normalize_answer(text, jsonb) reset search_path;
alter function public._quiz_answer_correct(text, jsonb, jsonb) reset search_path;
alter function public.quiz_attempts_before_insert_guard() reset search_path;
alter function public.set_updated_at() reset search_path;

drop policy if exists submissions_bucket_delete on storage.objects;
create policy submissions_bucket_delete on storage.objects as PERMISSIVE for DELETE to public using (((bucket_id = 'submissions'::text) AND ((auth.uid() = (split_part(name, '/'::text, 3))::uuid) OR is_course_teacher((split_part(name, '/'::text, 1))::uuid))));

drop policy if exists submissions_bucket_insert on storage.objects;
create policy submissions_bucket_insert on storage.objects as PERMISSIVE for INSERT to public with check (((bucket_id = 'submissions'::text) AND is_course_member((split_part(name, '/'::text, 1))::uuid) AND (auth.uid() = (split_part(name, '/'::text, 3))::uuid)));

drop policy if exists submissions_bucket_select on storage.objects;
create policy submissions_bucket_select on storage.objects as PERMISSIVE for SELECT to public using (((bucket_id = 'submissions'::text) AND (((split_part(name, '/'::text, 4) <> ''::text) AND (auth.uid() = (split_part(name, '/'::text, 3))::uuid)) OR is_course_teacher((split_part(name, '/'::text, 1))::uuid))));

drop policy if exists submissions_bucket_update on storage.objects;
create policy submissions_bucket_update on storage.objects as PERMISSIVE for UPDATE to public using (((bucket_id = 'submissions'::text) AND ((auth.uid() = (split_part(name, '/'::text, 3))::uuid) OR is_course_teacher((split_part(name, '/'::text, 1))::uuid))));

drop trigger if exists submissions_protect_attachment on public.submissions;
drop trigger if exists submissions_protect_grading on public.submissions;
drop function if exists public.protect_submission_attachment();
drop function if exists public.protect_submission_grading();
drop function if exists public.playable_material_course(uuid);

-- Only migration metadata is deleted; no application or storage rows are changed.
delete from supabase_migrations.schema_migrations
where version in (
  '20261106095010', '20261106095011', '20261106123311', '20261106131129'
);

commit;

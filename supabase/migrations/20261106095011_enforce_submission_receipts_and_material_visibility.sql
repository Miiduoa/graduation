begin;

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
    new.id is distinct from old.id
    or new.assignment_id is distinct from old.assignment_id
    or new.student_id is distinct from old.student_id
  ) then
    raise exception 'Submission identity cannot be changed'
      using errcode = '42501';
  end if;

  -- Clients may still send a device timestamp. Only a content change starts
  -- a new receipt; grading, retries and timestamp-only writes keep the old one.
  if current_user = 'authenticated' then
    if tg_op = 'INSERT' then
      new.submitted_at := statement_timestamp();
    elsif row(new.body_text, new.storage_path, new.group_id)
        is distinct from row(old.body_text, old.storage_path, old.group_id) then
      if old.graded_at is not null and old.student_id = auth.uid() then
        raise exception 'Graded submission cannot be resubmitted' using errcode = '42501';
      end if;
      new.submitted_at := statement_timestamp();
    else
      new.submitted_at := old.submitted_at;
    end if;
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

-- The search view already uses the caller's RLS. Its RPC must do the same.
alter function public.search_course(uuid, text) security invoker;

-- Both privileged token writes consult the current material and enrollment.
-- Keep this lookup internal so a caller cannot probe unpublished material IDs.
create function public.playable_material_course(p_material_id uuid)
returns uuid
language sql stable security invoker
set search_path = pg_catalog, public
as $$
  select m.course_id from public.course_materials m
  where m.id = p_material_id and public.is_course_member(m.course_id)
    and (public.is_course_staff(m.course_id)
      or (m.is_published and (m.publish_at is null or m.publish_at <= statement_timestamp())));
$$;
revoke all on function public.playable_material_course(uuid) from public, anon, authenticated, service_role;

create or replace function public.issue_media_play_token(
  p_material_id uuid, p_device_fingerprint text default null, p_ttl_seconds integer default 600
)
returns table (token text, expires_at timestamptz)
language plpgsql security definer
set search_path = pg_catalog, extensions, public
as $$
declare
  v_course uuid := public.playable_material_course(p_material_id);
begin
  if v_course is null then
    raise exception 'Material unavailable' using errcode = '42501';
  end if;

  return query
    insert into public.media_play_tokens as t
      (material_id, course_id, user_id, token, device_fingerprint, expires_at)
    values (p_material_id, v_course, auth.uid(), encode(gen_random_bytes(32), 'hex'),
      nullif(p_device_fingerprint, ''),
      statement_timestamp() + make_interval(secs => least(greatest(coalesce(p_ttl_seconds, 600), 30), 3600)))
    returning t.token, t.expires_at;
end;
$$;

create or replace function public.consume_media_play_token(p_token text, p_signed_url_hint text default null)
returns boolean
language plpgsql security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null then raise exception 'unauthenticated'; end if;
  if p_token is null or length(p_token) < 32 then raise exception 'invalid token'; end if;

  update public.media_play_tokens t
  set consumed_at = clock_timestamp(), signed_url_used = nullif(p_signed_url_hint, '')
  where t.token = p_token and t.user_id = auth.uid()
    and t.consumed_at is null and t.revoked_at is null and t.expires_at > clock_timestamp()
    and t.course_id = public.playable_material_course(t.material_id);
  return found;
end;
$$;

commit;

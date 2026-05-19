-- Live session attendance time windows + RPC-only student check-in

alter table public.live_sessions
  add column if not exists attendance_open_at timestamptz,
  add column if not exists attendance_close_at timestamptz,
  add column if not exists attendance_late_cutoff_at timestamptz;

comment on column public.live_sessions.attendance_open_at is '簽到開放時間（NULL 搭配下方規則：若三者皆 NULL 則不限時間）';
comment on column public.live_sessions.attendance_close_at is '簽到截止時間';
comment on column public.live_sessions.attendance_late_cutoff_at is '超過此時間戳仍可在截止前簽到，但標記為 late（NULL 表示窗口內皆 present）';

-- Students must use RPC (security definer) so rules are enforced server-side
drop policy if exists live_attendance_insert_self on public.live_attendance;
drop policy if exists live_attendance_insert_blocked on public.live_attendance;

create policy live_attendance_insert_blocked on public.live_attendance
  for insert with check (false);

create or replace function public.record_live_attendance(p_session_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_course uuid;
  v_status text not null default 'scheduled';
  v_open timestamptz;
  v_close timestamptz;
  v_late_cut timestamptz;
  v_final text;
  v_now timestamptz := now();
begin
  if auth.uid() is null then
    raise exception '未登入';
  end if;

  select ls.course_id, ls.status, ls.attendance_open_at, ls.attendance_close_at, ls.attendance_late_cutoff_at
    into v_course, v_status, v_open, v_close, v_late_cut
  from public.live_sessions ls
  where ls.id = p_session_id;

  if v_course is null then
    raise exception '無效的 Session';
  end if;

  if not public.is_course_member(v_course) then
    raise exception '非課程成員';
  end if;

  if v_status <> 'live' then
    raise exception '課堂未進行中';
  end if;

  -- 無開始／結束限制（維持舊版「隨時可簽」）
  if v_open is null and v_close is null then
    v_final := 'present';
  else
    if v_open is not null and v_now < v_open then
      raise exception '簽到尚未開放';
    end if;
    if v_close is not null and v_now > v_close then
      raise exception '簽到已截止';
    end if;
    if v_late_cut is not null and v_now > v_late_cut then
      v_final := 'late';
    else
      v_final := 'present';
    end if;
  end if;

  insert into public.live_attendance (session_id, user_id, status, recorded_at)
  values (p_session_id, auth.uid(), v_final, v_now)
  on conflict (session_id, user_id)
  do update set status = excluded.status, recorded_at = excluded.recorded_at;

  return v_final;
end;
$$;

grant execute on function public.record_live_attendance(uuid) to authenticated;

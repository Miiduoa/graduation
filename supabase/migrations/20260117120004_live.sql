-- Interactive classroom sessions + deterministic buzzer winner (RPC)

create table public.live_sessions (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses (id) on delete cascade,
  host_id uuid not null references public.profiles (id),
  title text not null default '',
  status text not null default 'live' check (status in ('scheduled', 'live', 'ended')),
  started_at timestamptz not null default now(),
  ended_at timestamptz
);

create index live_sessions_course_idx on public.live_sessions (course_id);

create table public.live_buzzer_state (
  session_id uuid primary key references public.live_sessions (id) on delete cascade,
  winner_user_id uuid not null references public.profiles (id),
  claimed_at timestamptz not null default now()
);

alter table public.live_sessions enable row level security;
alter table public.live_buzzer_state enable row level security;

create policy live_sessions_select on public.live_sessions
  for select using (public.is_course_member(course_id));

create policy live_sessions_insert on public.live_sessions
  for insert with check (
    public.is_course_teacher(course_id)
    and host_id = auth.uid()
  );

create policy live_sessions_update_host on public.live_sessions
  for update using (
    host_id = auth.uid()
    or public.is_course_teacher(course_id)
  )
  with check (
    public.is_course_teacher(course_id)
  );

create policy live_sessions_delete_teacher on public.live_sessions
  for delete using (public.is_course_teacher(course_id));

create policy live_buzzer_select on public.live_buzzer_state
  for select using (
    exists (
      select 1 from public.live_sessions ls
      where ls.id = live_buzzer_state.session_id
        and public.is_course_member(ls.course_id)
    )
  );

create policy live_buzzer_teacher_all on public.live_buzzer_state
  for all using (
    exists (
      select 1 from public.live_sessions ls
      where ls.id = live_buzzer_state.session_id
        and public.is_course_teacher(ls.course_id)
    )
  )
  with check (
    exists (
      select 1 from public.live_sessions ls
      where ls.id = session_id
        and public.is_course_teacher(ls.course_id)
    )
  );

-- First caller wins; enforced by PK on session_id + transactional insert
create or replace function public.claim_live_buzzer(p_session_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  affected integer;
begin
  if auth.uid() is null then
    raise exception '未登入';
  end if;

  if not exists (
    select 1 from public.live_sessions ls
    where ls.id = p_session_id
      and ls.status = 'live'
      and public.is_course_member(ls.course_id)
  ) then
    raise exception '無效的課堂或尚未開始';
  end if;

  insert into public.live_buzzer_state (session_id, winner_user_id)
  values (p_session_id, auth.uid())
  on conflict (session_id) do nothing;

  get diagnostics affected = ROW_COUNT;
  return affected > 0;
end;
$$;

grant execute on function public.claim_live_buzzer(uuid) to authenticated;

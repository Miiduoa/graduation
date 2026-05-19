-- TronClass 對齊擴充：點名、彈幕、通知、推播 token、教材進度、討論鎖帖／軟刪、測驗多次作答／限时、管理員唯讀、RPC

-- ── Helpers ─────────────────────────────────────────────────────────────
create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  );
$$;

-- ── Live attendance ─────────────────────────────────────────────────────
create table public.live_attendance (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.live_sessions (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'present' check (status in ('present', 'late', 'absent')),
  recorded_at timestamptz not null default now(),
  unique (session_id, user_id)
);

create index live_attendance_session_idx on public.live_attendance (session_id);

alter table public.live_attendance enable row level security;

create policy live_attendance_select on public.live_attendance
  for select using (
    exists (
      select 1 from public.live_sessions ls
      where ls.id = live_attendance.session_id
        and public.is_course_member(ls.course_id)
    )
  );

create policy live_attendance_insert_self on public.live_attendance
  for insert with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.live_sessions ls
      where ls.id = session_id
        and ls.status = 'live'
        and public.is_course_member(ls.course_id)
    )
  );

create policy live_attendance_update_teacher on public.live_attendance
  for update using (
    exists (
      select 1 from public.live_sessions ls
      where ls.id = live_attendance.session_id
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

create policy live_attendance_delete_teacher on public.live_attendance
  for delete using (
    exists (
      select 1 from public.live_sessions ls
      where ls.id = live_attendance.session_id
        and public.is_course_teacher(ls.course_id)
    )
  );

do $$
begin
  alter publication supabase_realtime add table public.live_attendance;
exception
  when undefined_object then null;
  when duplicate_object then null;
end $$;

alter table public.live_attendance replica identity full;

-- ── Live chat (persisted danmaku) ───────────────────────────────────────
create table public.live_chat_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.live_sessions (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (length(trim(body)) > 0),
  created_at timestamptz not null default now()
);

create index live_chat_session_created_idx on public.live_chat_messages (session_id, created_at desc);

alter table public.live_chat_messages enable row level security;

create policy live_chat_select on public.live_chat_messages
  for select using (
    exists (
      select 1 from public.live_sessions ls
      where ls.id = live_chat_messages.session_id
        and public.is_course_member(ls.course_id)
    )
  );

create policy live_chat_insert on public.live_chat_messages
  for insert with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.live_sessions ls
      where ls.id = session_id
        and ls.status = 'live'
        and public.is_course_member(ls.course_id)
    )
  );

-- Enable Realtime (hosted Supabase); ignore errors on self-hosted without publication
do $$
begin
  alter publication supabase_realtime add table public.live_chat_messages;
exception
  when undefined_object then null;
  when duplicate_object then null;
end $$;

alter table public.live_chat_messages replica identity full;

-- ── Notifications + push tokens ─────────────────────────────────────────
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  title text not null,
  body text not null default '',
  read_at timestamptz,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index notifications_user_created_idx on public.notifications (user_id, created_at desc);

alter table public.notifications enable row level security;

create policy notifications_own_select on public.notifications
  for select using (user_id = auth.uid());

create policy notifications_own_update on public.notifications
  for update using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy notifications_own_delete on public.notifications
  for delete using (user_id = auth.uid());

create table public.push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  token text not null,
  platform text not null default '' check (platform in ('ios', 'android', 'web', '')),
  updated_at timestamptz not null default now(),
  unique (user_id, token)
);

alter table public.push_tokens enable row level security;

create policy push_tokens_own_all on public.push_tokens
  for all using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ── Material progress ───────────────────────────────────────────────────
create table public.material_progress (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null references public.course_materials (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  progress numeric not null default 0 check (progress >= 0 and progress <= 1),
  last_seconds numeric not null default 0 check (last_seconds >= 0),
  opened_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (material_id, user_id)
);

create index material_progress_user_idx on public.material_progress (user_id);

alter table public.material_progress enable row level security;

create policy material_progress_select on public.material_progress
  for select using (
    user_id = auth.uid()
    or exists (
      select 1 from public.course_materials m
      where m.id = material_progress.material_id
        and public.is_course_teacher(m.course_id)
    )
  );

create policy material_progress_upsert_self on public.material_progress
  for insert with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.course_materials m
      where m.id = material_id
        and public.is_course_member(m.course_id)
    )
  );

create policy material_progress_update_self on public.material_progress
  for update using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy material_progress_delete_self on public.material_progress
  for delete using (user_id = auth.uid());

-- ── Forum moderation ──────────────────────────────────────────────────────
alter table public.forum_topics
  add column if not exists locked_at timestamptz,
  add column if not exists locked_by uuid references public.profiles (id);

alter table public.forum_posts
  add column if not exists deleted_at timestamptz;

drop policy if exists forum_posts_select on public.forum_posts;

create policy forum_posts_select on public.forum_posts
  for select using (
    exists (
      select 1 from public.forum_topics t
      where t.id = forum_posts.topic_id
        and public.is_course_member(t.course_id)
    )
    and (
      forum_posts.deleted_at is null
      or exists (
        select 1 from public.forum_topics t2
        where t2.id = forum_posts.topic_id
          and public.is_course_teacher(t2.course_id)
      )
    )
  );

drop policy if exists forum_posts_insert on public.forum_posts;

create policy forum_posts_insert on public.forum_posts
  for insert with check (
    author_id = auth.uid()
    and deleted_at is null
    and exists (
      select 1 from public.forum_topics t
      where t.id = topic_id
        and public.is_course_member(t.course_id)
        and (
          t.locked_at is null
          or public.is_course_teacher(t.course_id)
        )
    )
  );

-- ── Quiz: multiple attempts + enforce flags ─────────────────────────────
alter table public.quizzes
  add column if not exists max_attempts integer not null default 1 check (max_attempts >= 1 and max_attempts <= 50),
  add column if not exists enforce_time_limit boolean not null default true;

alter table public.quiz_attempts drop constraint if exists quiz_attempts_quiz_id_student_id_key;

alter table public.quiz_attempts
  add column if not exists attempt_no integer not null default 1 check (attempt_no >= 1);

update public.quiz_attempts set attempt_no = 1 where attempt_no is null;

alter table public.quiz_attempts
  add constraint quiz_attempts_quiz_student_attempt_no_unique unique (quiz_id, student_id, attempt_no);

-- Replace submit with time-limit check
create or replace function public.submit_quiz_attempt(p_attempt_id uuid)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_score numeric := 0;
  r record;
  v_quiz_id uuid;
  v_started timestamptz;
  v_limit integer;
  v_enforce boolean;
  r_elapsed numeric;
begin
  select qa.quiz_id, qa.started_at
    into v_quiz_id, v_started
  from public.quiz_attempts qa
  where qa.id = p_attempt_id
    and qa.student_id = auth.uid()
    and qa.submitted_at is null;

  if v_quiz_id is null then
    raise exception '無效的作答紀錄或已繳交';
  end if;

  select q.time_limit_seconds, q.enforce_time_limit
    into v_limit, v_enforce
  from public.quizzes q
  where q.id = v_quiz_id;

  if coalesce(v_enforce, true)
    and v_limit is not null
    and extract(epoch from (now() - v_started)) > v_limit then
    raise exception '超過作答時間限制';
  end if;

  for r in
    select qq.id as qid,
      qq.question_type as qtype,
      qq.points as pts,
      qs.correct_answer as corr,
      qa.answer as sans
    from public.quiz_questions qq
    join public.quiz_question_solutions qs on qs.question_id = qq.id
    left join public.quiz_answers qa
      on qa.question_id = qq.id and qa.attempt_id = p_attempt_id
    where qq.quiz_id = v_quiz_id
    order by qq.sort_order, qq.id
  loop
    if r.sans is null then
      continue;
    end if;
    if public._quiz_answer_correct(r.qtype::text, r.sans, r.corr) then
      v_score := v_score + coalesce(r.pts, 0);
    end if;
  end loop;

  update public.quiz_attempts
  set score = v_score,
      submitted_at = now()
  where id = p_attempt_id;

  return v_score;
end;
$$;

grant execute on function public.submit_quiz_attempt(uuid) to authenticated;

create or replace function public.start_quiz_attempt(p_quiz_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next integer;
  v_max integer;
  v_count integer;
  v_new uuid;
begin
  if auth.uid() is null then
    raise exception '未登入';
  end if;

  select q.max_attempts into v_max
  from public.quizzes q
  where q.id = p_quiz_id;

  if not exists (
    select 1 from public.quizzes q
    where q.id = p_quiz_id
      and public.is_course_member(q.course_id)
  ) then
    raise exception '無權限';
  end if;

  select count(*) into v_count
  from public.quiz_attempts qa
  where qa.quiz_id = p_quiz_id
    and qa.student_id = auth.uid();

  if v_count >= coalesce(v_max, 1) then
    raise exception '已達作答次數上限';
  end if;

  select coalesce(max(qa.attempt_no), 0) + 1 into v_next
  from public.quiz_attempts qa
  where qa.quiz_id = p_quiz_id
    and qa.student_id = auth.uid();

  insert into public.quiz_attempts (quiz_id, student_id, attempt_no)
  values (p_quiz_id, auth.uid(), v_next)
  returning id into v_new;

  return v_new;
end;
$$;

grant execute on function public.start_quiz_attempt(uuid) to authenticated;

create or replace function public.quiz_attempts_before_insert_guard()
returns trigger
language plpgsql
as $$
declare
  v_max integer;
  v_cnt integer;
  v_next integer;
begin
  if NEW.student_id <> auth.uid() then
    raise exception '只能建立自己的作答紀錄';
  end if;

  select q.max_attempts into v_max from public.quizzes q where q.id = NEW.quiz_id;

  select count(*) into v_cnt
  from public.quiz_attempts qa
  where qa.quiz_id = NEW.quiz_id
    and qa.student_id = NEW.student_id;

  if v_cnt >= coalesce(v_max, 1) then
    raise exception '超過作答次數上限';
  end if;

  select coalesce(max(qa.attempt_no), 0) + 1 into v_next
  from public.quiz_attempts qa
  where qa.quiz_id = NEW.quiz_id
    and qa.student_id = NEW.student_id;

  if NEW.attempt_no is distinct from v_next then
    raise exception '作答序號不正確';
  end if;

  return NEW;
end;
$$;

drop trigger if exists quiz_attempts_guard_insert on public.quiz_attempts;

create trigger quiz_attempts_guard_insert
  before insert on public.quiz_attempts
  for each row execute function public.quiz_attempts_before_insert_guard();

-- ── Random student picker ────────────────────────────────────────────────
create or replace function public.pick_random_student(p_course_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pick uuid;
begin
  if auth.uid() is null then
    raise exception '未登入';
  end if;

  if not public.is_course_teacher(p_course_id) then
    raise exception '僅教師可抽點';
  end if;

  select cm.user_id into v_pick
  from public.course_members cm
  where cm.course_id = p_course_id
    and cm.role = 'student'
  order by random()
  limit 1;

  return v_pick;
end;
$$;

grant execute on function public.pick_random_student(uuid) to authenticated;

-- ── Bulk notifications (teacher / admin) ────────────────────────────────
create or replace function public.notify_course_members(p_course_id uuid, p_title text, p_body text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted integer := 0;
begin
  if auth.uid() is null then
    raise exception '未登入';
  end if;

  if not (
    public.is_course_teacher(p_course_id)
    or public.is_platform_admin()
  ) then
    raise exception '無權限發送通知';
  end if;

  insert into public.notifications (user_id, title, body)
  select cm.user_id, p_title, coalesce(p_body, '')
  from public.course_members cm
  where cm.course_id = p_course_id;

  get diagnostics inserted = ROW_COUNT;
  return inserted;
end;
$$;

grant execute on function public.notify_course_members(uuid, text, text) to authenticated;

-- ── Admin read-only policies ────────────────────────────────────────────
create policy courses_admin_select on public.courses
  for select using (public.is_platform_admin());

create policy profiles_admin_select on public.profiles
  for select using (
    id = auth.uid()
    or public.is_platform_admin()
  );

create policy course_members_admin_select on public.course_members
  for select using (public.is_platform_admin());
